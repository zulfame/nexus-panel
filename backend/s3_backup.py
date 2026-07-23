"""Off-server cloud backups to any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).

Design goals:
- Credentials are entered in the UI and stored ENCRYPTED at rest (Fernet) in db.settings _id="s3".
- A cloud backup run dumps the panel's own MongoDB **and** every project database with
  `mongodump --gzip --archive` (so every uploaded object is directly restorable via mongorestore).
- Objects are uploaded under `<prefix>/<run-timestamp>/<db>.archive.gz`.
- Run history is recorded in db.backup_runs so the UI can list/inspect/download/delete.
- Retention keeps the newest N runs in the bucket.

All boto3 calls are blocking, so they run via asyncio.to_thread.
"""
import asyncio
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.client import Config as BotoConfig
from bson import ObjectId

from secrets_crypto import encrypt_value, decrypt_value

SETTINGS_ID = "s3"
DEFAULT_KEEP = int(os.environ.get("CLOUD_BACKUP_KEEP", "7"))
MASK = "••••••••"


def _mongo_uri() -> str:
    return os.environ["MONGO_URL"]


# ----------------------------------------------------------------- config ---
async def get_config(db, *, reveal: bool = False) -> dict | None:
    doc = await db.settings.find_one({"_id": SETTINGS_ID})
    if not doc:
        return None
    doc.pop("_id", None)
    if doc.get("secret_access_key"):
        doc["secret_access_key"] = decrypt_value(doc["secret_access_key"]) if reveal else None
    return doc


async def config_public(db) -> dict:
    doc = await db.settings.find_one({"_id": SETTINGS_ID}) or {}
    has_secret = bool(doc.get("secret_access_key"))
    return {
        "enabled": bool(doc.get("enabled", False)),
        "provider": doc.get("provider", "aws"),
        "endpoint_url": doc.get("endpoint_url", ""),
        "region": doc.get("region", ""),
        "bucket": doc.get("bucket", ""),
        "prefix": doc.get("prefix", "nexus-backups"),
        "access_key_id": doc.get("access_key_id", ""),
        "secret_set": has_secret,
        "path_style": bool(doc.get("path_style", False)),
        "schedule_enabled": bool(doc.get("schedule_enabled", False)),
        "schedule_hour": int(doc.get("schedule_hour", 3)),
        "keep": int(doc.get("keep", DEFAULT_KEEP)),
        "configured": bool(doc.get("bucket") and doc.get("access_key_id") and has_secret),
    }


async def save_config(db, body: dict) -> dict:
    update = {
        "enabled": bool(body.get("enabled", False)),
        "provider": (body.get("provider") or "aws").strip(),
        "endpoint_url": (body.get("endpoint_url") or "").strip(),
        "region": (body.get("region") or "").strip(),
        "bucket": (body.get("bucket") or "").strip(),
        "prefix": (body.get("prefix") or "nexus-backups").strip().strip("/"),
        "access_key_id": (body.get("access_key_id") or "").strip(),
        "path_style": bool(body.get("path_style", False)),
        "schedule_enabled": bool(body.get("schedule_enabled", False)),
        "schedule_hour": max(0, min(23, int(body.get("schedule_hour", 3) or 0))),
        "keep": max(1, min(365, int(body.get("keep", DEFAULT_KEEP) or DEFAULT_KEEP))),
    }
    secret = (body.get("secret_access_key") or "").strip()
    if secret and secret != MASK:  # only overwrite the secret when a new one is provided
        update["secret_access_key"] = encrypt_value(secret)
    await db.settings.update_one({"_id": SETTINGS_ID}, {"$set": update}, upsert=True)
    return await config_public(db)


