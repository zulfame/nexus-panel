import logging
import os
import asyncio
import time
import hmac
import hashlib
import json
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from bson import ObjectId  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402
import jwt  # noqa: E402
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request  # noqa: E402
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
    BrandingUpdate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    now_iso,
    project_public,
)
from audit import log_event  # noqa: E402
import ops  # noqa: E402
from db_manager import build_databases_router, DBManager  # noqa: E402
from notifications import send_telegram, telegram_configured  # noqa: E402
from system_stats import get_system_stats  # noqa: E402
from system_stats import disk_guard as _disk_guard  # noqa: E402
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

app = FastAPI(
    title="Nexus Panel API",
    version="1.9.0",
    description="Self-hosted deployment control panel (mini-PaaS) API.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
api_router = APIRouter(prefix="/api")

broker = LogBroker()
engine = DeployEngine(db, broker)
auth_router, get_current_user, require_role = build_auth_router(db)

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


def _require_disk():
    """Block disk-heavy operations (deploy/backup) when free space is critically low."""
    ok, _s, lim = _disk_guard()
    if not ok:
        raise HTTPException(
            status_code=507,
            detail=(
                f"Insufficient disk space: only {lim['free_mb']} MB / {lim['free_pct']}% free "
                f"(need ≥ {lim['min_mb']} MB and ≥ {lim['min_pct']}%). "
                "Free up space (old backups, docker images) and try again."
            ),
        )


def _validate_project_fields(v: dict):
    """Validate the effective (merged) project field values. Raises HTTP 400 on error."""
    name = (v.get("name") or "").strip()
    if not name:
        _err("Project name is required.")
    if len(name) > 60:
        _err("Project name must be at most 60 characters.")

    repo = (v.get("repo_url") or "").strip()
    if not repo:
        _err("GitHub repository URL is required.")
    if not _REPO_RE.match(repo):
        _err("Invalid repository URL. Example: https://github.com/user/repo.git")

    branch = (v.get("branch") or "main").strip()
    if " " in branch:
        _err("Branch name must not contain spaces.")

    ssl_mode = v.get("ssl_mode") or "none"
    if ssl_mode not in _SSL_MODES:
        _err("SSL mode must be one of: none, letsencrypt, custom.")

    domain = (v.get("domain") or "").strip()
    if domain and not _DOMAIN_RE.match(domain):
        _err(f"Domain '{domain}' is invalid. Example: app.mydomain.com")

    if ssl_mode == "letsencrypt":
        if not domain:
            _err("Let's Encrypt SSL requires a valid domain.")
        email = (v.get("ssl_email") or "").strip()
        if email and not _EMAIL_RE.match(email):
            _err("Invalid Let's Encrypt email.")

    if ssl_mode == "custom":
        cert = (v.get("ssl_cert_path") or "").strip()
        key = (v.get("ssl_key_path") or "").strip()
        if not cert or not key:
            _err("Custom SSL requires both a Certificate and Private Key path.")
        if not cert.startswith("/") or not key.startswith("/"):
            _err("Certificate/key paths must be absolute (starting with '/').")

    db_name = (v.get("db_name") or "").strip()
    if db_name and not _DB_RE.match(db_name):
        _err("Database name may only contain letters, digits, '-' and '_' (max 63 characters).")

    for label, port in (("backend", v.get("backend_port")), ("frontend", v.get("frontend_port"))):
        if port is not None:
            if not isinstance(port, int) or port < 1024 or port > 65535:
                _err(f"{label.capitalize()} port must be a number between 1024–65535.")

    env_vars = v.get("env_vars") or []
    seen = set()
    for e in env_vars:
        key = (e.get("key") if isinstance(e, dict) else getattr(e, "key", "")) or ""
        key = key.strip()
        if not key:
            continue
        if not _ENV_KEY_RE.match(key):
            _err(f"Env var '{key}' is invalid. Use letters/digits/underscore and do not start with a digit.")
        if key in seen:
            _err(f"Env var '{key}' is duplicated.")
        seen.add(key)


async def _check_project_conflicts(
    slug: str, domain: Optional[str], be: Optional[int], fe: Optional[int], exclude_id: Optional[str] = None
):
    """Ensure slug/domain/ports don't clash with another project. Raises HTTP 409."""
    def _not_self(doc):
        return exclude_id is None or str(doc["_id"]) != exclude_id

    existing = await db.projects.find_one({"slug": slug})
    if existing and _not_self(existing):
        raise HTTPException(status_code=409, detail=f"A project named '{slug}' already exists.")

    if domain:
        dclash = await db.projects.find_one({"domain": domain})
        if dclash and _not_self(dclash):
            raise HTTPException(status_code=409, detail=f"Domain '{domain}' is already used by another project.")

    if be is not None:
        c = await db.projects.find_one({"backend_port": be})
        if c and _not_self(c):
            raise HTTPException(status_code=409, detail=f"Backend port {be} is already used by another project.")
    if fe is not None:
        c = await db.projects.find_one({"frontend_port": fe})
        if c and _not_self(c):
            raise HTTPException(status_code=409, detail=f"Frontend port {fe} is already used by another project.")


# ------------------------------------------------------------- routes -------
@api_router.get("/")
async def root():
    return {"message": "Emergent Deploy Panel API"}


@api_router.get("/capabilities")
async def capabilities(current=Depends(get_current_user)):
    return engine.refresh_caps()


BRANDING_DEFAULTS = {"system_name": "NEXUS.PANEL", "tagline": "deploy control", "logo": "", "favicon": "", "primary_color": "#3b82f6"}

_HEX_COLOR_RE = _re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


@api_router.get("/settings/branding")
async def get_branding():
    """Public — used by the login page and to set the favicon/title before auth."""
    doc = await db.settings.find_one({"_id": "branding"})
    if not doc:
        return BRANDING_DEFAULTS
    doc.pop("_id", None)
    return {**BRANDING_DEFAULTS, **doc}


@api_router.put("/settings/branding")
async def update_branding(body: BrandingUpdate, current=Depends(get_current_user)):
    update = body.model_dump(exclude_unset=True)
    for k in ("logo", "favicon"):
        if update.get(k) and len(update[k]) > 3_000_000:
            raise HTTPException(status_code=413, detail=f"{k} terlalu besar (maks ~2MB).")
    if "primary_color" in update and update["primary_color"]:
        if not _HEX_COLOR_RE.match(update["primary_color"].strip()):
            raise HTTPException(status_code=400, detail="primary_color must be a hex color like #3b82f6.")
        update["primary_color"] = update["primary_color"].strip().lower()
    if not update:
        raise HTTPException(status_code=400, detail="No changes.")
    await db.settings.update_one({"_id": "branding"}, {"$set": update}, upsert=True)
    await log_event(db, current["username"], "branding.update", meta={"fields": list(update.keys())})
    doc = await db.settings.find_one({"_id": "branding"})
    doc.pop("_id", None)
    return {**BRANDING_DEFAULTS, **doc}


@api_router.get("/settings/telegram")
async def get_telegram(current=Depends(get_current_user)):
    doc = await db.settings.find_one({"_id": "telegram"}) or {}
    return {
        "token_set": bool(os.environ.get("TELEGRAM_BOT_TOKEN")),
        "chat_id": doc.get("chat_id", os.environ.get("TELEGRAM_CHAT_ID", "")),
        "thread_id": doc.get("thread_id", os.environ.get("TELEGRAM_THREAD_ID", "")),
        "configured": telegram_configured(),
    }


@api_router.put("/settings/telegram")
async def update_telegram(body: dict, current=Depends(get_current_user)):
    bot_token = (body.get("bot_token") or "").strip()
    chat_id = (body.get("chat_id") or "").strip()
    thread_id = (body.get("thread_id") or "").strip()
    update = {"chat_id": chat_id, "thread_id": thread_id}
    if bot_token:  # only overwrite the token when a new one is provided
        from secrets_crypto import encrypt_value
        update["bot_token"] = encrypt_value(bot_token)
    await db.settings.update_one({"_id": "telegram"}, {"$set": update}, upsert=True)
    doc = await db.settings.find_one({"_id": "telegram"}) or {}
    _apply_telegram_env(doc)
    await log_event(db, current["username"], "telegram.update")
    return {"configured": telegram_configured(), "token_set": bool(os.environ.get("TELEGRAM_BOT_TOKEN")),
            "chat_id": chat_id, "thread_id": thread_id}


def _apply_telegram_env(doc: dict):
    """Push saved Telegram settings into the process env so notifications.py picks them up."""
    if doc.get("bot_token"):
        from secrets_crypto import decrypt_value
        os.environ["TELEGRAM_BOT_TOKEN"] = decrypt_value(doc["bot_token"])
    if doc.get("chat_id"):
        os.environ["TELEGRAM_CHAT_ID"] = doc["chat_id"]
    else:
        os.environ.pop("TELEGRAM_CHAT_ID", None)
    if doc.get("thread_id"):
        os.environ["TELEGRAM_THREAD_ID"] = doc["thread_id"]
    else:
        os.environ.pop("TELEGRAM_THREAD_ID", None)


@api_router.get("/audit")
async def audit_list(limit: int = 50, skip: int = 0, action: str = "", q: str = "", current=Depends(get_current_user)):
    query: dict = {}
    if action:
        query["action"] = action
    if q:
        query["$or"] = [
            {"actor": {"$regex": q, "$options": "i"}},
            {"target": {"$regex": q, "$options": "i"}},
            {"action": {"$regex": q, "$options": "i"}},
        ]
    limit = min(max(limit, 1), 200)
    skip = max(skip, 0)
    total = await db.audit_logs.count_documents(query)
    out = []
    async for d in db.audit_logs.find(query).sort("ts", -1).skip(skip).limit(limit):
        d.pop("_id", None)
        out.append(d)
    return {"items": out, "total": total, "limit": limit, "skip": skip}


@api_router.get("/audit/verify")
async def audit_verify(current=Depends(get_current_user)):
    from audit import verify_chain
    return await verify_chain(db)


@api_router.get("/audit/export")
async def audit_export(format: str = "json", action: str = "", q: str = "", current=Depends(get_current_user)):
    import csv
    import io
    from fastapi.responses import Response

    query: dict = {}
    if action:
        query["action"] = action
    if q:
        query["$or"] = [
            {"actor": {"$regex": q, "$options": "i"}},
            {"target": {"$regex": q, "$options": "i"}},
            {"action": {"$regex": q, "$options": "i"}},
        ]
    rows = []
    async for d in db.audit_logs.find(query).sort("ts", -1).limit(50000):
        d.pop("_id", None)
        rows.append(d)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ts", "actor", "action", "target", "seq", "hash", "prev_hash", "meta"])
        for d in rows:
            w.writerow([
                d.get("ts", ""), d.get("actor", ""), d.get("action", ""), d.get("target", ""),
                d.get("seq", ""), d.get("hash", ""), d.get("prev_hash", ""),
                json.dumps(d.get("meta", {}), default=str),
            ])
        return Response(
            content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="audit-{stamp}.csv"'},
        )
    return Response(
        content=json.dumps(rows, default=str, indent=2), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="audit-{stamp}.json"'},
    )


@api_router.get("/projects/{project_id}/metrics")
async def project_metrics(project_id: str, minutes: int = 60, current=Depends(get_current_user)):
    await _get_project_or_404(project_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=min(max(minutes, 1), 4320))).isoformat()
    out = []
    async for d in db.metrics.find({"project_id": project_id, "ts": {"$gte": cutoff}}).sort("ts", 1):
        out.append({"ts": d["ts"], "stats": d.get("stats", [])})
    return {"points": out}


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
        environment=(body.environment or "").strip() or None,
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
    project.webhook_id = secrets.token_urlsafe(20)
    project.webhook_secret = secrets.token_urlsafe(32)

    res = await db.projects.insert_one(project.to_mongo())
    project.id = str(res.inserted_id)
    await log_event(db, current["username"], "project.create", target=project.name)
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
        # Encrypt secret values at rest.
        from secrets_crypto import encrypt_env_list
        update["env_vars"] = encrypt_env_list(update["env_vars"])
    update["updated_at"] = now_iso()
    await db.projects.update_one({"_id": ObjectId(project_id)}, {"$set": update})
    await log_event(db, current["username"], "project.update", target=project.name)
    return project_public(await _get_project_or_404(project_id))


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current=Depends(require_role("admin"))):
    project = await _get_project_or_404(project_id)
    await engine.destroy(project)
    await db.projects.delete_one({"_id": ObjectId(project_id)})
    await db.deploy_logs.delete_many({"project_id": project_id})
    await db.metrics.delete_many({"project_id": project_id})
    await db.deploy_history.delete_many({"project_id": project_id})
    await db.webhook_events.delete_many({"project_id": project_id})
    await db.webhook_deliveries.delete_many({"project_id": project_id})
    try:
        db_manager.cleanup_project(project.slug)
    except Exception:
        pass
    await log_event(db, current["username"], "project.delete", target=project.name)
    return {"ok": True}


