import asyncio
import os
import re
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from cryptography.fernet import Fernet

from models import Project
from notifications import send_telegram

# ------------------------------------------------------------------ paths ---
DATA_DIR = Path(os.environ.get("PANEL_DATA_DIR", "/app/panel_data"))
APPS_DIR = DATA_DIR / "apps"
NGINX_DIR = Path(os.environ.get("NGINX_SITES_DIR", str(DATA_DIR / "nginx")))

for _p in (DATA_DIR, APPS_DIR, NGINX_DIR):
    _p.mkdir(parents=True, exist_ok=True)


def _fernet() -> Fernet:
    return Fernet(os.environ["PANEL_ENCRYPTION_KEY"].encode())


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(enc: str) -> str:
    return _fernet().decrypt(enc.encode()).decode()


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "app"


def project_dir(slug: str) -> Path:
    return APPS_DIR / slug


# --------------------------------------------------- capability detection ---
def detect_capabilities() -> dict:
    def has(cmd: str) -> bool:
        return shutil.which(cmd) is not None

    docker = has("docker")
    compose = False
    if docker:
        try:
            r = os.system("docker compose version >/dev/null 2>&1")
            compose = r == 0
        except Exception:
            compose = False
    return {
        "git": has("git"),
        "docker": docker,
        "docker_compose": compose,
        "nginx": has("nginx"),
        "certbot": has("certbot"),
    }


# ----------------------------------------------------- artifact templates ---
BACKEND_DOCKERFILE = """FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \\
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
"""

FRONTEND_DOCKERFILE = """FROM node:20-alpine AS build
WORKDIR /app
ENV GENERATE_SOURCEMAP=false
ENV CI=false
ENV NODE_OPTIONS=--max-old-space-size=2048
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --network-timeout 600000 || yarn install --network-timeout 600000
COPY . .
RUN yarn build
FROM node:20-alpine
WORKDIR /app
RUN yarn global add serve
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
"""


def compose_yaml(p: Project) -> str:
    env_lines = "\n".join(
        f"      - {e.key}={e.value}" for e in (p.env_vars or [])
    )
    mongo_url = os.environ.get("HOST_MONGO_URL", "mongodb://host.docker.internal:27017")
    return f"""services:
  backend:
    build: ./backend
    restart: unless-stopped
    ports:
      - "127.0.0.1:{p.backend_port}:8001"
    environment:
      - MONGO_URL={mongo_url}
      - DB_NAME={p.db_name}
      - CORS_ORIGINS=https://{p.domain or "localhost"}
{env_lines}
    extra_hosts:
      - "host.docker.internal:host-gateway"
  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:{p.frontend_port}:3000"
    depends_on:
      - backend
"""


def frontend_env(p: Project) -> str:
    scheme = "https" if p.ssl_mode in ("letsencrypt", "custom") else "http"
    base = f"{scheme}://{p.domain}" if p.domain else f"http://localhost:{p.frontend_port}"
    return f"REACT_APP_BACKEND_URL={base}\n"


def nginx_config(p: Project) -> str:
    domain = p.domain or f"{p.slug}.local"
    upstream_fe = f"127.0.0.1:{p.frontend_port}"
    upstream_be = f"127.0.0.1:{p.backend_port}"
    proxy_common = (
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        "        proxy_set_header Upgrade $http_upgrade;\n"
        '        proxy_set_header Connection "upgrade";\n'
    )
    location_blocks = (
        f"    location /api {{\n        proxy_pass http://{upstream_be};\n{proxy_common}    }}\n\n"
        f"    location / {{\n        proxy_pass http://{upstream_fe};\n{proxy_common}    }}\n"
    )

    if p.ssl_mode == "custom" and p.ssl_cert_path and p.ssl_key_path:
        return f"""server {{
    listen 80;
    server_name {domain};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl;
    http2 on;
    server_name {domain};

    ssl_certificate {p.ssl_cert_path};
    ssl_certificate_key {p.ssl_key_path};

{location_blocks}}}
"""
    if p.ssl_mode == "letsencrypt":
        cert = f"/etc/letsencrypt/live/{domain}/fullchain.pem"
        key = f"/etc/letsencrypt/live/{domain}/privkey.pem"
        return f"""server {{
    listen 80;
    server_name {domain};

    location /.well-known/acme-challenge/ {{
        root /var/www/certbot;
    }}
    location / {{
        return 301 https://$host$request_uri;
    }}
}}

server {{
    listen 443 ssl;
    http2 on;
    server_name {domain};

    ssl_certificate {cert};
    ssl_certificate_key {key};

{location_blocks}}}
"""
    return f"""server {{
    listen 80;
    server_name {domain};

{location_blocks}}}
"""