# ------------------------------------------------------------- boto client --
def _build_client(cfg: dict):
    """cfg must already contain the DECRYPTED secret_access_key."""
    provider = cfg.get("provider", "aws")
    region = cfg.get("region") or ("auto" if provider == "r2" else "us-east-1")
    kwargs = {
        "aws_access_key_id": cfg["access_key_id"],
        "aws_secret_access_key": cfg["secret_access_key"],
        "region_name": region,
        "config": BotoConfig(
            signature_version="s3v4",
            s3={"addressing_style": "path" if cfg.get("path_style") else "auto"},
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    }
    endpoint = (cfg.get("endpoint_url") or "").strip()
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


def _test_connection_sync(cfg: dict) -> dict:
    client = _build_client(cfg)
    client.head_bucket(Bucket=cfg["bucket"])
    return {"ok": True}


async def test_connection(db) -> dict:
    cfg = await get_config(db, reveal=True)
    if not cfg or not cfg.get("bucket") or not cfg.get("access_key_id") or not cfg.get("secret_access_key"):
        return {"ok": False, "error": "S3 is not fully configured."}
    try:
        return await asyncio.to_thread(_test_connection_sync, cfg)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def _upload_sync(cfg: dict, local_path: str, key: str):
    client = _build_client(cfg)
    client.upload_file(local_path, cfg["bucket"], key)


def _list_run_prefixes_sync(cfg: dict) -> list:
    client = _build_client(cfg)
    prefix = (cfg.get("prefix") or "").strip("/")
    base = f"{prefix}/" if prefix else ""
    resp = client.list_objects_v2(Bucket=cfg["bucket"], Prefix=base, Delimiter="/")
    return sorted(cp["Prefix"] for cp in resp.get("CommonPrefixes", []))


def _delete_prefix_sync(cfg: dict, key_prefix: str) -> int:
    client = _build_client(cfg)
    paginator = client.get_paginator("list_objects_v2")
    to_delete = []
    for page in paginator.paginate(Bucket=cfg["bucket"], Prefix=key_prefix):
        for obj in page.get("Contents", []):
            to_delete.append({"Key": obj["Key"]})
    n = 0
    for i in range(0, len(to_delete), 1000):
        chunk = to_delete[i:i + 1000]
        if chunk:
            client.delete_objects(Bucket=cfg["bucket"], Delete={"Objects": chunk})
            n += len(chunk)
    return n


def _presign_sync(cfg: dict, key: str, expires: int = 900) -> str:
    client = _build_client(cfg)
    return client.generate_presigned_url(
        "get_object", Params={"Bucket": cfg["bucket"], "Key": key}, ExpiresIn=expires
    )


def _download_sync(cfg: dict, key: str, dest_path: str):
    client = _build_client(cfg)
    client.download_file(cfg["bucket"], key, dest_path)


async def download_to(db, key: str, dest_path: str) -> bool:
    """Download an object from the configured bucket to a local path. Returns True on success."""
    cfg = await get_config(db, reveal=True)
    if not cfg or not (cfg.get("bucket") and cfg.get("access_key_id") and cfg.get("secret_access_key")):
        return False
    await asyncio.to_thread(_download_sync, cfg, key, dest_path)
    return True


async def presign(db, key: str, expires: int = 900) -> str | None:
    cfg = await get_config(db, reveal=True)
    if not cfg:
        return None
    try:
        return await asyncio.to_thread(_presign_sync, cfg, key, expires)
    except Exception:
        return None


# --------------------------------------------------------------- run/backup --
def _mongodump_sync(uri: str, db_name: str, out_path: str) -> tuple[int, str]:
    import subprocess
    proc = subprocess.run(
        ["mongodump", f"--uri={uri}", f"--db={db_name}", f"--archive={out_path}", "--gzip"],
        capture_output=True, text=True,
    )
    return proc.returncode, (proc.stderr or proc.stdout or "").strip()


async def _run_log(db, run_id: str, text: str, stream: str = "info"):
    line = {"ts": datetime.now(timezone.utc).isoformat(), "stream": stream, "text": text}
    await db.backup_runs.update_one({"_id": ObjectId(run_id)}, {"$push": {"lines": line}})


async def create_run(db, actor: str, trigger: str) -> str:
    doc = {
        "actor": actor,
        "trigger": trigger,  # manual | scheduled
        "status": "running",
        "lines": [],
        "files": [],
        "run_key": None,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
    }
    res = await db.backup_runs.insert_one(doc)
    # keep only newest 100 run records
    olds = db.backup_runs.find({}, {"_id": 1}).sort("started_at", -1).skip(100)
    old_ids = [d["_id"] async for d in olds]
    if old_ids:
        await db.backup_runs.delete_many({"_id": {"$in": old_ids}})
    return str(res.inserted_id)


async def _target_dbs(db) -> list[str]:
    """Panel DB first, then each project's configured database (deduped)."""
    names = [db.name]
    seen = {db.name}
    async for p in db.projects.find({}, {"db_name": 1}):
        name = (p.get("db_name") or "").strip()
        if name and name not in seen:
            names.append(name)
            seen.add(name)
    return names


async def run_backup(db, run_id: str):
    cfg = await get_config(db, reveal=True)
    if not cfg or not (cfg.get("bucket") and cfg.get("access_key_id") and cfg.get("secret_access_key")):
        await _run_log(db, run_id, "Cloud storage is not fully configured.", "error")
        await db.backup_runs.update_one({"_id": ObjectId(run_id)},
                                        {"$set": {"status": "error", "finished_at": datetime.now(timezone.utc).isoformat()}})
        return
    if not shutil.which("mongodump"):
        await _run_log(db, run_id, "mongodump is not installed on this host.", "error")
        await db.backup_runs.update_one({"_id": ObjectId(run_id)},
                                        {"$set": {"status": "error", "finished_at": datetime.now(timezone.utc).isoformat()}})
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    prefix = (cfg.get("prefix") or "").strip("/")
    run_key = f"{prefix}/{ts}" if prefix else ts
    uri = _mongo_uri()
    dbs = await _target_dbs(db)
    await _run_log(db, run_id, f"Cloud backup started → s3://{cfg['bucket']}/{run_key}/", "info")
    await _run_log(db, run_id, f"Databases to back up: {', '.join(dbs)}", "info")

    files, failed = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for name in dbs:
            out = str(Path(tmp) / f"{name}.archive.gz")
            await _run_log(db, run_id, f"Dumping '{name}' …", "info")
            rc, err = await asyncio.to_thread(_mongodump_sync, uri, name, out)
            if rc != 0 or not Path(out).exists():
                failed += 1
                await _run_log(db, run_id, f"mongodump failed for '{name}': {err[:300]}", "error")
                continue
            size = Path(out).stat().st_size
            key = f"{run_key}/{name}.archive.gz"
            try:
                await _run_log(db, run_id, f"Uploading {name}.archive.gz ({size} bytes) …", "info")
                await asyncio.to_thread(_upload_sync, cfg, out, key)
                files.append({"db": name, "key": key, "size": size})
                await _run_log(db, run_id, f"Uploaded {key}", "success")
            except Exception as e:  # noqa: BLE001
                failed += 1
                await _run_log(db, run_id, f"Upload failed for '{name}': {str(e)[:300]}", "error")

    status = "success" if files and failed == 0 else ("partial" if files else "error")
    await db.backup_runs.update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": status, "files": files, "run_key": run_key,
                  "finished_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _run_log(db, run_id, f"Backup {status}. {len(files)} file(s) uploaded, {failed} failed.",
                   "success" if status == "success" else "error")

    # retention: keep newest N run prefixes in the bucket
    try:
        keep = int(cfg.get("keep", DEFAULT_KEEP))
        prefixes = await asyncio.to_thread(_list_run_prefixes_sync, cfg)
        stale = prefixes[:-keep] if len(prefixes) > keep else []
        for sp in stale:
            n = await asyncio.to_thread(_delete_prefix_sync, cfg, sp)
            await _run_log(db, run_id, f"Retention: removed old backup {sp} ({n} objects).", "info")
    except Exception as e:  # noqa: BLE001
        await _run_log(db, run_id, f"Retention pass skipped: {str(e)[:200]}", "warning")

    return status


async def delete_run(db, run_id: str) -> bool:
    doc = await db.backup_runs.find_one({"_id": ObjectId(run_id)})
    if not doc:
        return False
    cfg = await get_config(db, reveal=True)
    if cfg and doc.get("run_key"):
        try:
            await asyncio.to_thread(_delete_prefix_sync, cfg, doc["run_key"] + "/")
        except Exception:
            pass
    await db.backup_runs.delete_one({"_id": ObjectId(run_id)})
    return True