@api_router.post("/projects/{project_id}/deploy")
async def deploy_project(
    project_id: str, background: BackgroundTasks, force: bool = False,
    body: Optional[dict] = None, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    note = ((body or {}).get("note") or "").strip()[:280]
    _require_disk()
    if not force:
        scan = await engine.scan_env(project, token)
        blocking = scan.get("missing_required") or []
        if scan.get("scanned") and blocking:
            raise HTTPException(
                status_code=428,
                detail={
                    "message": f"{len(blocking)} required variable(s) are still empty. Fill them in first or force deploy.",
                    "missing_required": blocking,
                    "readme_defaults": scan.get("readme_defaults", {}),
                },
            )
    background.add_task(engine.deploy, project, token, None, "deploy", note)
    await log_event(db, current["username"], "project.deploy", target=project.name, meta={"force": force})
    return {"ok": True, "message": "Deployment started"}


@api_router.get("/projects/{project_id}/updates")
async def project_updates(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    result = await engine.check_updates(project, token)
    if result.get("checked") and result.get("cloned"):
        await db.projects.update_one(
            {"_id": __import__("bson").ObjectId(project.id)},
            {"$set": {
                "updates_behind": result.get("behind", 0),
                "updates_checked_at": datetime.now(timezone.utc).isoformat(),
                "current_commit": result.get("current"),
                "remote_commit": result.get("remote"),
            }},
        )
    return result


@api_router.post("/projects/check-all-updates")
async def check_all_updates(current=Depends(get_current_user)):
    """Check every deployed project against its remote branch and refresh cached badges."""
    results = []
    async for doc in db.projects.find():
        project = Project.from_mongo(doc)
        token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
        try:
            r = await engine.check_updates(project, token)
            if r.get("checked") and r.get("cloned"):
                await db.projects.update_one(
                    {"_id": __import__("bson").ObjectId(project.id)},
                    {"$set": {
                        "updates_behind": r.get("behind", 0),
                        "updates_checked_at": datetime.now(timezone.utc).isoformat(),
                        "current_commit": r.get("current"),
                        "remote_commit": r.get("remote"),
                    }},
                )
            results.append({"id": project.id, "name": project.name, "behind": r.get("behind", 0), "cloned": r.get("cloned", False)})
        except Exception as e:
            results.append({"id": project.id, "name": project.name, "error": str(e)})
    total_behind = sum(r.get("behind", 0) for r in results)
    return {"ok": True, "checked": len(results), "total_behind": total_behind, "results": results}


@api_router.get("/projects/{project_id}/history")
async def project_history(project_id: str, limit: int = 50, current=Depends(get_current_user)):
    await _get_project_or_404(project_id)
    limit = min(max(limit, 1), 100)
    out = []
    async for d in db.deploy_history.find({"project_id": project_id}).sort("started_at", -1).limit(limit):
        d.pop("_id", None)
        out.append(d)
    return out


@api_router.post("/projects/{project_id}/rollback")
async def rollback_project(
    project_id: str, body: dict, background: BackgroundTasks, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    commit = (body or {}).get("commit", "").strip()
    if not commit:
        raise HTTPException(status_code=400, detail="commit is required")
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    background.add_task(engine.deploy, project, token, commit, "rollback", f"Rollback to {commit[:7]}")
    await log_event(db, current["username"], "project.rollback", target=project.name, meta={"commit": commit})
    return {"ok": True, "message": f"Rollback to {commit[:7]} started"}


@api_router.get("/projects/{project_id}/diff")
async def project_diff(project_id: str, base: str = "", head: str = "", current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return await engine.git_diff(project, base or None, head or None)


# --------------------------------------------- auto-deploy webhook ---------
def _webhook_url(request: Request, webhook_id: str) -> str:
    """Build the public webhook URL from the incoming request's host."""
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/webhooks/github/{webhook_id}"


@api_router.get("/projects/{project_id}/webhook")
async def get_webhook(project_id: str, request: Request, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    if not project.webhook_id or not project.webhook_secret:
        project.webhook_id = project.webhook_id or secrets.token_urlsafe(20)
        project.webhook_secret = project.webhook_secret or secrets.token_urlsafe(32)
        await db.projects.update_one(
            {"_id": ObjectId(project.id)},
            {"$set": {"webhook_id": project.webhook_id, "webhook_secret": project.webhook_secret}},
        )
    return {
        "enabled": project.auto_deploy_enabled,
        "webhook_id": project.webhook_id,
        "secret": project.webhook_secret,
        "url": _webhook_url(request, project.webhook_id),
        "path": f"/api/webhooks/github/{project.webhook_id}",
        "branch": project.branch,
    }


@api_router.post("/projects/{project_id}/webhook/regenerate")
async def regenerate_webhook(project_id: str, request: Request, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    wid = secrets.token_urlsafe(20)
    sec = secrets.token_urlsafe(32)
    await db.projects.update_one(
        {"_id": ObjectId(project.id)},
        {"$set": {"webhook_id": wid, "webhook_secret": sec}},
    )
    await log_event(db, current["username"], "project.webhook.regenerate", target=project.name)
    return {"enabled": project.auto_deploy_enabled, "webhook_id": wid, "secret": sec, "url": _webhook_url(request, wid), "path": f"/api/webhooks/github/{wid}", "branch": project.branch}


async def _set_webhook_event(event_id, result: str):
    if event_id:
        try:
            await db.webhook_events.update_one({"_id": event_id}, {"$set": {"result": result}})
        except Exception:
            pass


async def _auto_deploy(project: Project, token: Optional[str], event_id=None):
    """Auto-deploy triggered by a webhook — skips (with a Telegram alert) if required env is missing."""
    try:
        scan = await engine.scan_env(project, token)
        blocking = scan.get("missing_required") or []
        if scan.get("scanned") and blocking:
            msg = f"{len(blocking)} required env var(s) missing: {', '.join(blocking[:10])}"
            await db.projects.update_one(
                {"_id": ObjectId(project.id)},
                {"$set": {"last_message": f"Auto-deploy skipped — {msg}"}},
            )
            await _set_webhook_event(event_id, "skipped: env missing")
            try:
                await asyncio.to_thread(
                    send_telegram,
                    f"\u26a0\ufe0f <b>{project.name}</b>\nAuto-deploy skipped after push.\n{msg}",
                )
            except Exception:
                pass
            return
        await engine.deploy(project, token, None, "deploy", "Auto-deploy from webhook push")
        # reflect the deploy outcome recorded on the project
        fresh = await db.projects.find_one({"_id": ObjectId(project.id)})
        await _set_webhook_event(event_id, "deployed" if fresh and fresh.get("status") == "running" else "deploy failed")
    except Exception as e:
        await _set_webhook_event(event_id, "error")
        logger.warning("auto-deploy (%s): %s", project.slug, e)


@api_router.get("/projects/{project_id}/webhook-events")
async def webhook_events(project_id: str, limit: int = 20, current=Depends(get_current_user)):
    await _get_project_or_404(project_id)
    limit = min(max(limit, 1), 50)
    out = []
    async for d in db.webhook_events.find({"project_id": project_id}).sort("ts", -1).limit(limit):
        d.pop("_id", None)
        d["ts"] = d["ts"].isoformat() if isinstance(d.get("ts"), datetime) else d.get("ts")
        out.append(d)
    return out


@api_router.post("/webhooks/github/{webhook_id}")
async def github_webhook(webhook_id: str, request: Request, background: BackgroundTasks):
    """Public endpoint hit by GitHub on push. No user auth — verified via HMAC signature."""
    doc = await db.projects.find_one({"webhook_id": webhook_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown webhook")
    project = Project.from_mongo(doc)

    raw = await request.body()
    secret = project.webhook_secret or ""
    sig = request.headers.get("X-Hub-Signature-256")
    if secret:
        if not sig:
            raise HTTPException(status_code=403, detail="Missing signature")
        expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=403, detail="Invalid signature")

    event = request.headers.get("X-GitHub-Event", "")
    delivery = request.headers.get("X-GitHub-Delivery", "")
    if event == "ping":
        return {"ok": True, "message": "pong"}
    if event != "push":
        return {"ok": True, "ignored": event}

    if delivery:
        try:
            await db.webhook_deliveries.insert_one({
                "delivery_id": delivery,
                "project_id": project.id,
                "ts": datetime.now(timezone.utc),
            })
        except DuplicateKeyError:
            return {"ok": True, "deduped": True}

    if not project.auto_deploy_enabled:
        return {"ok": True, "ignored": "auto-deploy disabled"}

    payload = json.loads(raw or b"{}")
    ref = payload.get("ref", "")
    branch = ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else ref
    if branch != project.branch:
        return {"ok": True, "ignored": f"branch {branch or '?'} != {project.branch}"}

    head = payload.get("head_commit") or {}
    commit = None
    if head.get("id"):
        commit = {
            "short": head["id"][:7],
            "hash": head["id"],
            "message": head.get("message", ""),
            "author": (head.get("author") or {}).get("name", ""),
        }
    ev = await db.webhook_events.insert_one({
        "project_id": project.id,
        "ts": datetime.now(timezone.utc),
        "delivery": delivery,
        "branch": branch,
        "commit": commit,
        "pusher": (payload.get("pusher") or {}).get("name", ""),
        "result": "deploying",
    })
    # keep only the latest 50 events per project
    olds = db.webhook_events.find({"project_id": project.id}, {"_id": 1}).sort("ts", -1).skip(50)
    old_ids = [d["_id"] async for d in olds]
    if old_ids:
        await db.webhook_events.delete_many({"_id": {"$in": old_ids}})

    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    background.add_task(_auto_deploy, project, token, ev.inserted_id)
    await log_event(db, "github-webhook", "project.deploy", target=project.name, meta={"auto": True, "delivery": delivery})
    return {"ok": True, "queued": True}


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


async def _check_domain_reachable(domain: str) -> dict:
    """Probe a project's public domain over HTTPS then HTTP. Reachable = any HTTP response."""
    import httpx as _httpx
    import time as _t
    if not domain:
        return {"domain": None, "reachable": None, "status": None, "scheme": None, "latency_ms": None, "error": "no domain"}
    last_err = None
    for scheme in ("https", "http"):
        try:
            start = _t.monotonic()
            async with _httpx.AsyncClient(verify=False, follow_redirects=True, timeout=4.0) as client:
                resp = await client.get(f"{scheme}://{domain}", headers={"User-Agent": "NexusPanel-HealthCheck"})
            return {
                "domain": domain,
                "reachable": True,
                "status": resp.status_code,
                "scheme": scheme,
                "latency_ms": int((_t.monotonic() - start) * 1000),
                "error": None,
            }
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            continue
    return {"domain": domain, "reachable": False, "status": None, "scheme": None, "latency_ms": None, "error": last_err or "unreachable"}


@api_router.get("/projects/{project_id}/domain-health")
async def project_domain_health(project_id: str, current=Depends(get_current_user)):
    project = await _get_project_or_404(project_id)
    return await _check_domain_reachable((project.domain or "").strip())


@api_router.get("/system/domains-health")
async def all_domains_health(current=Depends(get_current_user)):
    projects = [Project.from_mongo(doc) async for doc in db.projects.find()]

    async def _one(p):
        return str(p.id), await _check_domain_reachable((p.domain or "").strip())

    results = await asyncio.gather(*[_one(p) for p in projects]) if projects else []
    return {pid: res for pid, res in results}


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
    await log_event(db, current["username"], f"project.{action}", target=project.name)
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


@api_router.get("/system/panel-info")
async def panel_info(current=Depends(get_current_user)):
    import platform as _platform
    os_name = "Unknown"
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        os_name = _platform.system() or "Unknown"
    return {
        "version": os.environ.get("PANEL_VERSION", "1.10.0"),
        "build": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "docker": bool(engine.caps.get("docker")),
        "server_os": os_name,
        "operational": True,
    }


@api_router.get("/system/changelog")
async def system_changelog(current=Depends(get_current_user)):
    """Parse CHANGELOG.md into structured releases for the in-app Change Logs modal."""
    from pathlib import Path as _Path
    import re as _re

    candidates = [
        _Path(__file__).resolve().parent.parent / "CHANGELOG.md",
        _Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel")) / "current" / "CHANGELOG.md",
    ]
    path = next((p for p in candidates if p.is_file()), None)
    if not path:
        return {"releases": []}

    releases: list = []
    cur_rel = None
    cur_sec = None
    rel_re = _re.compile(r"^##\s*\[([^\]]+)\](?:\s*[—\-–]+\s*([0-9][0-9\-]*))?\s*(?:·\s*(.*))?$")

    def _clean(t: str) -> str:
        return t.replace("**", "").replace("`", "")

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.rstrip()
        m = rel_re.match(line.strip())
        if m:
            cur_rel = {"version": m.group(1), "date": (m.group(2) or "").strip(), "title": _clean((m.group(3) or "").strip()), "sections": []}
            releases.append(cur_rel)
            cur_sec = None
            continue
        if line.startswith("### ") and cur_rel is not None:
            cur_sec = {"type": line[4:].strip(), "items": []}
            cur_rel["sections"].append(cur_sec)
            continue
        stripped = line.lstrip()
        if stripped.startswith("- ") and cur_sec is not None:
            cur_sec["items"].append(_clean(stripped[2:].strip()))
        elif stripped and cur_sec is not None and cur_sec["items"] and not line.startswith("#") and (raw.startswith(" ") or raw.startswith("\t")):
            cur_sec["items"][-1] += " " + _clean(stripped)
    return {"releases": releases}


@api_router.get("/system/containers-health")
async def all_containers_health(current=Depends(get_current_user)):
    result: dict = {}
    async for doc in db.projects.find():
        project = Project.from_mongo(doc)
        result[str(doc["_id"])] = await engine.container_health(project)
    return result


@api_router.get("/system/containers-stats")
async def all_containers_stats(current=Depends(get_current_user)):
    """Aggregated live CPU%/RAM(MB) per running project (empty when Docker unavailable)."""
    result: dict = {}
    async for doc in db.projects.find({"status": "running"}):
        project = Project.from_mongo(doc)
        stats = await engine.container_stats(project)
        if not stats:
            continue
        result[str(doc["_id"])] = {
            "cpu": round(sum(s.get("cpu", 0) for s in stats), 1),
            "mem_mb": round(sum(s.get("mem_mb", 0) for s in stats)),
            "containers": len(stats),
        }
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
async def ops_backup(current=Depends(require_role("admin"))):
    _require_disk()
    try:
        ops.run_script("backup.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Backup started"}


@api_router.post("/ops/rollback")
async def ops_rollback(current=Depends(require_role("admin"))):
    try:
        ops.run_script("rollback.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Rollback started (panel will restart)"}


@api_router.post("/ops/update")
async def ops_update(current=Depends(require_role("admin"))):
    try:
        ops.run_script("update.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await log_event(db, current["username"], "panel.update")
    return {"ok": True, "message": "Update started (panel will pull the latest release & rebuild)"}


@api_router.post("/ops/fix")
async def ops_fix(current=Depends(require_role("admin"))):
    try:
        ops.run_script("repair.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await log_event(db, current["username"], "panel.fix")
    return {"ok": True, "message": "Repair started (rebuilding the current release — version unchanged)"}


@api_router.get("/ops/repair-log")
async def ops_repair_log(current=Depends(get_current_user)):
    from pathlib import Path as _Path
    log_path = _Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel")) / "repair.log"
    if not log_path.is_file():
        return {"log": "", "running": False, "done": False, "exists": False}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    done = "__REPAIR_END__" in text
    rc = None
    if done:
        try:
            rc = int(text.rsplit("__REPAIR_END__ rc=", 1)[1].split()[0])
        except Exception:
            rc = None
    import time as _t
    age = int(_t.time() - log_path.stat().st_mtime)
    return {"log": text, "running": not done, "done": done, "rc": rc, "exists": True, "age": age}


@api_router.get("/ops/update-log")
async def ops_update_log(current=Depends(get_current_user)):
    from pathlib import Path as _Path
    log_path = _Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel")) / "update.log"
    if not log_path.is_file():
        return {"log": "", "running": False, "done": False, "exists": False}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    done = "__UPDATE_END__" in text
    rc = None
    if done:
        try:
            rc = int(text.rsplit("__UPDATE_END__ rc=", 1)[1].split()[0])
        except Exception:
            rc = None
    import time as _t
    age = int(_t.time() - log_path.stat().st_mtime)
    return {"log": text, "running": not done, "done": done, "rc": rc, "exists": True, "age": age}


@api_router.post("/ops/install-db-tools")
async def ops_install_db_tools(current=Depends(require_role("admin"))):
    try:
        ops.run_script("install-db-tools.sh")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await log_event(db, current["username"], "database.tools.install")
    return {"ok": True, "message": "Installing MongoDB database tools…"}


@api_router.get("/ops/db-tools-log")
async def ops_db_tools_log(current=Depends(get_current_user)):
    from pathlib import Path as _Path
    log_path = _Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel")) / "db-tools-install.log"
    if not log_path.is_file():
        return {"log": "", "running": False, "done": False, "exists": False}
    text = log_path.read_text(encoding="utf-8", errors="replace")
    done = "__DBTOOLS_END__" in text
    rc = None
    if done:
        try:
            rc = int(text.rsplit("__DBTOOLS_END__ rc=", 1)[1].split()[0])
        except Exception:
            rc = None
    import time as _t
    age = int(_t.time() - log_path.stat().st_mtime)
    return {"log": text, "running": not done, "done": done, "rc": rc, "exists": True, "age": age}


_panel_updates_cache = {"ts": 0.0, "data": None}


@api_router.get("/system/panel-updates")
async def system_panel_updates(force: bool = False, current=Depends(get_current_user)):
    import time as _t
    now = _t.time()
    if not force and _panel_updates_cache["data"] and now - _panel_updates_cache["ts"] < 300:
        return _panel_updates_cache["data"]
    data = await asyncio.to_thread(ops.check_panel_updates)
    _panel_updates_cache.update(ts=now, data=data)
    return data


@api_router.post("/ops/restart")
async def ops_restart(body: dict, current=Depends(get_current_user)):
    target = (body or {}).get("target", "panel")
    if not ops.scripts_available():
        raise HTTPException(status_code=400, detail="Server operations run on the VPS install.")
    if target == "server":
        await log_event(db, current["username"], "server.restart")
        ops.restart_server()
        return {"ok": True, "message": "Server is rebooting…"}
    await log_event(db, current["username"], "panel.restart")
    ops.restart_panel()
    return {"ok": True, "message": "Panel is restarting…"}


@api_router.post("/ops/restore")
async def ops_restore(body: dict, current=Depends(require_role("admin"))):
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
databases_router, db_manager = build_databases_router(db, get_current_user, _get_project_or_404)
api_router.include_router(databases_router)
app.include_router(api_router)


@app.websocket("/api/ws/terminal/local")
async def ws_terminal_local(websocket: WebSocket):
    await local_terminal_session(websocket, get_jwt_secret, db)


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


# ---------------------------------------------- API rate limiting ----------
# Lightweight per-IP sliding-window limiter (single-process panel). Protects every /api route
# from abuse/DoS on top of the login brute-force lockout. WebSockets bypass HTTP middleware.
from collections import deque as _deque  # noqa: E402
from starlette.responses import JSONResponse as _JSONResponse  # noqa: E402

RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "600"))
_rate_buckets: dict = {}


def _req_ip(request: Request) -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api") or path.startswith("/api/ws"):
        return await call_next(request)
    ip = _req_ip(request)
    now = time.time()
    dq = _rate_buckets.setdefault(ip, _deque())
    cutoff = now - 60
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= RATE_LIMIT_PER_MIN:
        return _JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded — too many requests. Please slow down."},
        )
    dq.append(now)
    return await call_next(request)


# ---------------------------------------------- RBAC: viewer read-only ------
# Viewers get read-only access: any mutating request (POST/PUT/PATCH/DELETE) is rejected unless
# it's a self-service auth action. Higher tiers are gated per-route via require_role(...).
import jwt as _jwt  # noqa: E402

_VIEWER_ALLOWED_MUTATIONS = (
    "/api/auth/login", "/api/auth/logout", "/api/auth/logout-all",
    "/api/auth/change-password", "/api/auth/2fa", "/api/webhooks/",
)


@app.middleware("http")
async def viewer_readonly_middleware(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api"):
        path = request.url.path
        if not any(path.startswith(p) for p in _VIEWER_ALLOWED_MUTATIONS):
            auth_header = request.headers.get("Authorization", "")
            token = auth_header[7:] if auth_header.startswith("Bearer ") else None
            if token:
                try:
                    payload = _jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
                    u = await db.users.find_one({"username": payload.get("sub")}, {"role": 1})
                    if u and (u.get("role") or "viewer").lower() == "viewer":
                        return _JSONResponse(
                            status_code=403,
                            content={"detail": "Read-only access: your Viewer role cannot perform this action."},
                        )
                except Exception:
                    pass  # invalid/expired token → let the route's auth dependency handle it
    return await call_next(request)


async def migrate_encrypt_secrets():
    """One-time (idempotent) migration: encrypt any plaintext secrets already stored at rest."""
    from secrets_crypto import is_encrypted, encrypt_value, encrypt_env_list
    migrated = 0
    async for doc in db.projects.find({"env_vars": {"$exists": True, "$ne": []}}):
        ev = doc.get("env_vars") or []
        if any(not is_encrypted((e or {}).get("value", "")) for e in ev if isinstance(e, dict)):
            await db.projects.update_one({"_id": doc["_id"]}, {"$set": {"env_vars": encrypt_env_list(ev)}})
            migrated += 1
    tg = await db.settings.find_one({"_id": "telegram"})
    if tg and tg.get("bot_token") and not is_encrypted(tg["bot_token"]):
        await db.settings.update_one({"_id": "telegram"}, {"$set": {"bot_token": encrypt_value(tg["bot_token"])}})
        migrated += 1
    if migrated:
        logger.info("secret encryption migration: updated %s document(s)", migrated)


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
                                f"Restart loop detected on container <code>{name}</code>: "
                                f"{len(events)}x within {RESTART_WINDOW // 60} minutes (status: {status}).\n"
                                f"Check Container Logs in the panel for the cause."
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


# --------------------------------------------- scheduled update check -----
UPDATE_CHECK_INTERVAL = int(os.environ.get("UPDATE_CHECK_INTERVAL", "900"))


async def update_check_scheduler():
    """Periodically check each deployed project for new commits on its remote branch."""
    await asyncio.sleep(120)
    while True:
        try:
            if engine.caps.get("git"):
                async for doc in db.projects.find():
                    project = Project.from_mongo(doc)
                    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
                    try:
                        r = await engine.check_updates(project, token)
                        if r.get("checked") and r.get("cloned"):
                            update_fields = {
                                "updates_behind": r.get("behind", 0),
                                "updates_checked_at": datetime.now(timezone.utc).isoformat(),
                                "current_commit": r.get("current"),
                                "remote_commit": r.get("remote"),
                            }
                            behind = r.get("behind", 0)
                            remote = r.get("remote") or {}
                            rhash = remote.get("hash")
                            # Alert once per new remote commit (throttle via updates_alerted_commit)
                            if behind > 0 and rhash and rhash != doc.get("updates_alerted_commit"):
                                msg = remote.get("message", "")
                                text = (
                                    f"\U0001f514 <b>{engine._esc(project.name)}</b>\n"
                                    f"{behind} new update(s) available on GitHub (<code>{project.branch}</code>)\n"
                                    f"Latest: <code>{remote.get('short', '')}</code> {engine._esc(msg)[:120]}"
                                )
                                try:
                                    await asyncio.to_thread(send_telegram, text)
                                    update_fields["updates_alerted_commit"] = rhash
                                except Exception:
                                    pass
                            await db.projects.update_one(
                                {"_id": __import__("bson").ObjectId(project.id)},
                                {"$set": update_fields},
                            )
                    except Exception as e:
                        logger.warning("update check (%s): %s", project.slug, e)
        except Exception as e:
            logger.warning("update check scheduler: %s", e)
        await asyncio.sleep(UPDATE_CHECK_INTERVAL)


# --------------------------------------------- housekeeping / retention ----
HOUSEKEEPING_INTERVAL = int(os.environ.get("HOUSEKEEPING_INTERVAL", "21600"))  # 6h
MAX_BACKUPS = int(os.environ.get("MAX_BACKUPS", "14"))


async def _docker_prune():
    """Reclaim disk from dangling images and stale build cache (safe — no running data touched)."""
    if not engine.caps.get("docker"):
        return
    for args in (["docker", "image", "prune", "-f"],
                 ["docker", "builder", "prune", "-f"]):
        try:
            proc = await asyncio.create_subprocess_exec(
                *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.wait(), timeout=120)
        except Exception as e:
            logger.warning("docker prune (%s): %s", " ".join(args), e)


async def _prune_orphans():
    """Remove log/metric/history rows belonging to projects that no longer exist."""
    try:
        alive = set()
        async for d in db.projects.find({}, {"_id": 1}):
            alive.add(str(d["_id"]))
        for coll in ("deploy_logs", "metrics", "deploy_history", "webhook_events", "webhook_deliveries"):
            distinct = await db[coll].distinct("project_id")
            orphan = [pid for pid in distinct if pid and pid not in alive]
            if orphan:
                await db[coll].delete_many({"project_id": {"$in": orphan}})
    except Exception as e:
        logger.warning("prune orphans: %s", e)


async def _prune_backups():
    """Keep only the newest MAX_BACKUPS backup archives on disk."""
    try:
        removed = await asyncio.to_thread(ops.prune_backups, MAX_BACKUPS)
        if removed:
            logger.info("housekeeping removed %s old backup(s)", removed)
    except Exception as e:
        logger.warning("prune backups: %s", e)


async def _prune_db_backups():
    """Enforce per-project DB-backup retention and drop backup dirs of deleted projects."""
    try:
        slugs = set()
        async for d in db.projects.find({}, {"slug": 1}):
            if d.get("slug"):
                slugs.add(d["slug"])
                db_manager._prune_backups(d["slug"])
        # remove backup dirs belonging to projects that no longer exist
        from db_manager import DB_BACKUP_DIR
        if DB_BACKUP_DIR.is_dir():
            import shutil as _sh
            for child in DB_BACKUP_DIR.iterdir():
                if child.is_dir() and child.name not in slugs:
                    _sh.rmtree(child, ignore_errors=True)
    except Exception as e:
        logger.warning("prune db backups: %s", e)


async def housekeeping_scheduler():
    """Periodic cleanup so the panel stays fast over months/years of use."""
    await asyncio.sleep(300)
    while True:
        try:
            await _prune_orphans()
            await _prune_backups()
            await _prune_db_backups()
            # cap terminal recordings (belt-and-suspenders; also capped on save)
            olds = db.terminal_recordings.find({}, {"_id": 1}).sort("started_at", -1).skip(
                int(os.environ.get("TERMINAL_MAX_RECORDINGS", "50"))
            )
            ids = [d["_id"] async for d in olds]
            if ids:
                await db.terminal_recordings.delete_many({"_id": {"$in": ids}})
            await _docker_prune()
        except Exception as e:
            logger.warning("housekeeping: %s", e)
        await asyncio.sleep(HOUSEKEEPING_INTERVAL)


# --------------------------------------------- metrics sampler -------------
METRICS_INTERVAL = int(os.environ.get("METRICS_INTERVAL", "60"))
METRICS_RETENTION_HOURS = int(os.environ.get("METRICS_RETENTION_HOURS", "72"))
AUDIT_MAX_RECORDS = int(os.environ.get("AUDIT_MAX_RECORDS", "10000"))
CPU_ALERT_PCT = float(os.environ.get("CPU_ALERT_PCT", "90"))
MEM_ALERT_MB = int(os.environ.get("MEM_ALERT_MB", "0"))  # 0 = disabled
RESOURCE_ALERT_COOLDOWN = int(os.environ.get("RESOURCE_ALERT_COOLDOWN", "1800"))
_resource_alert_last: dict = {}


async def prune_audit_logs():
    """Cap audit_logs collection to the newest AUDIT_MAX_RECORDS entries."""
    try:
        total = await db.audit_logs.count_documents({})
        excess = total - AUDIT_MAX_RECORDS
        if excess > 0:
            olds = db.audit_logs.find({}, {"_id": 1}).sort("ts", 1).limit(excess)
            ids = [d["_id"] async for d in olds]
            if ids:
                await db.audit_logs.delete_many({"_id": {"$in": ids}})
    except Exception as e:
        logger.warning("audit prune: %s", e)


async def metrics_sampler():
    """Sample per-container CPU/RAM for running projects into a time series."""
    await asyncio.sleep(30)
    while True:
        try:
            if engine.caps.get("docker"):
                async for doc in db.projects.find({"status": "running"}):
                    project = Project.from_mongo(doc)
                    try:
                        stats = await engine.container_stats(project)
                    except Exception:
                        stats = []
                    if stats:
                        await db.metrics.insert_one({
                            "project_id": project.id,
                            "ts": datetime.now(timezone.utc).isoformat(),
                            "stats": stats,
                        })
                        # Resource threshold alerts (per project, throttled).
                        agg_cpu = round(sum(s.get("cpu", 0) for s in stats), 1)
                        agg_mem = round(sum(s.get("mem_mb", 0) for s in stats))
                        breaches = []
                        if CPU_ALERT_PCT > 0 and agg_cpu >= CPU_ALERT_PCT:
                            breaches.append(f"CPU {agg_cpu}%")
                        if MEM_ALERT_MB > 0 and agg_mem >= MEM_ALERT_MB:
                            breaches.append(f"RAM {agg_mem} MB")
                        if breaches:
                            now = time.time()
                            if now - _resource_alert_last.get(project.id, 0) >= RESOURCE_ALERT_COOLDOWN:
                                _resource_alert_last[project.id] = now
                                try:
                                    await asyncio.to_thread(
                                        send_telegram,
                                        f"\u26a0\ufe0f <b>{engine._esc(project.name)}</b> high resource usage\n"
                                        f"{', '.join(breaches)} (threshold CPU {CPU_ALERT_PCT}%"
                                        + (f", RAM {MEM_ALERT_MB} MB" if MEM_ALERT_MB else "") + ").",
                                    )
                                except Exception:
                                    pass
                cutoff = (datetime.now(timezone.utc) - timedelta(hours=METRICS_RETENTION_HOURS)).isoformat()
                await db.metrics.delete_many({"ts": {"$lt": cutoff}})
            await prune_audit_logs()
        except Exception as e:
            logger.warning("metrics sampler: %s", e)
        await asyncio.sleep(METRICS_INTERVAL)


# --------------------------------------------- uptime + disk monitor -------
UPTIME_CHECK_INTERVAL = int(os.environ.get("UPTIME_CHECK_INTERVAL", "300"))
UPTIME_ALERT_COOLDOWN = int(os.environ.get("UPTIME_ALERT_COOLDOWN", "1800"))
DISK_ALERT_PCT = float(os.environ.get("DISK_ALERT_PCT", "90"))
DISK_ALERT_COOLDOWN = int(os.environ.get("DISK_ALERT_COOLDOWN", "3600"))

_uptime_state: dict = {}
_uptime_last_alert: dict = {}
_disk_last_alert = {"ts": 0.0}


async def uptime_disk_monitor():
    """Periodically probe project domains and host disk; alert via Telegram on down/recovery
    and when disk usage crosses the alert threshold."""
    await asyncio.sleep(45)
    from system_stats import disk_status as _disk_status
    while True:
        try:
            # ---- disk usage alert ----
            s = _disk_status("/")
            now = time.time()
            if s["percent"] >= DISK_ALERT_PCT and now - _disk_last_alert["ts"] >= DISK_ALERT_COOLDOWN:
                _disk_last_alert["ts"] = now
                free_gb = round(s["free"] / 1024 / 1024 / 1024, 1)
                try:
                    await asyncio.to_thread(
                        send_telegram,
                        f"\u26a0\ufe0f <b>Nexus Panel</b>\nDisk usage high on {os.uname().nodename}: "
                        f"<b>{s['percent']}%</b> used ({free_gb} GB free).\n"
                        "Deploys & backups are blocked below the safety floor — free up space.",
                    )
                except Exception:
                    pass
            # ---- domain uptime alerts ----
            async for doc in db.projects.find({"domain": {"$nin": [None, ""]}}):
                project = Project.from_mongo(doc)
                domain = (project.domain or "").strip()
                if not domain:
                    continue
                res = await _check_domain_reachable(domain)
                up = res.get("reachable")
                pid = project.id
                prev = _uptime_state.get(pid)
                _uptime_state[pid] = up
                await db.projects.update_one(
                    {"_id": ObjectId(pid)},
                    {"$set": {"domain_up": up, "domain_checked_at": datetime.now(timezone.utc).isoformat()}},
                )
                now = time.time()
                if prev is True and up is False:
                    if now - _uptime_last_alert.get(pid, 0) >= UPTIME_ALERT_COOLDOWN:
                        _uptime_last_alert[pid] = now
                        try:
                            await asyncio.to_thread(
                                send_telegram,
                                f"\U0001f534 <b>{engine._esc(project.name)}</b> is DOWN\n"
                                f"{domain} is unreachable ({res.get('error') or 'no response'}).",
                            )
                        except Exception:
                            pass
                elif prev is False and up is True:
                    _uptime_last_alert.pop(pid, None)
                    try:
                        await asyncio.to_thread(
                            send_telegram,
                            f"\U0001f7e2 <b>{engine._esc(project.name)}</b> RECOVERED\n"
                            f"{domain} is reachable again (HTTP {res.get('status')}).",
                        )
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("uptime/disk monitor: %s", e)
        await asyncio.sleep(UPTIME_CHECK_INTERVAL)


@app.on_event("startup")
async def on_startup():
    await seed_admin(db)
    try:
        await db.users.create_index("username", unique=True)
        await db.projects.create_index("slug", unique=True)
        await db.deploy_logs.create_index("project_id")
        await db.deploy_history.create_index([("project_id", 1), ("started_at", -1)])
        await db.audit_logs.create_index([("ts", -1)])
        await db.audit_logs.create_index([("seq", -1)])
        await db.webhook_deliveries.create_index("delivery_id", unique=True)
        await db.webhook_deliveries.create_index("ts", expireAfterSeconds=604800)
        await db.webhook_events.create_index([("project_id", 1), ("ts", -1)])
        await db.terminal_recordings.create_index([("started_at", -1)])
        await db.login_attempts.create_index("identifier", unique=True)
        await db.revoked_tokens.create_index("jti", unique=True)
        await db.revoked_tokens.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning("index creation: %s", e)
    try:
        await migrate_encrypt_secrets()
    except Exception as e:
        logger.warning("secret migration: %s", e)
    await seed_default_commands(db)
    tg = await db.settings.find_one({"_id": "telegram"})
    if tg:
        _apply_telegram_env(tg)
    app.state.monitor_task = asyncio.create_task(restart_loop_monitor())
    app.state.renew_task = asyncio.create_task(ssl_renew_scheduler())
    app.state.env_scan_task = asyncio.create_task(env_scan_scheduler())
    app.state.metrics_task = asyncio.create_task(metrics_sampler())
    app.state.update_check_task = asyncio.create_task(update_check_scheduler())
    app.state.housekeeping_task = asyncio.create_task(housekeeping_scheduler())
    app.state.uptime_task = asyncio.create_task(uptime_disk_monitor())
    logger.info("Panel started. Capabilities: %s", engine.caps)


@app.on_event("shutdown")
async def on_shutdown():
    for attr in ("monitor_task", "renew_task", "env_scan_task", "metrics_task", "update_check_task", "housekeeping_task", "uptime_task"):
        task = getattr(app.state, attr, None)
        if task:
            task.cancel()
    client.close()
