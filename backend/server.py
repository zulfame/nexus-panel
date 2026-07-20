import logging
import os
import asyncio
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from bson import ObjectId  # noqa: E402
import jwt  # noqa: E402
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException  # noqa: E402
from fastapi import APIRouter, WebSocket, WebSocketDisconnect  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from auth import build_auth_router, get_jwt_secret, seed_admin  # noqa: E402
from deploy_engine import (  # noqa: E402
    DeployEngine,
    LogBroker,
    decrypt_token,
    detect_capabilities,
    encrypt_token,
    slugify,
)
from models import (  # noqa: E402
    Project,
    ProjectCreate,
    ProjectUpdate,
    now_iso,
    project_public,
)
import ops  # noqa: E402
from notifications import send_telegram, telegram_configured  # noqa: E402
from system_stats import get_system_stats  # noqa: E402
from terminal import (  # noqa: E402
    build_terminal_router,
    local_terminal_session,
    seed_default_commands,
    ssh_terminal_session,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("panel")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Emergent Deploy Panel")
api_router = APIRouter(prefix="/api")

broker = LogBroker()
engine = DeployEngine(db, broker)
auth_router, get_current_user = build_auth_router(db)

BACKEND_PORT_BASE = 8100
FRONTEND_PORT_BASE = 3100
SERVICE_NAME = "nexus-panel"


# ------------------------------------------------------------- helpers ------
async def _next_ports() -> tuple[int, int]:
    be = BACKEND_PORT_BASE
    fe = FRONTEND_PORT_BASE
    used_be, used_fe = set(), set()
    async for doc in db.projects.find({}, {"backend_port": 1, "frontend_port": 1}):
        if doc.get("backend_port"):
            used_be.add(doc["backend_port"])
        if doc.get("frontend_port"):
            used_fe.add(doc["frontend_port"])
    while be in used_be:
        be += 1
    while fe in used_fe:
        fe += 1
    return be, fe


async def _get_project_or_404(project_id: str) -> Project:
    try:
        doc = await db.projects.find_one({"_id": ObjectId(project_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project id")
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return Project.from_mongo(doc)


# ------------------------------------------------------- validation --------
import re as _re

_REPO_RE = _re.compile(r"^(https?://[\w.-]+(:\d+)?/\S+|git@[\w.-]+:\S+|ssh://\S+)$")
_DOMAIN_RE = _re.compile(
    r"^(?=.{1,253}$)([A-Za-z0-9](-?[A-Za-z0-9])*)(\.[A-Za-z0-9](-?[A-Za-z0-9])*)+$"
)
_DB_RE = _re.compile(r"^[A-Za-z0-9_-]{1,63}$")
_ENV_KEY_RE = _re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SSL_MODES = {"none", "letsencrypt", "custom"}


def _err(msg: str):
    raise HTTPException(status_code=400, detail=msg)


def _validate_project_fields(v: dict):
    """Validate the effective (merged) project field values. Raises HTTP 400 on error."""
    name = (v.get("name") or "").strip()
    if not name:
        _err("Nama project wajib diisi.")
    if len(name) > 60:
        _err("Nama project maksimal 60 karakter.")

    repo = (v.get("repo_url") or "").strip()
    if not repo:
        _err("URL repository GitHub wajib diisi.")
    if not _REPO_RE.match(repo):
        _err("URL repository tidak valid. Contoh: https://github.com/user/repo.git")

    branch = (v.get("branch") or "main").strip()
    if " " in branch:
        _err("Nama branch tidak boleh mengandung spasi.")

    ssl_mode = v.get("ssl_mode") or "none"
    if ssl_mode not in _SSL_MODES:
        _err("SSL mode harus salah satu dari: none, letsencrypt, custom.")

    domain = (v.get("domain") or "").strip()
    if domain and not _DOMAIN_RE.match(domain):
        _err(f"Domain '{domain}' tidak valid. Contoh: app.domainku.com")

    if ssl_mode == "letsencrypt":
        if not domain:
            _err("SSL Let's Encrypt membutuhkan domain yang valid.")
        email = (v.get("ssl_email") or "").strip()
        if email and not _EMAIL_RE.match(email):
            _err("Email Let's Encrypt tidak valid.")

    if ssl_mode == "custom":
        cert = (v.get("ssl_cert_path") or "").strip()
        key = (v.get("ssl_key_path") or "").strip()
        if not cert or not key:
            _err("SSL custom membutuhkan path Certificate dan Private Key.")
        if not cert.startswith("/") or not key.startswith("/"):
            _err("Path sertifikat/kunci harus berupa path absolut (diawali '/').")

    db_name = (v.get("db_name") or "").strip()
    if db_name and not _DB_RE.match(db_name):
        _err("Nama database hanya boleh huruf, angka, '-' dan '_' (maks 63 karakter).")

    for label, port in (("backend", v.get("backend_port")), ("frontend", v.get("frontend_port"))):
        if port is not None:
            if not isinstance(port, int) or port < 1024 or port > 65535:
                _err(f"Port {label} harus angka antara 1024–65535.")

    env_vars = v.get("env_vars") or []
    seen = set()
    for e in env_vars:
        key = (e.get("key") if isinstance(e, dict) else getattr(e, "key", "")) or ""
        key = key.strip()
        if not key:
            continue
        if not _ENV_KEY_RE.match(key):
            _err(f"Env var '{key}' tidak valid. Gunakan huruf/angka/underscore dan tidak diawali angka.")
        if key in seen:
            _err(f"Env var '{key}' terduplikasi.")
        seen.add(key)


async def _check_project_conflicts(
    slug: str, domain: Optional[str], be: Optional[int], fe: Optional[int], exclude_id: Optional[str] = None
):
    """Ensure slug/domain/ports don't clash with another project. Raises HTTP 409."""
    def _not_self(doc):
        return exclude_id is None or str(doc["_id"]) != exclude_id

    existing = await db.projects.find_one({"slug": slug})
    if existing and _not_self(existing):
        raise HTTPException(status_code=409, detail=f"Project dengan nama '{slug}' sudah ada.")

    if domain:
        dclash = await db.projects.find_one({"domain": domain})
        if dclash and _not_self(dclash):
            raise HTTPException(status_code=409, detail=f"Domain '{domain}' sudah dipakai project lain.")

    if be is not None:
        c = await db.projects.find_one({"backend_port": be})
        if c and _not_self(c):
            raise HTTPException(status_code=409, detail=f"Port backend {be} sudah dipakai project lain.")
    if fe is not None:
        c = await db.projects.find_one({"frontend_port": fe})
        if c and _not_self(c):
            raise HTTPException(status_code=409, detail=f"Port frontend {fe} sudah dipakai project lain.")


# ------------------------------------------------------------- routes -------
@api_router.get("/")
async def root():
    return {"message": "Emergent Deploy Panel API"}


@api_router.get("/capabilities")
async def capabilities(current=Depends(get_current_user)):
    return engine.refresh_caps()


@api_router.get("/system/stats")
async def system_stats(current=Depends(get_current_user)):
    stats = get_system_stats()
    total = await db.projects.count_documents({})
    running = await db.projects.count_documents({"status": "running"})
    stopped = await db.projects.count_documents({"status": "stopped"})
    errored = await db.projects.count_documents({"status": "error"})
    stats["projects"] = {
        "total": total,
        "running": running,
        "stopped": stopped,
        "error": errored,
    }
    stats["capabilities"] = engine.caps
    return stats


@api_router.get("/projects")
async def list_projects(current=Depends(get_current_user)):
    items = []
    async for doc in db.projects.find().sort("created_at", -1):
        items.append(project_public(Project.from_mongo(doc)))
    return items


@api_router.post("/projects")
async def create_project(body: ProjectCreate, current=Depends(get_current_user)):
    fields = body.model_dump()
    _validate_project_fields(fields)
    slug = slugify(body.name)
    await _check_project_conflicts(slug, (body.domain or "").strip() or None, body.backend_port, body.frontend_port)

    be, fe = await _next_ports()
    project = Project(
        name=body.name,
        slug=slug,
        repo_url=body.repo_url,
        branch=body.branch or "main",
        domain=body.domain,
        ssl_mode=body.ssl_mode or "none",
        ssl_cert_path=body.ssl_cert_path,
        ssl_key_path=body.ssl_key_path,
        ssl_email=body.ssl_email,
        db_name=body.db_name or f"{slug}_db",
        backend_port=body.backend_port or be,
        frontend_port=body.frontend_port or fe,
        env_vars=body.env_vars or [],
        status="created",
    )
    if body.github_token:
        project.github_token_enc = encrypt_token(body.github_token)

    res = await db.projects.insert_one(project.to_mongo())
    project.id = str(res.inserted_id)
    return project_public(project)


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return project_public(project)


@api_router.put("/projects/{project_id}")
async def update_project(
    project_id: str, body: ProjectUpdate, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    update = body.model_dump(exclude_unset=True)

    effective = project.model_dump()
    for k, val in update.items():
        effective[k] = val
    _validate_project_fields(effective)

    new_slug = slugify(effective["name"])
    await _check_project_conflicts(
        new_slug,
        (effective.get("domain") or "").strip() or None,
        effective.get("backend_port"),
        effective.get("frontend_port"),
        exclude_id=project_id,
    )
    if "name" in update:
        update["slug"] = new_slug

    if "github_token" in update:
        token = update.pop("github_token")
        if token:
            update["github_token_enc"] = encrypt_token(token)
    if "env_vars" in update and update["env_vars"] is not None:
        update["env_vars"] = [e if isinstance(e, dict) else e.model_dump() for e in update["env_vars"]]
        # Refresh the cached env badge from the last scan (no re-clone needed).
        if project.env_required:
            provided = {e["key"] for e in update["env_vars"]}
            update["env_missing_required"] = engine.compute_missing_required(project.env_required, provided)
    update["updated_at"] = now_iso()
    await db.projects.update_one({"_id": ObjectId(project_id)}, {"$set": update})
    return project_public(await _get_project_or_404(project_id))


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    await engine.destroy(project)
    await db.projects.delete_one({"_id": ObjectId(project_id)})
    await db.deploy_logs.delete_many({"project_id": project_id})
    return {"ok": True}


@api_router.post("/projects/{project_id}/deploy")
async def deploy_project(
    project_id: str, background: BackgroundTasks, force: bool = False, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    if not force:
        scan = await engine.scan_env(project, token)
        blocking = scan.get("missing_required") or []
        if scan.get("scanned") and blocking:
            raise HTTPException(
                status_code=428,
                detail={
                    "message": f"{len(blocking)} variabel wajib masih kosong. Isi dulu atau deploy paksa.",
                    "missing_required": blocking,
                    "readme_defaults": scan.get("readme_defaults", {}),
                },
            )
    background.add_task(engine.deploy, project, token)
    return {"ok": True, "message": "Deployment started"}


@api_router.get("/projects/{project_id}/dns-check")
async def dns_check(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return await engine.dns_check(project)


@api_router.get("/projects/{project_id}/env-scan")
async def env_scan(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    return await engine.scan_env(project, token)


@api_router.post("/projects/scan-all")
async def scan_all_projects(current=Depends(get_current_user)):
    """Re-scan every project's env references and refresh the cached badge counts."""
    results = []
    async for doc in db.projects.find():
        project = Project.from_mongo(doc)
        token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
        try:
            scan = await engine.scan_env(project, token)
            results.append({
                "id": project.id,
                "name": project.name,
                "scanned": scan.get("scanned", False),
                "missing_required": scan.get("missing_required", []),
            })
        except Exception as e:
            results.append({"id": project.id, "name": project.name, "scanned": False, "error": str(e)})
    total_missing = sum(len(r.get("missing_required", [])) for r in results)
    return {"ok": True, "scanned": len(results), "total_missing": total_missing, "results": results}


@api_router.get("/projects/{project_id}/ssl-status")
async def project_ssl_status(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return await engine.ssl_status(project)


@api_router.get("/system/ssl-status")
async def all_ssl_status(current=Depends(get_current_user)):
    result: dict = {}
    async for doc in db.projects.find():
        project = Project.from_mongo(doc)
        result[str(doc["_id"])] = await engine.ssl_status(project)
    return result


@api_router.post("/projects/{project_id}/renew-ssl")
async def renew_ssl(
    project_id: str, background: BackgroundTasks, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    if project.ssl_mode != "letsencrypt":
        raise HTTPException(status_code=400, detail="Renew SSL only applies to Let's Encrypt mode")
    background.add_task(engine.renew_ssl, project)
    return {"ok": True, "message": "SSL renewal started"}


@api_router.post("/projects/{project_id}/{action}")
async def project_action(
    project_id: str,
    action: str,
    background: BackgroundTasks,
    current=Depends(get_current_user),
):
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="Invalid action")
    project = await _get_project_or_404(project_id)
    background.add_task(engine.lifecycle, project, action)
    return {"ok": True, "message": f"{action} started"}


@api_router.get("/projects/{project_id}/logs")
async def project_logs(project_id: str, current=Depends(get_current_user)):
    await _get_project_or_404(project_id)
    logs = []
    async for doc in db.deploy_logs.find({"project_id": project_id}).sort("created_at", -1).limit(10):
        doc["id"] = str(doc.pop("_id"))
        logs.append(doc)
    return logs


@api_router.get("/projects/{project_id}/container-logs")
async def container_logs(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    lines = await engine.container_logs(project)
    return {"lines": lines}


@api_router.get("/projects/{project_id}/health")
async def project_health(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return {"containers": await engine.container_health(project)}


@api_router.get("/system/containers-health")
async def all_containers_health(current=Depends(get_current_user)):
    result: dict = {}
    async for doc in db.projects.find():
        project = Project.from_mongo(doc)
        result[str(doc["_id"])] = await engine.container_health(project)
    return result


@api_router.get("/ops/info")
async def ops_info(current=Depends(get_current_user)):
    info = ops.ops_info()
    info["telegram_configured"] = telegram_configured()
    info["service"] = SERVICE_NAME
    return info


@api_router.get("/ops/backups")
async def ops_backups(current=Depends(get_current_user)):
    return ops.list_backups()


@api_router.post("/ops/backup")
async def ops_backup(current=Depends(get_current_user)):
    try:
        ops.run_script("backup.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Backup started"}


@api_router.post("/ops/rollback")
async def ops_rollback(current=Depends(get_current_user)):
    try:
        ops.run_script("rollback.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Rollback started (panel will restart)"}


@api_router.post("/ops/restore")
async def ops_restore(body: dict, current=Depends(get_current_user)):
    name = (body or {}).get("file", "")
    if not ops.valid_backup(name):
        raise HTTPException(status_code=400, detail="Unknown backup file")
    try:
        ops.run_script("restore.sh", os.path.join(ops.BACKUP_DIR, name))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Restore started (panel will restart)"}


@api_router.get("/ops/telegram")
async def ops_telegram(current=Depends(get_current_user)):
    return {"configured": telegram_configured()}


@api_router.post("/ops/telegram/test")
async def ops_telegram_test(current=Depends(get_current_user)):
    if not telegram_configured():
        raise HTTPException(status_code=400, detail="Telegram not configured")
    ok = send_telegram("\U0001f514 <b>Nexus Panel</b>\nTest notification — Telegram is connected.")
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send Telegram message (check token/chat id)")
    return {"ok": True, "message": "Test message sent"}


api_router.include_router(auth_router)
api_router.include_router(build_terminal_router(db, get_current_user))
app.include_router(api_router)


@app.websocket("/api/ws/terminal/local")
async def ws_terminal_local(websocket: WebSocket):
    await local_terminal_session(websocket, get_jwt_secret)


@app.websocket("/api/ws/terminal/ssh/{server_id}")
async def ws_terminal_ssh(websocket: WebSocket, server_id: str):
    await ssh_terminal_session(websocket, get_jwt_secret, db, server_id)


@app.websocket("/api/ws/projects/{project_id}/logs")
async def ws_logs(websocket: WebSocket, project_id: str):
    token = websocket.query_params.get("token")
    try:
        jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
    except Exception:
        await websocket.close(code=1008)
        return
    await websocket.accept()

    # send history of the most recent deploy log first
    doc = await db.deploy_logs.find_one(
        {"project_id": project_id}, sort=[("created_at", -1)]
    )
    if doc:
        for line in doc.get("lines", []):
            await websocket.send_json({"type": "line", "line": line})
        if doc.get("status") in ("success", "error"):
            await websocket.send_json({"type": "end", "status": doc["status"]})

    q = broker.subscribe(project_id)
    try:
        while True:
            event = await q.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        broker.unsubscribe(project_id, q)


@app.websocket("/api/ws/projects/{project_id}/container-logs")
async def ws_container_logs(websocket: WebSocket, project_id: str):
    token = websocket.query_params.get("token")
    try:
        jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
    except Exception:
        await websocket.close(code=1008)
        return
    await websocket.accept()

    try:
        doc = await db.projects.find_one({"_id": ObjectId(project_id)})
    except Exception:
        doc = None
    if not doc:
        await websocket.send_json({"type": "error", "message": "Project not found"})
        await websocket.close()
        return

    project = Project.from_mongo(doc)
    proc = await engine.open_container_log_stream(project)
    if proc is None:
        await websocket.send_json(
            {"type": "error", "message": "Docker not available or project not deployed on this host."}
        )
        await websocket.close()
        return

    try:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            await websocket.send_json(
                {"type": "line", "text": raw.decode(errors="replace").rstrip("\n")}
            )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        try:
            proc.kill()
        except Exception:
            pass

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------- restart-loop monitor --------
RESTART_MONITOR_INTERVAL = int(os.environ.get("RESTART_MONITOR_INTERVAL", "60"))
RESTART_THRESHOLD = int(os.environ.get("RESTART_THRESHOLD", "3"))
RESTART_WINDOW = int(os.environ.get("RESTART_WINDOW", "300"))
RESTART_ALERT_COOLDOWN = int(os.environ.get("RESTART_ALERT_COOLDOWN", "1800"))

_restart_last_count: dict = {}
_restart_events: dict = {}
_restart_last_alert: dict = {}


async def restart_loop_monitor():
    """Poll container restart counts and alert via Telegram on restart loops."""
    await asyncio.sleep(15)
    while True:
        try:
            async for doc in db.projects.find():
                project = Project.from_mongo(doc)
                stats = await engine.restart_stats(project)
                now = time.time()
                for c in stats:
                    name = c["name"]
                    count = c["restart_count"]
                    status = c["status"]
                    prev = _restart_last_count.get(name)
                    _restart_last_count[name] = count
                    events = _restart_events.setdefault(name, [])
                    if prev is not None and count > prev:
                        events.extend([now] * (count - prev))
                    if status == "restarting":
                        events.append(now)
                    cutoff = now - RESTART_WINDOW
                    events[:] = [t for t in events if t >= cutoff]
                    if len(events) >= RESTART_THRESHOLD:
                        last_alert = _restart_last_alert.get(name, 0)
                        if now - last_alert >= RESTART_ALERT_COOLDOWN:
                            _restart_last_alert[name] = now
                            text = (
                                f"\u26a0\ufe0f <b>{project.name}</b>\n"
                                f"Restart-loop terdeteksi pada container <code>{name}</code>: "
                                f"{len(events)}x dalam {RESTART_WINDOW // 60} menit (status: {status}).\n"
                                f"Cek Container Logs di panel untuk penyebabnya."
                            )
                            try:
                                await asyncio.to_thread(send_telegram, text)
                            except Exception:
                                pass
        except Exception as e:
            logger.warning("restart monitor: %s", e)
        await asyncio.sleep(RESTART_MONITOR_INTERVAL)


# --------------------------------------------- scheduled SSL auto-renew -----
SSL_RENEW_INTERVAL = int(os.environ.get("SSL_RENEW_INTERVAL", "86400"))


async def ssl_renew_scheduler():
    """Periodically run certbot renew (no-op unless a cert is near expiry)."""
    await asyncio.sleep(60)
    while True:
        try:
            if engine.caps.get("certbot"):
                rc, _out = await engine.auto_renew_certs()
                logger.info("scheduled SSL auto-renew rc=%s", rc)
        except Exception as e:
            logger.warning("ssl renew scheduler: %s", e)
        await asyncio.sleep(SSL_RENEW_INTERVAL)


# --------------------------------------------- scheduled env scan ----------
ENV_SCAN_INTERVAL = int(os.environ.get("ENV_SCAN_INTERVAL", "1800"))


async def env_scan_scheduler():
    """Periodically re-scan each project's env references so the dashboard badge stays accurate."""
    await asyncio.sleep(90)
    while True:
        try:
            if engine.caps.get("git"):
                async for doc in db.projects.find():
                    project = Project.from_mongo(doc)
                    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
                    try:
                        await engine.scan_env(project, token)
                    except Exception as e:
                        logger.warning("env scan (%s): %s", project.slug, e)
        except Exception as e:
            logger.warning("env scan scheduler: %s", e)
        await asyncio.sleep(ENV_SCAN_INTERVAL)


@app.on_event("startup")
async def on_startup():
    await seed_admin(db)
    try:
        await db.users.create_index("username", unique=True)
        await db.projects.create_index("slug", unique=True)
        await db.deploy_logs.create_index("project_id")
        await db.login_attempts.create_index("identifier", unique=True)
    except Exception as e:
        logger.warning("index creation: %s", e)
    await seed_default_commands(db)
    app.state.monitor_task = asyncio.create_task(restart_loop_monitor())
    app.state.renew_task = asyncio.create_task(ssl_renew_scheduler())
    app.state.env_scan_task = asyncio.create_task(env_scan_scheduler())
    logger.info("Panel started. Capabilities: %s", engine.caps)


@app.on_event("shutdown")
async def on_shutdown():
    for attr in ("monitor_task", "renew_task", "env_scan_task"):
        task = getattr(app.state, attr, None)
        if task:
            task.cancel()
    client.close()
