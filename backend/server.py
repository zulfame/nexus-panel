import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from bson import ObjectId  # noqa: E402
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException  # noqa: E402
from fastapi import APIRouter  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from auth import build_auth_router, seed_admin  # noqa: E402
from deploy_engine import (  # noqa: E402
    DeployEngine,
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
from system_stats import get_system_stats  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("panel")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Emergent Deploy Panel")
api_router = APIRouter(prefix="/api")

engine = DeployEngine(db)
auth_router, get_current_user = build_auth_router(db)

BACKEND_PORT_BASE = 8100
FRONTEND_PORT_BASE = 3100


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


# ------------------------------------------------------------- routes -------
@api_router.get("/")
async def root():
    return {"message": "Emergent Deploy Panel API"}


@api_router.get("/capabilities")
async def capabilities(current=Depends(get_current_user)):
    return detect_capabilities()


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
    slug = slugify(body.name)
    if await db.projects.find_one({"slug": slug}):
        raise HTTPException(status_code=409, detail=f"Project '{slug}' already exists")

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
    if "github_token" in update:
        token = update.pop("github_token")
        if token:
            update["github_token_enc"] = encrypt_token(token)
    if "env_vars" in update and update["env_vars"] is not None:
        update["env_vars"] = [e if isinstance(e, dict) else e.model_dump() for e in update["env_vars"]]
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
    project_id: str, background: BackgroundTasks, current=Depends(get_current_user)
):
    project = await _get_project_or_404(project_id)
    token = decrypt_token(project.github_token_enc) if project.github_token_enc else None
    background.add_task(engine.deploy, project, token)
    return {"ok": True, "message": "Deployment started"}


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


api_router.include_router(auth_router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await seed_admin(db)
    try:
        await db.users.create_index("username", unique=True)
        await db.projects.create_index("slug", unique=True)
        await db.deploy_logs.create_index("project_id")
    except Exception as e:
        logger.warning("index creation: %s", e)
    logger.info("Panel started. Capabilities: %s", engine.caps)


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
