"""Per-project MongoDB management: list databases, stats, backup & restore.

Backups use `mongodump`/`mongorestore` with a single gzipped archive per DB.
Backup/restore run as background jobs whose output is streamed to the UI by
polling `GET /api/databases/jobs/{job_id}`.
"""
import asyncio
import json
import os
import re
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from models import Project
from audit import log_event

NEXUS_HOME = Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel"))
DATA_DIR = Path(os.environ.get("PANEL_DATA_DIR", "/app/panel_data"))

_DB_RE = re.compile(r"^[A-Za-z0-9_-]{1,63}$")
_FILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,200}\.(archive\.gz|gz|json)$")
DB_BACKUP_KEEP = int(os.environ.get("NEXUS_DB_BACKUP_KEEP", "10"))
MAX_JOB_LINES = 3000


def _resolve_backup_dir() -> Path:
    """Prefer NEXUS_HOME/backups/db (persistent on the VPS); fall back to the data dir."""
    pref = os.environ.get("NEXUS_DB_BACKUP_DIR") or str(NEXUS_HOME / "backups" / "db")
    for candidate in (pref, str(DATA_DIR / "db_backups")):
        try:
            Path(candidate).mkdir(parents=True, exist_ok=True)
            return Path(candidate)
        except Exception:
            continue
    return Path(pref)


DB_BACKUP_DIR = _resolve_backup_dir()


def _mongo_uri() -> str:
    return os.environ["MONGO_URL"]


def tools_available() -> dict:
    return {
        "mongodump": shutil.which("mongodump") is not None,
        "mongorestore": shutil.which("mongorestore") is not None,
    }