# ----------------------------------------------------------- log broker ----
class LogBroker:
    """In-process pub/sub for streaming deploy log events over WebSocket."""

    def __init__(self):
        self.subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, project_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.subs[project_id].add(q)
        return q

    def unsubscribe(self, project_id: str, q: asyncio.Queue):
        self.subs.get(project_id, set()).discard(q)

    async def publish(self, project_id: str, event: dict):
        for q in list(self.subs.get(project_id, [])):
            try:
                q.put_nowait(event)
            except Exception:
                pass


# ----------------------------------------------------------- deploy engine ---
class DeployEngine:
    def __init__(self, db, broker: Optional[LogBroker] = None):
        self.db = db
        self.broker = broker
        self.caps = detect_capabilities()

    def refresh_caps(self):
        self.caps = detect_capabilities()
        return self.caps

    async def _publish(self, project_id: str, event: dict):
        if self.broker:
            await self.broker.publish(project_id, event)

    # ---- deploy log helpers ----
    async def _new_log(self, project_id: str, action: str) -> str:
        await self._publish(project_id, {"type": "reset", "action": action})
        doc = {
            "project_id": project_id,
            "action": action,
            "status": "running",
            "lines": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }
        res = await self.db.deploy_logs.insert_one(doc)
        return str(res.inserted_id)

    async def _log(self, log_id: str, text: str, stream: str = "stdout"):
        line = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "stream": stream,
            "text": text,
        }
        from bson import ObjectId

        doc = await self.db.deploy_logs.find_one_and_update(
            {"_id": ObjectId(log_id)}, {"$push": {"lines": line}}
        )
        if doc:
            await self._publish(doc["project_id"], {"type": "line", "line": line})

    async def _finish_log(self, log_id: str, status: str):
        from bson import ObjectId

        doc = await self.db.deploy_logs.find_one_and_update(
            {"_id": ObjectId(log_id)},
            {"$set": {"status": status, "finished_at": datetime.now(timezone.utc).isoformat()}},
        )
        if doc:
            await self._publish(doc["project_id"], {"type": "end", "status": status})

    async def _set_status(self, project_id: str, status: str, message: str = ""):
        from bson import ObjectId

        await self.db.projects.update_one(
            {"_id": ObjectId(project_id)},
            {
                "$set": {
                    "status": status,
                    "last_message": message,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        await self._publish(project_id, {"type": "status", "status": status, "message": message})
        if status in ("running", "error"):
            from bson import ObjectId

            doc = await self.db.projects.find_one({"_id": ObjectId(project_id)})
            name = (doc or {}).get("name", project_id)
            emoji = "\u2705" if status == "running" else "\u274c"
            text = f"{emoji} <b>{name}</b>\nStatus: <b>{status}</b>\n{message}"
            try:
                await asyncio.to_thread(send_telegram, text)
            except Exception:
                pass

    async def _run(self, log_id: str, cmd: str, cwd: Optional[str] = None) -> int:
        """Run a shell command, streaming output into the deploy log."""
        await self._log(log_id, f"$ {cmd}", stream="info")
        try:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception as e:
            await self._log(log_id, f"failed to start command: {e}", stream="error")
            return 1
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            await self._log(log_id, raw.decode(errors="replace").rstrip("\n"))
        return await proc.wait()

    # ---- git ----
    def _auth_repo_url(self, p: Project, token: Optional[str]) -> str:
        url = p.repo_url
        if token and url.startswith("https://"):
            return url.replace("https://", f"https://{token}@", 1)
        return url

    # ---- full deploy pipeline ----
    async def deploy(self, project: Project, token: Optional[str]):
        pid = project.id
        log_id = await self._new_log(pid, "deploy")
        try:
            await self._log(log_id, f"Starting deploy for '{project.name}'", stream="info")
            await self._log(
                log_id,
                f"Capabilities: {self.caps}",
                stream="info",
            )
            await self._set_status(pid, "cloning", "Fetching source")

            pdir = project_dir(project.slug)

            # 1. clone or pull
            if not self.caps["git"]:
                await self._log(log_id, "git not available on this host", stream="error")
                await self._set_status(pid, "error", "git not installed")
                await self._finish_log(log_id, "error")
                return

            auth_url = self._auth_repo_url(project, token)
            if (pdir / ".git").exists():
                await self._log(log_id, "Repository exists, pulling latest...", stream="info")
                await self._run(log_id, f"git remote set-url origin {auth_url}", cwd=str(pdir))
                await self._run(log_id, f"git fetch origin {project.branch}", cwd=str(pdir))
                rc = await self._run(log_id, f"git reset --hard origin/{project.branch}", cwd=str(pdir))
            else:
                if pdir.exists():
                    shutil.rmtree(pdir, ignore_errors=True)
                rc = await self._run(
                    log_id,
                    f"git clone --branch {project.branch} --depth 1 {auth_url} {pdir}",
                )
            if rc != 0:
                await self._log(log_id, "Source fetch failed", stream="error")
                await self._set_status(pid, "error", "git clone/pull failed")
                await self._finish_log(log_id, "error")
                return

            # 2. write artifacts
            await self._log(log_id, "Generating deployment artifacts...", stream="info")
            self._write_artifacts(project, pdir)
            await self._log(log_id, "Wrote docker-compose.yml, Dockerfiles, .env, nginx config", stream="success")

            # 3. build & run containers
            await self._set_status(pid, "building", "Building containers")
            if not (self.caps["docker"] and self.caps["docker_compose"]):
                await self._log(
                    log_id,
                    "Docker/Compose not available on this host. Artifacts generated but containers not started.",
                    stream="error",
                )
                await self._log(
                    log_id,
                    "On your VPS this step runs: docker compose up -d --build",
                    stream="info",
                )
                await self._set_status(pid, "error", "Docker not available (artifacts ready)")
                await self._finish_log(log_id, "error")
                return

            rc = await self._run(log_id, "docker compose up -d --build", cwd=str(pdir))
            if rc != 0:
                await self._set_status(pid, "error", "docker compose build failed")
                await self._finish_log(log_id, "error")
                return

            # 4. nginx
            await self._apply_nginx(log_id, project)

            # 5. ssl
            if project.ssl_mode == "letsencrypt":
                await self._issue_letsencrypt(log_id, project)

            await self._set_status(pid, "running", "Deployed successfully")
            await self.db.projects.update_one(
                {"_id": __import__("bson").ObjectId(pid)},
                {"$set": {"last_deploy_at": datetime.now(timezone.utc).isoformat()}},
            )
            await self._log(log_id, "Deploy complete. Project is running.", stream="success")
            await self._finish_log(log_id, "success")
        except Exception as e:
            await self._log(log_id, f"Unexpected error: {e}", stream="error")
            await self._set_status(pid, "error", str(e))
            await self._finish_log(log_id, "error")

    def _write_artifacts(self, p: Project, pdir: Path):
        backend = pdir / "backend"
        frontend = pdir / "frontend"
        if backend.exists() and not (backend / "Dockerfile").exists():
            (backend / "Dockerfile").write_text(BACKEND_DOCKERFILE)
        if frontend.exists():
            if not (frontend / "Dockerfile").exists():
                (frontend / "Dockerfile").write_text(FRONTEND_DOCKERFILE)
            (frontend / ".env").write_text(frontend_env(p))
        (pdir / "docker-compose.yml").write_text(compose_yaml(p))
        # nginx config saved to panel-managed dir
        NGINX_DIR.mkdir(parents=True, exist_ok=True)
        (NGINX_DIR / f"{p.slug}.conf").write_text(nginx_config(p))

    async def _apply_nginx(self, log_id: str, p: Project):
        conf_src = NGINX_DIR / f"{p.slug}.conf"
        if not self.caps["nginx"]:
            await self._log(log_id, "nginx not available; config saved but not applied", stream="error")
            return
        target = f"/etc/nginx/sites-available/{p.slug}.conf"
        try:
            shutil.copy(conf_src, target)
            enabled = f"/etc/nginx/sites-enabled/{p.slug}.conf"
            if not os.path.islink(enabled):
                os.symlink(target, enabled)
            rc = await self._run(log_id, "nginx -t")
            if rc == 0:
                await self._run(log_id, "nginx -s reload")
                await self._log(log_id, "nginx reloaded", stream="success")
            else:
                await self._log(log_id, "nginx config test failed", stream="error")
        except PermissionError:
            await self._log(
                log_id,
                f"No permission to write {target}. Run panel with adequate privileges on VPS.",
                stream="error",
            )
        except Exception as e:
            await self._log(log_id, f"nginx apply error: {e}", stream="error")

    async def _issue_letsencrypt(self, log_id: str, p: Project):
        if not self.caps["certbot"]:
            await self._log(log_id, "certbot not available; skipping SSL issuance", stream="error")
            return
        email = p.ssl_email or "admin@" + (p.domain or "example.com")
        cmd = (
            f"certbot certonly --webroot -w /var/www/certbot -d {p.domain} "
            f"--non-interactive --agree-tos -m {email}"
        )
        rc = await self._run(log_id, cmd)
        if rc == 0:
            await self._log(log_id, "SSL certificate issued", stream="success")
            await self._run(log_id, "nginx -s reload")
        else:
            await self._log(log_id, "SSL issuance failed", stream="error")

    # ---- lifecycle ----
    async def lifecycle(self, project: Project, action: str):
        pid = project.id
        log_id = await self._new_log(pid, action)
        pdir = project_dir(project.slug)
        cmd_map = {
            "start": "docker compose start",
            "stop": "docker compose stop",
            "restart": "docker compose restart",
        }
        cmd = cmd_map.get(action)
        if not cmd:
            await self._finish_log(log_id, "error")
            return
        if not (self.caps["docker"] and self.caps["docker_compose"]):
            await self._log(log_id, "Docker not available on this host", stream="error")
            await self._finish_log(log_id, "error")
            return
        if not (pdir / "docker-compose.yml").exists():
            await self._log(log_id, "Project not deployed yet", stream="error")
            await self._finish_log(log_id, "error")
            return
        rc = await self._run(log_id, cmd, cwd=str(pdir))
        if rc == 0:
            new_status = "running" if action in ("start", "restart") else "stopped"
            await self._set_status(pid, new_status, f"{action} ok")
            await self._log(log_id, f"{action} complete", stream="success")
            await self._finish_log(log_id, "success")
        else:
            await self._set_status(pid, "error", f"{action} failed")
            await self._finish_log(log_id, "error")

    async def container_logs(self, project: Project, tail: int = 200) -> List[str]:
        pdir = project_dir(project.slug)
        if not (self.caps["docker"] and (pdir / "docker-compose.yml").exists()):
            return ["Docker not available or project not deployed on this host."]
        try:
            proc = await asyncio.create_subprocess_shell(
                f"docker compose logs --tail {tail}",
                cwd=str(pdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await proc.communicate()
            return out.decode(errors="replace").splitlines()
        except Exception as e:
            return [f"error: {e}"]

    async def destroy(self, project: Project):
        pdir = project_dir(project.slug)
        if self.caps["docker"] and (pdir / "docker-compose.yml").exists():
            try:
                proc = await asyncio.create_subprocess_shell(
                    "docker compose down -v", cwd=str(pdir)
                )
                await proc.wait()
            except Exception:
                pass
        # remove nginx config
        for path in (
            NGINX_DIR / f"{project.slug}.conf",
            Path(f"/etc/nginx/sites-enabled/{project.slug}.conf"),
            Path(f"/etc/nginx/sites-available/{project.slug}.conf"),
        ):
            try:
                if path.is_symlink() or path.exists():
                    path.unlink()
            except Exception:
                pass
        if pdir.exists():
            shutil.rmtree(pdir, ignore_errors=True)
