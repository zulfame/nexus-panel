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

import ijson
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
# Above this size we stream JSON straight to mongoimport / ijson instead of loading it
# into memory. Below it we can afford exact document counts in the restore preview.
JSON_COUNT_MAX = 25 * 1024 * 1024        # 25 MB — exact counts in preview
JSON_ENUM_MAX = 250 * 1024 * 1024        # 250 MB — enumerate multi-collection keys in preview
# At/below this size we parse the JSON in memory with the robust shape detector (handles
# wrapped/metadata objects correctly). Above it we fall back to constant-memory streaming.
JSON_INMEM_MAX = 120 * 1024 * 1024       # 120 MB


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
        # named local DB gets remapped into this project's production database. Reuse the cached
        # inspect metadata (written when the restore preview was opened) so we don't have to run a
        # second full --dryRun pass over a large archive.
        sources = self._read_meta(project.slug, fname).get("source_dbs")
        if sources is None:
            sources = await self._detect_archive_dbs(fpath)
        else:
            await self._log(job_id, "Using cached archive metadata (skipping dry-run scan).", stream="info")
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

    # ---- JSON restore (mongoimport, streaming) ----
    @staticmethod
    def _json_base_name(fpath: Path) -> str:
        return (fpath.stem.split("__")[-1] or "imported").strip() or "imported"

    def _parse_json_collections_inmem(self, fpath: Path) -> dict:
        """Robust in-memory parse for small/medium files → {collection: [documents]}.

        Handles every common export shape: a plain array, NDJSON, a full-database object of
        arrays `{ "users": [...], ... }`, a wrapped `{ "collections": {...} }` or `{ "data": {...} }`,
        an object that mixes metadata fields with collection arrays, and a single document.
        MongoDB Extended JSON ($oid/$date/...) is preserved as-is.
        """
        text = fpath.read_text(encoding="utf-8", errors="replace").strip()
        base = self._json_base_name(fpath)
        if not text:
            return {}
        try:
            data = json.loads(text)
        except Exception:
            docs = []
            for line in text.splitlines():
                line = line.strip().rstrip(",")
                if line:
                    try:
                        docs.append(json.loads(line))
                    except Exception:
                        pass
            return {base: docs} if docs else {}
        return self._collections_from_obj(data, base)

    def _collections_from_obj(self, data, base: str) -> dict:
        if isinstance(data, list):
            return {base: data}
        if isinstance(data, dict):
            # Wrapped forms: {"collections": {...}} / {"data": {...}} / {"databases": {...}}
            for wrap in ("collections", "data", "databases", "db"):
                inner = data.get(wrap)
                if isinstance(inner, dict) and inner:
                    arrays = {k: v for k, v in inner.items() if isinstance(v, list)}
                    if arrays:
                        return arrays
                    nested = {k: v for k, v in inner.items() if isinstance(v, dict)}
                    out = {}
                    for k, v in nested.items():
                        docs = v.get("documents") if isinstance(v.get("documents"), list) else None
                        if docs is not None:
                            out[k] = docs
                    if out:
                        return out
            # Object where (some) top-level values are arrays → treat those as collections.
            arrays = {k: v for k, v in data.items() if isinstance(v, list)}
            if arrays:
                return arrays
            # {coll: {documents: [...]}} shape
            out = {}
            for k, v in data.items():
                if isinstance(v, dict) and isinstance(v.get("documents"), list):
                    out[k] = v["documents"]
            if out:
                return out
            # Otherwise a single document.
            return {base: [data]}
        raise ValueError("unsupported JSON structure")

    async def _import_collections(self, db_name: str, collections: dict, drop: bool, job_id: str) -> int:
        """Write each collection's docs to a temp NDJSON and mongoimport it. Returns overall rc."""
        overall = 0
        tmpdir = tempfile.mkdtemp(prefix="nexus-json-")
        try:
            for coll, docs in collections.items():
                if not docs:
                    if drop:
                        try:
                            await self.db.client[db_name][coll].drop()
                            await self._log(job_id, f"'{coll}': 0 documents — collection dropped (overwrite).", stream="info")
                        except Exception as e:  # noqa: BLE001
                            await self._log(job_id, f"'{coll}': 0 documents — could not drop ({e}).", stream="info")
                    else:
                        await self._log(job_id, f"'{coll}': 0 documents — skipped.", stream="info")
                    continue
                tmpf = os.path.join(tmpdir, "part.ndjson")

                def _dump(d=docs, p=tmpf):
                    with open(p, "w", encoding="utf-8") as out:
                        for doc in d:
                            out.write(json.dumps(doc, default=str))
                            out.write("\n")
                await asyncio.to_thread(_dump)
                await self._log(job_id, f"Importing '{coll}' ({len(docs)} docs)…", stream="info")
                rc = await self._stream_exec(job_id, self._mongoimport_args(db_name, coll, tmpf, False, drop))
                if rc != 0:
                    overall = rc
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return overall

    def _classify_json(self, fpath: Path) -> str:
        """Cheaply detect a JSON export's shape by peeking, never loading it all.

        Returns one of: 'array' (a single [...] of docs), 'multi' (a full-database object of
        arrays: {"users": [...], ...}), 'ndjson' (one JSON doc per line), 'single' (one doc),
        or 'empty'.
        """
        try:
            size = fpath.stat().st_size
        except OSError:
            size = 0
        with open(fpath, "rb") as f:
            head = f.read(1024 * 1024)
        stripped = head.lstrip()
        if not stripped:
            return "empty"
        first = chr(stripped[0])
        if first == "[":
            # detect a truly empty array only for small files
            if size <= 1024 * 1024 and stripped.rstrip() in (b"[]", b"[ ]"):
                return "empty"
            return "array"
        if first != "{":
            return "ndjson"
        # object: peek whether the first value is an array (→ multi-collection dump)
        try:
            with open(fpath, "rb") as f:
                evs = []
                for ev in ijson.parse(f):
                    evs.append(ev)
                    if len(evs) >= 3:
                        break
            if len(evs) >= 3 and evs[2][1] == "start_array":
                return "multi"
        except Exception:
            pass
        # single object vs NDJSON: decode the first value, see if another follows
        try:
            text = head.decode("utf-8", errors="replace")
            _obj, end = json.JSONDecoder().raw_decode(text)
            rest = text[end:].lstrip()
            return "ndjson" if rest.startswith("{") else "single"
        except Exception:
            return "single"

    def _top_level_keys(self, fpath: Path) -> list:
        """Stream a multi-collection object once to list its collection names (O(1) memory)."""
        keys = []
        with open(fpath, "rb") as f:
            for prefix, event, value in ijson.parse(f):
                if prefix == "" and event == "map_key":
                    keys.append(value)
        return keys

    def _stream_array_count(self, fpath: Path, prefix: str = "item") -> int:
        n = 0
        with open(fpath, "rb") as f:
            for _ in ijson.items(f, prefix, use_float=True):
                n += 1
        return n

    def _ndjson_count(self, fpath: Path) -> int:
        n = 0
        with open(fpath, "rb") as f:
            for line in f:
                if line.strip():
                    n += 1
        return n

    def _dump_collection_ndjson(self, fpath: Path, key: str, outpath: str) -> int:
        """Stream one collection's array out of a multi-collection dump into an NDJSON temp file."""
        n = 0
        with open(fpath, "rb") as f, open(outpath, "w", encoding="utf-8") as out:
            for item in ijson.items(f, f"{key}.item", use_float=True):
                out.write(json.dumps(item, default=str))
                out.write("\n")
                n += 1
        return n

    @staticmethod
    def _mongoimport_args(db_name: str, coll: str, file_path: str, json_array: bool, drop: bool) -> list:
        args = ["mongoimport", f"--uri={_mongo_uri()}", f"--db={db_name}",
                f"--collection={coll}", f"--file={file_path}"]
        if json_array:
            args.append("--jsonArray")
        if drop:
            args.append("--drop")
        return args

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
        size = fpath.stat().st_size
        mode = "drop & overwrite" if drop else "merge"

        # Small/medium files: robust in-memory parse (correctly handles wrapped/metadata objects).
        if size <= JSON_INMEM_MAX:
            await self._log(job_id, f"Reading JSON '{fname}' ({size} bytes, {mode})…", stream="info")
            try:
                collections = await asyncio.to_thread(self._parse_json_collections_inmem, fpath)
            except Exception as e:  # noqa: BLE001
                await self._log(job_id, f"Could not parse JSON: {e}", stream="error")
                await self._finish(job_id, "error", 1)
                return
            if not collections:
                await self._log(job_id, "No importable documents found in the JSON.", stream="error")
                await self._finish(job_id, "error", 1)
                return
            summary = ", ".join(f"{k} ({len(v)})" for k, v in collections.items())
            await self._log(job_id, f"Detected {len(collections)} collection(s) → {db_name}: {summary}", stream="info")
            overall = await self._import_collections(db_name, collections, drop, job_id)
            if overall == 0:
                await self._log(job_id, "JSON import complete.", stream="success")
                await self._finish(job_id, "success", 0)
            else:
                await self._log(job_id, "JSON import finished with errors.", stream="error")
                await self._finish(job_id, "error", overall)
            return

        # Large files: constant-memory streaming.
        try:
            shape = await asyncio.to_thread(self._classify_json, fpath)
        except Exception as e:  # noqa: BLE001
            await self._log(job_id, f"Could not read JSON: {e}", stream="error")
            await self._finish(job_id, "error", 1)
            return
        await self._log(job_id, f"Reading JSON '{fname}' ({size} bytes, shape: {shape}, {mode})…", stream="info")

        if shape == "empty":
            await self._log(job_id, "No importable documents found in the JSON.", stream="error")
            await self._finish(job_id, "error", 1)
            return

        # Multi-collection object → stream each collection to a temp NDJSON, then import.
        if shape == "multi":
            try:
                keys = await asyncio.to_thread(self._top_level_keys, fpath)
            except Exception as e:  # noqa: BLE001
                await self._log(job_id, f"Could not parse JSON structure: {e}", stream="error")
                await self._finish(job_id, "error", 1)
                return
            await self._log(job_id, f"Detected {len(keys)} collection(s) → {db_name}: {', '.join(keys)}", stream="info")
            overall = 0
            tmpdir = tempfile.mkdtemp(prefix="nexus-json-")
            try:
                for coll in keys:
                    tmpf = os.path.join(tmpdir, "part.ndjson")
                    n = await asyncio.to_thread(self._dump_collection_ndjson, fpath, coll, tmpf)
                    if n == 0:
                        if drop:
                            try:
                                await self.db.client[db_name][coll].drop()
                                await self._log(job_id, f"'{coll}': 0 documents — collection dropped (overwrite).", stream="info")
                            except Exception as e:  # noqa: BLE001
                                await self._log(job_id, f"'{coll}': 0 documents — could not drop ({e}).", stream="info")
                        else:
                            await self._log(job_id, f"'{coll}': 0 documents — skipped.", stream="info")
                        continue
                    await self._log(job_id, f"Importing '{coll}' ({n} docs, streamed)…", stream="info")
                    rc = await self._stream_exec(job_id, self._mongoimport_args(db_name, coll, tmpf, False, drop))
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
            return

        # Single-collection shapes → point mongoimport straight at the file (no memory copy).
        coll = self._json_base_name(fpath)
        if shape == "single":
            # exactly one document — normalise to a single NDJSON line
            tmpdir = tempfile.mkdtemp(prefix="nexus-json-")
            try:
                def _one():
                    doc = json.loads(fpath.read_text(encoding="utf-8", errors="replace"))
                    p = os.path.join(tmpdir, "one.ndjson")
                    with open(p, "w", encoding="utf-8") as out:
                        out.write(json.dumps(doc, default=str))
                    return p
                tmpf = await asyncio.to_thread(_one)
                await self._log(job_id, f"Importing '{coll}' (1 document)…", stream="info")
                rc = await self._stream_exec(job_id, self._mongoimport_args(db_name, coll, tmpf, False, drop))
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)
        else:
            json_array = shape == "array"
            await self._log(job_id, f"Streaming '{coll}' from file into MongoDB…", stream="info")
            rc = await self._stream_exec(job_id, self._mongoimport_args(db_name, coll, str(fpath), json_array, drop))

        if rc == 0:
            await self._log(job_id, "JSON import complete.", stream="success")
            await self._finish(job_id, "success", 0)
        else:
            await self._log(job_id, "JSON import finished with errors.", stream="error")
            await self._finish(job_id, "error", rc or 1)

    async def _detect_archive_namespaces(self, fpath: Path) -> list:
        """Return the collection namespaces inside a gzipped mongodump archive (via --dryRun)."""
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
        ns = []
        for m in re.finditer(r"`([^`.]+\.[^`]+)`", text):
            name = m.group(1)
            if name.split(".")[0] in ("admin", "config", "local"):
                continue
            if name not in ns:
                ns.append(name)
        return ns

    # ---- inspect metadata cache (sidecar) ----
    def _meta_dir(self, slug: str) -> Path:
        d = self._slug_dir(slug) / ".meta"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _read_meta(self, slug: str, fname: str) -> dict:
        p = self._meta_dir(slug) / f"{fname}.json"
        if not p.is_file():
            return {}
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}

    def _write_meta(self, slug: str, fname: str, meta: dict):
        try:
            (self._meta_dir(slug) / f"{fname}.json").write_text(json.dumps(meta))
        except Exception:
            pass

    async def inspect_backup(self, project: Project, fname: str) -> dict:
        """Preview what a restore would import — collections and (for JSON) document counts —
        without loading a large file into memory or touching the database."""
        fpath = self._slug_dir(project.slug) / fname
        if not fpath.is_file():
            return {"kind": "unknown", "collections": [], "error": "file not found"}
        size = fpath.stat().st_size

        if fname.lower().endswith(".json"):
            # Small/medium: robust in-memory parse gives accurate collections + counts and
            # matches exactly what the restore will do.
            if size <= JSON_INMEM_MAX:
                try:
                    cols = await asyncio.to_thread(self._parse_json_collections_inmem, fpath)
                except Exception as e:  # noqa: BLE001
                    return {"kind": "json", "collections": [], "error": str(e)}
                return {"kind": "json", "large": False,
                        "collections": [{"name": k, "count": len(v)} for k, v in cols.items()]}
            try:
                shape = await asyncio.to_thread(self._classify_json, fpath)
            except Exception as e:  # noqa: BLE001
                return {"kind": "json", "collections": [], "error": str(e)}
            if shape == "empty":
                return {"kind": "json", "collections": []}
            base = self._json_base_name(fpath)
            exact = False  # size > JSON_INMEM_MAX here, always a large file

            if shape in ("array", "ndjson", "single"):
                count = 1 if shape == "single" else None
                return {"kind": "json", "large": True,
                        "collections": [{"name": base, "count": count}]}

            # multi-collection object
            if size > JSON_ENUM_MAX:
                return {"kind": "json", "large": True,
                        "note": "Large multi-collection export — collections will be detected during restore.",
                        "collections": []}
            try:
                keys = await asyncio.to_thread(self._top_level_keys, fpath)
            except Exception as e:  # noqa: BLE001
                return {"kind": "json", "collections": [], "error": str(e)}
            cols = []
            for k in keys:
                count = await asyncio.to_thread(self._stream_array_count, fpath, f"{k}.item") if exact else None
                cols.append({"name": k, "count": count})
            return {"kind": "json", "large": not exact, "collections": cols}

        ns = await self._detect_archive_namespaces(fpath)
        sources = sorted({n.split(".")[0] for n in ns})
        result = {"kind": "archive", "source_dbs": sources,
                  "collections": [{"name": n.split(".", 1)[1], "count": None} for n in ns]}
        # Cache so run_restore can skip a second full --dryRun scan on large archives.
        self._write_meta(project.slug, fname, {"source_dbs": sources, "namespaces": ns})
        return result

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
            (self._meta_dir(slug) / f"{fname}.json").unlink(missing_ok=True)
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

    @router.get("/{project_id}/backups/{fname}/inspect")
    async def inspect_backup(project_id: str, fname: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        if not mgr.backup_path(project.slug, fname):
            raise HTTPException(status_code=404, detail="Backup not found")
        return await mgr.inspect_backup(project, fname)

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
