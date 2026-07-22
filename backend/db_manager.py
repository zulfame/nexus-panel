"""Per-project MongoDB management: list databases, stats, backup & restore.

Backups use `mongodump`/`mongorestore` with a single gzipped archive per DB.
Backup/restore run as background jobs whose output is streamed to the UI by
polling `GET /api/databases/jobs/{job_id}`.
"""
import asyncio
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse

from models import Project
from audit import log_event

NEXUS_HOME = Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel"))
DATA_DIR = Path(os.environ.get("PANEL_DATA_DIR", "/app/panel_data"))

_DB_RE = re.compile(r"^[A-Za-z0-9_-]{1,63}$")
_FILE_RE = re.compile(r"^[A-Za-z0-9._-]{1,200}\.archive\.gz$")
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
        for f in sorted(d.glob("*.archive.gz"), key=lambda p: p.stat().st_mtime, reverse=True):
            st = f.stat()
            out.append({"name": f.name, "size": st.st_size, "created": int(st.st_mtime)})
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

    async def run_restore(self, project: Project, fname: str, drop: bool, job_id: str):
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
        args = [
            "mongorestore", f"--uri={_mongo_uri()}", f"--archive={fpath}", "--gzip",
            f"--nsInclude={db_name}.*",
        ]
        if drop:
            args.append("--drop")
        rc = await self._stream_exec(job_id, args)
        if rc == 0:
            await self._log(job_id, "Restore complete.", stream="success")
            await self._finish(job_id, "success", 0)
        else:
            await self._log(job_id, "Restore failed.", stream="error")
            await self._finish(job_id, "error", rc or 1)

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

    @router.get("/{project_id}/backups/{fname}/download")
    async def download_backup(project_id: str, fname: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        p = mgr.backup_path(project.slug, fname)
        if not p:
            raise HTTPException(status_code=404, detail="Backup not found")
        return FileResponse(str(p), media_type="application/gzip", filename=fname)

    @router.delete("/{project_id}/backups/{fname}")
    async def delete_backup(project_id: str, fname: str, current=Depends(get_current_user)):
        project = await get_project_or_404(project_id)
        if not mgr.delete_backup(project.slug, fname):
            raise HTTPException(status_code=404, detail="Backup not found")
        await log_event(db, current["username"], "database.backup.delete", target=project.name, meta={"file": fname})
        return {"ok": True}

    return router, mgr