class DBManager:
    def __init__(self, db):
        self.db = db
        self.panel_db_name = db.name

    # ---- stats / listing ----
    async def _db_stats(self, db_name: str) -> dict:
        try:
            stats = await self.db.client[db_name].command("dbStats")
            return {
                "size_bytes": int(stats.get("dataSize", 0)),
                "storage_bytes": int(stats.get("storageSize", 0)),
                "collections": int(stats.get("collections", 0)),
                "objects": int(stats.get("objects", 0)),
                "index_bytes": int(stats.get("indexSize", 0)),
            }
        except Exception:
            return {"size_bytes": 0, "storage_bytes": 0, "collections": 0, "objects": 0, "index_bytes": 0}

    def _slug_dir(self, slug: str) -> Path:
        return DB_BACKUP_DIR / slug

    def list_backups(self, slug: str) -> list:
        d = self._slug_dir(slug)
        if not d.is_dir():
            return []
        out = []
        for f in sorted((p for p in d.iterdir() if p.is_file() and _FILE_RE.match(p.name)),
                        key=lambda p: p.stat().st_mtime, reverse=True):
            st = f.stat()
            out.append({"name": f.name, "size": st.st_size, "created": int(st.st_mtime),
                        "kind": "json" if f.name.endswith(".json") else "archive"})
        return out

    async def list_databases(self) -> list:
        try:
            existing = set(await self.db.client.list_database_names())
        except Exception:
            existing = set()
        out = []
        async for doc in self.db.projects.find().sort("created_at", -1):
            project = Project.from_mongo(doc)
            db_name = (project.db_name or "").strip()
            if not db_name or db_name == self.panel_db_name:
                continue
            stats = await self._db_stats(db_name) if db_name in existing else {
                "size_bytes": 0, "storage_bytes": 0, "collections": 0, "objects": 0, "index_bytes": 0,
            }
            backups = self.list_backups(project.slug)
            out.append({
                "project_id": project.id,
                "project_name": project.name,
                "slug": project.slug,
                "db_name": db_name,
                "environment": project.environment,
                "status": project.status,
                "exists": db_name in existing,
                "stats": stats,
                "backups_count": len(backups),
                "last_backup": backups[0]["created"] if backups else None,
            })
        return out

    # ---- job helpers ----
    async def _new_job(self, project_id: str, db_name: str, kind: str, meta: dict) -> str:
        doc = {
            "project_id": project_id,
            "db_name": db_name,
            "kind": kind,
            "status": "running",
            "rc": None,
            "lines": [],
            "meta": meta,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }
        res = await self.db.db_jobs.insert_one(doc)
        # keep only the newest 100 jobs
        olds = self.db.db_jobs.find({}, {"_id": 1}).sort("created_at", -1).skip(100)
        old_ids = [d["_id"] async for d in olds]
        if old_ids:
            await self.db.db_jobs.delete_many({"_id": {"$in": old_ids}})
        return str(res.inserted_id)

    async def _log(self, job_id: str, text: str, stream: str = "stdout"):
        line = {"ts": datetime.now(timezone.utc).isoformat(), "stream": stream, "text": text}
        await self.db.db_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$push": {"lines": {"$each": [line], "$slice": -MAX_JOB_LINES}}},
        )

    async def _finish(self, job_id: str, status: str, rc: Optional[int]):
        await self.db.db_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {"status": status, "rc": rc, "finished_at": datetime.now(timezone.utc).isoformat()}},
        )

    async def get_job(self, job_id: str) -> Optional[dict]:
        try:
            doc = await self.db.db_jobs.find_one({"_id": ObjectId(job_id)})
        except Exception:
            return None
        if not doc:
            return None
        return {
            "id": str(doc["_id"]),
            "project_id": doc.get("project_id"),
            "db_name": doc.get("db_name"),
            "kind": doc.get("kind"),
            "status": doc.get("status"),
            "rc": doc.get("rc"),
            "lines": doc.get("lines", []),
            "done": doc.get("status") in ("success", "error"),
            "created_at": doc.get("created_at"),
            "finished_at": doc.get("finished_at"),
        }

    async def _stream_exec(self, job_id: str, args: list) -> int:
        await self._log(job_id, "$ " + " ".join(a if not a.startswith("--uri") else "--uri=***" for a in args), stream="info")
        try:
            proc = await asyncio.create_subprocess_exec(
                *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
        except Exception as e:  # noqa: BLE001
            await self._log(job_id, f"failed to start: {e}", stream="error")
            return 1
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            text = raw.decode(errors="replace").rstrip("\n")
            if text:
                await self._log(job_id, text)
        return await proc.wait()

    def _prune_backups(self, slug: str):
        d = self._slug_dir(slug)
        if not d.is_dir():
            return
        files = sorted(d.glob("*.archive.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
        for f in files[DB_BACKUP_KEEP:]:
            try:
                f.unlink()
            except Exception:
                pass

    # ---- backup / restore jobs ----
    async def run_backup(self, project: Project, job_id: str):
        db_name = (project.db_name or "").strip()
        if not tools_available()["mongodump"]:
            await self._log(job_id, "mongodump is not installed on this host. Install mongodb-database-tools.", stream="error")
            await self._finish(job_id, "error", 127)
            return
        slug_dir = self._slug_dir(project.slug)
        try:
            slug_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:  # noqa: BLE001
            await self._log(job_id, f"cannot create backup dir: {e}", stream="error")
            await self._finish(job_id, "error", 1)
            return
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        fname = f"{db_name}__{ts}.archive.gz"
        fpath = slug_dir / fname
        await self._log(job_id, f"Backing up database '{db_name}' → {fname}", stream="info")
        args = [
            "mongodump", f"--uri={_mongo_uri()}", f"--db={db_name}",
            f"--archive={fpath}", "--gzip",
        ]
        rc = await self._stream_exec(job_id, args)
        if rc == 0 and fpath.exists():
            size = fpath.stat().st_size
            await self._log(job_id, f"Backup complete ({size} bytes).", stream="success")
            self._prune_backups(project.slug)
            await self._finish(job_id, "success", 0)
        else:
            await self._log(job_id, "Backup failed.", stream="error")
            try:
                if fpath.exists():
                    fpath.unlink()
            except Exception:
                pass
            await self._finish(job_id, "error", rc or 1)

    async def _detect_archive_dbs(self, fpath: Path) -> list:
        """Peek at a gzipped mongodump archive (via --dryRun) to learn its source database names."""
        if not shutil.which("mongorestore"):
            return []
        try:
            proc = await asyncio.create_subprocess_exec(
                "mongorestore", f"--uri={_mongo_uri()}", f"--archive={fpath}", "--gzip", "--dryRun", "-v",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await proc.communicate()
            text = out.decode(errors="replace")
        except Exception:
            return []
        dbs = []
        for m in re.finditer(r"`([^`.]+)\.[^`]+`", text):
            name = m.group(1)
            if name and name not in ("admin", "config", "local") and name not in dbs:
                dbs.append(name)
        return dbs

    async def run_restore(self, project: Project, fname: str, drop: bool, job_id: str):
        if fname.lower().endswith(".json"):
            return await self.run_json_restore(project, fname, drop, job_id)
        db_name = (project.db_name or "").strip()
        if not tools_available()["mongorestore"]:
            await self._log(job_id, "mongorestore is not installed on this host. Install mongodb-database-tools.", stream="error")
            await self._finish(job_id, "error", 127)
            return
        fpath = self._slug_dir(project.slug) / fname
        if not fpath.is_file():
            await self._log(job_id, "Backup archive not found.", stream="error")
            await self._finish(job_id, "error", 1)
            return
        mode = "drop & overwrite" if drop else "merge"
        await self._log(job_id, f"Restoring '{fname}' into '{db_name}' ({mode})…", stream="info")
        args = ["mongorestore", f"--uri={_mongo_uri()}", f"--archive={fpath}", "--gzip"]
        # Figure out the archive's source database so an uploaded dump from a differently
        # named local DB gets remapped into this project's production database.
        sources = await self._detect_archive_dbs(fpath)
        if len(sources) == 1 and sources[0] != db_name:
            await self._log(job_id, f"Remapping source database '{sources[0]}' → '{db_name}'.", stream="info")
            args += [f"--nsFrom={sources[0]}.*", f"--nsTo={db_name}.*"]
        else:
            args.append(f"--nsInclude={db_name}.*")
        if drop:
            args.append("--drop")
        rc = await self._stream_exec(job_id, args)
        if rc == 0:
            await self._log(job_id, "Restore complete.", stream="success")
            await self._finish(job_id, "success", 0)
        else:
            await self._log(job_id, "Restore failed.", stream="error")
            await self._finish(job_id, "error", rc or 1)

    # ---- JSON restore (mongoimport) ----
    def _parse_json_collections(self, fpath: Path) -> dict:
        """Auto-detect the JSON shape and return {collection_name: [documents]}.

        Handles: a single array of documents, NDJSON (one doc per line), a full-database object
        `{ "users": [...], "orders": [...] }`, a wrapped `{ "collections": { ... } }`, and a
        single document object. MongoDB Extended JSON ($oid/$date/...) is preserved as-is.
        """
        text = fpath.read_text(encoding="utf-8", errors="replace").strip()
        base = (fpath.stem.split("__")[-1] or "imported").strip() or "imported"
        if not text:
            return {}
        try:
            data = json.loads(text)
        except Exception:
            docs = []
            for line in text.splitlines():
                line = line.strip().rstrip(",")
                if line:
                    docs.append(json.loads(line))
            return {base: docs} if docs else {}
        if isinstance(data, list):
            return {base: data}
        if isinstance(data, dict):
            if data and all(isinstance(v, list) for v in data.values()):
                return {k: v for k, v in data.items() if isinstance(v, list)}
            cs = data.get("collections")
            if isinstance(cs, dict) and cs and all(isinstance(v, list) for v in cs.values()):
                return {k: v for k, v in cs.items() if isinstance(v, list)}
            return {base: [data]}
        raise ValueError("unsupported JSON structure")

    async def run_json_restore(self, project: Project, fname: str, drop: bool, job_id: str):
        db_name = (project.db_name or "").strip()
        if not shutil.which("mongoimport"):
            await self._log(job_id, "mongoimport is not installed on this host. Install mongodb-database-tools.", stream="error")
            await self._finish(job_id, "error", 127)
            return
        fpath = self._slug_dir(project.slug) / fname
        if not fpath.is_file():
            await self._log(job_id, "JSON file not found.", stream="error")
            await self._finish(job_id, "error", 1)
            return
        await self._log(job_id, f"Reading JSON '{fname}'…", stream="info")
        try:
            collections = await asyncio.to_thread(self._parse_json_collections, fpath)
        except Exception as e:  # noqa: BLE001
            await self._log(job_id, f"Could not parse JSON: {e}", stream="error")
            await self._finish(job_id, "error", 1)
            return
        if not collections:
            await self._log(job_id, "No importable documents found in the JSON.", stream="error")
            await self._finish(job_id, "error", 1)
            return
        summary = ", ".join(f"{k} ({len(v)})" for k, v in collections.items())
        mode = "drop & overwrite" if drop else "merge"
        await self._log(job_id, f"Detected {len(collections)} collection(s) → {db_name} ({mode}): {summary}", stream="info")
        overall = 0
        tmpdir = tempfile.mkdtemp(prefix="nexus-json-")
        try:
            for coll, docs in collections.items():
                tmpf = os.path.join(tmpdir, "part.json")
                await asyncio.to_thread(lambda: json.dump(docs, open(tmpf, "w")))
                args = ["mongoimport", f"--uri={_mongo_uri()}", f"--db={db_name}",
                        f"--collection={coll}", f"--file={tmpf}", "--jsonArray"]
                if drop:
                    args.append("--drop")
                await self._log(job_id, f"Importing '{coll}' ({len(docs)} docs)…", stream="info")
                rc = await self._stream_exec(job_id, args)
                if rc != 0:
                    overall = rc
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        if overall == 0:
            await self._log(job_id, "JSON import complete.", stream="success")
            await self._finish(job_id, "success", 0)
        else:
            await self._log(job_id, "JSON import finished with errors.", stream="error")
            await self._finish(job_id, "error", overall)

    # ---- chunked upload of an external archive ----
    def _uploads_dir(self, slug: str) -> Path:
        d = self._slug_dir(slug) / ".uploads"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save_chunk(self, slug: str, db_name: str, upload_id: str, index: int, total: int, data: bytes, filename: str = "") -> Optional[str]:
        """Append one chunk; on the final chunk, move it into place with a normalized name.
        Returns the stored file name when complete, else None. Preserves .json uploads (and the
        original base name) so a JSON restore can recover the collection name."""
        if not re.match(r"^[A-Za-z0-9_-]{6,64}$", upload_id or ""):
            raise ValueError("invalid upload id")
        part = self._uploads_dir(slug) / f"{upload_id}.part"
        with open(part, "wb" if index == 0 else "ab") as f:
            f.write(data)
        if index + 1 < total:
            return None
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        if (filename or "").lower().endswith(".json"):
            safe = re.sub(r"[^A-Za-z0-9_-]", "", Path(filename).stem)[:40] or "data"
            final = self._slug_dir(slug) / f"{db_name}__uploaded-{ts}__{safe}.json"
        else:
            final = self._slug_dir(slug) / f"{db_name}__uploaded-{ts}.archive.gz"
        part.replace(final)
        return final.name

    def backup_path(self, slug: str, fname: str) -> Optional[Path]:
        if not _FILE_RE.match(fname):
            return None
        p = (self._slug_dir(slug) / fname).resolve()
        try:
            p.relative_to(self._slug_dir(slug).resolve())
        except ValueError:
            return None
        return p if p.is_file() else None

    def delete_backup(self, slug: str, fname: str) -> bool:
        p = self.backup_path(slug, fname)
        if not p:
            return False
        try:
            p.unlink()
            return True
        except Exception:
            return False

    def cleanup_project(self, slug: str):
        """Remove all backup archives for a deleted project."""
        d = self._slug_dir(slug)
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)


def build_databases_router(db, get_current_user, get_project_or_404):
    router = APIRouter(prefix="/databases", tags=["databases"])
    mgr = DBManager(db)

    @router.get("")
    async def list_dbs(current=Depends(get_current_user)):
        return {"databases": await mgr.list_databases(), "tools": tools_available()}

    @router.get("/jobs/{job_id}")
    async def job_status(job_id: str, current=Depends(get_current_user)):
        job = await mgr.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.get("/{project_id}")
    async def db_detail(project_id: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        db_name = (project.db_name or "").strip()
        stats = await mgr._db_stats(db_name) if db_name else {}
        return {
            "project_id": project.id,
            "project_name": project.name,
            "slug": project.slug,
            "db_name": db_name,
            "environment": project.environment,
            "status": project.status,
            "stats": stats,
            "backups": mgr.list_backups(project.slug),
            "tools": tools_available(),
        }

    @router.post("/{project_id}/backup")
    async def backup_db(project_id: str, background: BackgroundTasks, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        db_name = (project.db_name or "").strip()
        if not db_name or not _DB_RE.match(db_name):
            raise HTTPException(status_code=400, detail="Project has no valid database name")
        job_id = await mgr._new_job(project.id, db_name, "backup", {})
        background.add_task(mgr.run_backup, project, job_id)
        await log_event(db, current["username"], "database.backup", target=project.name)
        return {"ok": True, "job_id": job_id}

    @router.get("/{project_id}/backups/{fname}/download")
    async def download_backup(project_id: str, fname: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        p = mgr.backup_path(project.slug, fname)
        if not p:
            raise HTTPException(status_code=404, detail="Backup not found")
        media = "application/json" if fname.endswith(".json") else "application/gzip"
        return FileResponse(str(p), media_type=media, filename=fname)

    @router.delete("/{project_id}/backups/{fname}")
    async def delete_backup(project_id: str, fname: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        if not mgr.delete_backup(project.slug, fname):
            raise HTTPException(status_code=404, detail="Backup not found")
        await log_event(db, current["username"], "database.backup.delete", target=project.name, meta={"file": fname})
        return {"ok": True}

    @router.post("/{project_id}/restore")
    async def restore_db(project_id: str, body: dict, background: BackgroundTasks, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        fname = (body or {}).get("file", "")
        drop = bool((body or {}).get("drop", False))
        if not fname or not mgr.backup_path(project.slug, fname):
            raise HTTPException(status_code=400, detail="Unknown backup archive")
        job_id = await mgr._new_job(project.id, project.db_name, "restore", {"file": fname, "drop": drop})
        background.add_task(mgr.run_restore, project, fname, drop, job_id)
        await log_event(db, current["username"], "database.restore", target=project.name, meta={"file": fname, "drop": drop})
        return {"ok": True, "job_id": job_id}

    @router.post("/{project_id}/upload")
    async def upload_archive(
        project_id: str,
        file: UploadFile = File(...),
        upload_id: str = Form(...),
        index: int = Form(...),
        total: int = Form(...),
        filename: str = Form(""),
        current=Depends(get_current_user),
    ):
        """Receive one chunk of an external upload (chunked to bypass proxy limits).
        Accepts a gzipped mongodump archive (.gz / .archive.gz) or a JSON export (.json)."""
        project = await get_project_or_404(project_id)
        db_name = (project.db_name or "").strip()
        low = (filename or "").lower()
        if index == 0 and not (low.endswith(".gz") or low.endswith(".archive") or low.endswith(".json")):
            raise HTTPException(status_code=400, detail="Upload a mongodump archive (.gz / .archive.gz) or a JSON export (.json).")
        try:
            data = await file.read()
            name = await asyncio.to_thread(mgr.save_chunk, project.slug, db_name, upload_id, index, total, data, filename)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if name:
            await log_event(db, current["username"], "database.archive.upload", target=project.name, meta={"file": name})
        return {"ok": True, "done": bool(name), "file": name}

    return router, mgr
