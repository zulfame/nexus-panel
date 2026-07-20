import asyncio
import os
import re
import shutil
import socket
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from cryptography.fernet import Fernet

from models import Project
from notifications import send_telegram

# ------------------------------------------------------------------ paths ---
DATA_DIR = Path(os.environ.get("PANEL_DATA_DIR", "/app/panel_data"))
# Deployed projects live under the panel home (default /opt/nexus-panel/apps on a VPS).
NEXUS_HOME = Path(os.environ.get("NEXUS_HOME", "/opt/nexus-panel"))
APPS_DIR = Path(os.environ.get("NEXUS_APPS_DIR", str(NEXUS_HOME / "apps")))
NGINX_DIR = Path(os.environ.get("NGINX_SITES_DIR", str(DATA_DIR / "nginx")))

for _p in (DATA_DIR, APPS_DIR, NGINX_DIR):
    try:
        _p.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

# log-rotation limits (panel-side deploy logs stored in MongoDB)
MAX_DEPLOY_LOGS = int(os.environ.get("PANEL_MAX_DEPLOY_LOGS", "20"))
MAX_LOG_LINES = int(os.environ.get("PANEL_MAX_LOG_LINES", "2000"))
# container log rotation (docker json-file driver on the VPS)
CONTAINER_LOG_MAX_SIZE = os.environ.get("PANEL_CONTAINER_LOG_MAX_SIZE", "10m")
CONTAINER_LOG_MAX_FILE = os.environ.get("PANEL_CONTAINER_LOG_MAX_FILE", "3")

_PUBLIC_IP_CACHE: dict = {"ip": None}


def _public_ip() -> Optional[str]:
    """Outbound/public IPv4 via an echo service (cached). May differ from the inbound IP behind NAT."""
    if _PUBLIC_IP_CACHE["ip"]:
        return _PUBLIC_IP_CACHE["ip"]
    import requests

    for url in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        try:
            r = requests.get(url, timeout=5)
            if r.ok and r.text.strip():
                _PUBLIC_IP_CACHE["ip"] = r.text.strip()
                return _PUBLIC_IP_CACHE["ip"]
        except Exception:
            continue
    return None


def get_local_ips() -> List[str]:
    """All non-loopback IPv4 addresses bound to this host's interfaces (e.g. eth0)."""
    ips = set()
    try:
        import psutil

        for _name, addrs in psutil.net_if_addrs().items():
            for a in addrs:
                if a.family == socket.AF_INET and a.address and not a.address.startswith("127."):
                    ips.add(a.address)
    except Exception:
        pass
    return sorted(ips)


def candidate_server_ips() -> List[str]:
    """Every IP that could legitimately represent this server: env override, public IP, local interfaces."""
    ips = set()
    env_ip = os.environ.get("PANEL_SERVER_IP")
    if env_ip:
        ips.add(env_ip.strip())
    pub = _public_ip()
    if pub:
        ips.add(pub)
    ips.update(get_local_ips())
    return sorted(ips)


def get_server_ip() -> Optional[str]:
    env_ip = os.environ.get("PANEL_SERVER_IP")
    if env_ip:
        return env_ip.strip()
    local = get_local_ips()
    return _public_ip() or (local[0] if local else None)


def resolve_domain_ips(domain: str) -> List[str]:
    try:
        infos = socket.getaddrinfo(domain, None)
        return sorted({i[4][0] for i in infos})
    except Exception:
        return []


def check_domain_dns(domain: str) -> dict:
    resolved = resolve_domain_ips(domain)
    candidates = candidate_server_ips()
    matches = any(ip in candidates for ip in resolved)
    # For display, prefer the resolved IP that matches this server; fall back sensibly.
    local = get_local_ips()
    display = (
        next((ip for ip in resolved if ip in candidates), None)
        or os.environ.get("PANEL_SERVER_IP")
        or _public_ip()
        or (local[0] if local else None)
    )
    return {"domain": domain, "server_ip": display, "resolved_ips": resolved, "matches": matches}


def read_cert_status(mode: str, cert_path: str) -> dict:
    """Parse a PEM cert file and return SSL state + expiry."""
    from cryptography import x509

    data = Path(cert_path).read_bytes()
    cert = x509.load_pem_x509_certificate(data)
    try:
        not_after = cert.not_valid_after_utc
    except AttributeError:  # cryptography < 42
        not_after = cert.not_valid_after.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    days_left = (not_after - now).days
    if days_left < 0:
        state = "expired"
    elif days_left <= 14:
        state = "expiring"
    else:
        state = "active"
    return {"mode": mode, "state": state, "expires_at": not_after.isoformat(), "days_left": days_left}


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
RUN pip install --no-cache-dir --upgrade pip && \\
    ( pip install --no-cache-dir \\
        --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \\
        -r requirements.txt \\
      || pip install --no-cache-dir --no-deps \\
        --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \\
        -r requirements.txt )
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
    logging_block = (
        "    logging:\n"
        "      driver: json-file\n"
        "      options:\n"
        f'        max-size: "{CONTAINER_LOG_MAX_SIZE}"\n'
        f'        max-file: "{CONTAINER_LOG_MAX_FILE}"'
    )
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
{logging_block}
  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:{p.frontend_port}:3000"
    depends_on:
      - backend
{logging_block}
"""


def frontend_env(p: Project) -> str:
    scheme = "https" if p.ssl_mode in ("letsencrypt", "custom") else "http"
    base = f"{scheme}://{p.domain}" if p.domain else f"http://localhost:{p.frontend_port}"
    return f"REACT_APP_BACKEND_URL={base}\n"


def _proxy_locations(p: Project) -> str:
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
    return (
        f"    location /api {{\n        proxy_pass http://{upstream_be};\n{proxy_common}    }}\n\n"
        f"    location / {{\n        proxy_pass http://{upstream_fe};\n{proxy_common}    }}\n"
    )


def nginx_config(p: Project) -> str:
    domain = p.domain or f"{p.slug}.local"
    location_blocks = _proxy_locations(p)

    if p.ssl_mode == "custom" and p.ssl_cert_path and p.ssl_key_path:
        return f"""server {{
    listen 80;
    server_name {domain};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl http2;
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
    listen 443 ssl http2;
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


def nginx_config_acme_http(p: Project) -> str:
    """HTTP-only config that serves the app AND the ACME challenge.
    Used to bootstrap Let's Encrypt before the certificate exists."""
    domain = p.domain or f"{p.slug}.local"
    location_blocks = _proxy_locations(p)
    return f"""server {{
    listen 80;
    server_name {domain};

    location /.well-known/acme-challenge/ {{
        root /var/www/certbot;
    }}
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
        await self._prune_logs(project_id)
        return str(res.inserted_id)

    async def _prune_logs(self, project_id: str):
        """Keep only the most recent MAX_DEPLOY_LOGS logs for a project."""
        try:
            cursor = (
                self.db.deploy_logs.find({"project_id": project_id}, {"_id": 1})
                .sort("created_at", -1)
                .skip(MAX_DEPLOY_LOGS)
            )
            old_ids = [d["_id"] async for d in cursor]
            if old_ids:
                await self.db.deploy_logs.delete_many({"_id": {"$in": old_ids}})
        except Exception:
            pass

    async def _log(self, log_id: str, text: str, stream: str = "stdout"):
        line = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "stream": stream,
            "text": text,
        }
        from bson import ObjectId

        doc = await self.db.deploy_logs.find_one_and_update(
            {"_id": ObjectId(log_id)},
            {"$push": {"lines": {"$each": [line], "$slice": -MAX_LOG_LINES}}},
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

    async def _set_status(self, project_id: str, status: str, message: str = "", notify: bool = True):
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
        if notify and status in ("running", "error"):
            from bson import ObjectId

            doc = await self.db.projects.find_one({"_id": ObjectId(project_id)})
            name = (doc or {}).get("name", project_id)
            emoji = "\u2705" if status == "running" else "\u274c"
            text = f"{emoji} <b>{name}</b>\nStatus: <b>{status}</b>\n{message}"
            try:
                await asyncio.to_thread(send_telegram, text)
            except Exception:
                pass

    # ---- deploy notification helpers ----
    @staticmethod
    def _fmt_duration(seconds: float) -> str:
        seconds = int(seconds)
        if seconds < 60:
            return f"{seconds}s"
        m, s = divmod(seconds, 60)
        return f"{m}m {s}s"

    @staticmethod
    def _esc(text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    async def _error_summary(self, log_id: str, max_lines: int = 12) -> str:
        from bson import ObjectId

        doc = await self.db.deploy_logs.find_one({"_id": ObjectId(log_id)})
        if not doc:
            return ""
        lines = doc.get("lines", [])
        errs = [l["text"] for l in lines if l.get("stream") in ("error", "stderr")]
        tail = errs[-max_lines:] if errs else [l["text"] for l in lines][-max_lines:]
        return self._esc("\n".join(tail))[-1400:]

    async def _notify_deploy(self, project: Project, status: str, start_ts: datetime, log_id: str):
        dur = self._fmt_duration((datetime.now(timezone.utc) - start_ts).total_seconds())
        name = project.name
        if status == "running":
            text = f"\u2705 <b>{name}</b>\nDeploy sukses\n\u23f1 Durasi build: <b>{dur}</b>"
        else:
            summary = await self._error_summary(log_id)
            text = f"\u274c <b>{name}</b>\nDeploy gagal\n\u23f1 Durasi build: <b>{dur}</b>"
            if summary:
                text += f"\n\n<b>Ringkasan error:</b>\n<pre>{summary}</pre>"
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
        start_ts = datetime.now(timezone.utc)
        log_id = await self._new_log(pid, "deploy")

        async def fail(message: str):
            await self._set_status(pid, "error", message, notify=False)
            await self._notify_deploy(project, "error", start_ts, log_id)
            await self._finish_log(log_id, "error")

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
                await fail("git not installed")
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
                await fail("git clone/pull failed")
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
                await fail("Docker not available (artifacts ready)")
                return

            rc = await self._run(log_id, "docker compose up -d --build", cwd=str(pdir))
            if rc != 0:
                await self._log(log_id, "docker compose build failed", stream="error")
                await fail("docker compose build failed")
                return

            # 4. nginx + ssl (letsencrypt is bootstrapped over HTTP first)
            await self._apply_web(log_id, project)

            await self._set_status(pid, "running", "Deployed successfully", notify=False)
            await self.db.projects.update_one(
                {"_id": __import__("bson").ObjectId(pid)},
                {"$set": {"last_deploy_at": datetime.now(timezone.utc).isoformat()}},
            )
            await self._log(log_id, "Deploy complete. Project is running.", stream="success")
            await self._notify_deploy(project, "running", start_ts, log_id)
            await self._finish_log(log_id, "success")
        except Exception as e:
            await self._log(log_id, f"Unexpected error: {e}", stream="error")
            await fail(str(e))

    def _write_artifacts(self, p: Project, pdir: Path):
        backend = pdir / "backend"
        frontend = pdir / "frontend"
        # Panel owns the Dockerfiles: always regenerate so template fixes apply on redeploy.
        if backend.exists():
            (backend / "Dockerfile").write_text(BACKEND_DOCKERFILE)
        if frontend.exists():
            (frontend / "Dockerfile").write_text(FRONTEND_DOCKERFILE)
            (frontend / ".env").write_text(frontend_env(p))
        (pdir / "docker-compose.yml").write_text(compose_yaml(p))
        # nginx config is written & applied later in _apply_web (letsencrypt needs bootstrap)

    def _install_nginx_conf(self, p: Project, content: str):
        """Persist the nginx config and link it into nginx's sites-enabled."""
        NGINX_DIR.mkdir(parents=True, exist_ok=True)
        conf_src = NGINX_DIR / f"{p.slug}.conf"
        conf_src.write_text(content)
        target = f"/etc/nginx/sites-available/{p.slug}.conf"
        shutil.copy(conf_src, target)
        enabled = f"/etc/nginx/sites-enabled/{p.slug}.conf"
        if not os.path.islink(enabled):
            os.symlink(target, enabled)

    async def _nginx_reload(self, log_id: str) -> bool:
        rc = await self._run(log_id, "nginx -t")
        if rc == 0:
            await self._run(log_id, "nginx -s reload")
            await self._log(log_id, "nginx reloaded", stream="success")
            return True
        await self._log(log_id, "nginx config test failed", stream="error")
        return False

    async def _apply_web(self, log_id: str, p: Project):
        if not self.caps["nginx"]:
            await self._log(log_id, "nginx not available; config saved but not applied", stream="error")
            NGINX_DIR.mkdir(parents=True, exist_ok=True)
            (NGINX_DIR / f"{p.slug}.conf").write_text(nginx_config(p))
            return

        domain = p.domain or f"{p.slug}.local"
        cert_path = Path(f"/etc/letsencrypt/live/{domain}/fullchain.pem")

        try:
            # Let's Encrypt with no cert yet: bootstrap over HTTP, verify DNS, issue cert, switch to HTTPS.
            if p.ssl_mode == "letsencrypt" and not cert_path.exists():
                await self._log(log_id, "No SSL cert yet; serving over HTTP and requesting Let's Encrypt...", stream="info")
                self._install_nginx_conf(p, nginx_config_acme_http(p))
                if not await self._nginx_reload(log_id):
                    return
                dns = await self.dns_check(p)
                await self._log(
                    log_id,
                    f"DNS check: {domain} -> {dns['resolved_ips'] or 'none'} | server {dns['server_ip'] or 'unknown'}",
                    stream="info",
                )
                if not dns["matches"]:
                    await self._log(
                        log_id,
                        "Domain does not resolve to this server yet. Skipping SSL to avoid Let's Encrypt rate limits. "
                        "Site is live over http:// — point the DNS A record here, then use 'Renew SSL'.",
                        stream="error",
                    )
                    return
                await self._issue_letsencrypt(log_id, p)
                if cert_path.exists():
                    self._install_nginx_conf(p, nginx_config(p))
                    await self._nginx_reload(log_id)
                    await self._log(log_id, "HTTPS enabled with Let's Encrypt.", stream="success")
                else:
                    await self._log(
                        log_id,
                        "SSL not issued. Site stays reachable over http:// until DNS/port 80 is verifiable.",
                        stream="error",
                    )
                return

            # custom / none / letsencrypt-with-existing-cert
            self._install_nginx_conf(p, nginx_config(p))
            await self._nginx_reload(log_id)
        except PermissionError:
            await self._log(
                log_id,
                f"No permission to write nginx config for {p.slug}. Run panel with adequate privileges on VPS.",
                stream="error",
            )
        except Exception as e:
            await self._log(log_id, f"nginx apply error: {e}", stream="error")

    async def _issue_letsencrypt(self, log_id: str, p: Project):
        if not self.caps["certbot"]:
            await self._log(log_id, "certbot not available; skipping SSL issuance", stream="error")
            return
        try:
            Path("/var/www/certbot").mkdir(parents=True, exist_ok=True)
        except Exception as e:
            await self._log(log_id, f"could not create /var/www/certbot: {e}", stream="error")
        email = p.ssl_email or "admin@" + (p.domain or "example.com")
        cmd = (
            f"certbot certonly --webroot -w /var/www/certbot -d {p.domain} "
            f"--non-interactive --agree-tos -m {email}"
        )
        rc = await self._run(log_id, cmd)
        if rc == 0:
            await self._log(log_id, "SSL certificate issued", stream="success")
        else:
            await self._log(log_id, "SSL issuance failed", stream="error")

    async def dns_check(self, project: Project) -> dict:
        if not project.domain:
            return {"domain": None, "server_ip": None, "resolved_ips": [], "matches": False}
        return await asyncio.to_thread(check_domain_dns, project.domain)

    def _cert_path_for(self, p: Project) -> Optional[str]:
        if p.ssl_mode == "custom":
            return p.ssl_cert_path
        if p.ssl_mode == "letsencrypt":
            domain = p.domain or f"{p.slug}.local"
            return f"/etc/letsencrypt/live/{domain}/fullchain.pem"
        return None

    async def ssl_status(self, p: Project) -> dict:
        if p.ssl_mode not in ("letsencrypt", "custom"):
            return {"mode": p.ssl_mode, "state": "http", "expires_at": None, "days_left": None}
        cert_path = self._cert_path_for(p)
        if not cert_path or not Path(cert_path).exists():
            return {"mode": p.ssl_mode, "state": "pending", "expires_at": None, "days_left": None}
        try:
            return await asyncio.to_thread(read_cert_status, p.ssl_mode, cert_path)
        except Exception:
            return {"mode": p.ssl_mode, "state": "pending", "expires_at": None, "days_left": None}

    async def auto_renew_certs(self) -> tuple:
        """Run `certbot renew` (no-op unless a cert is near expiry) and reload nginx."""
        if not self.caps["certbot"]:
            return (0, "certbot not available")
        try:
            proc = await asyncio.create_subprocess_shell(
                "certbot renew --webroot -w /var/www/certbot --non-interactive --quiet",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await proc.communicate()
            rc = proc.returncode or 0
            if rc == 0 and self.caps["nginx"]:
                r = await asyncio.create_subprocess_shell("nginx -s reload")
                await r.wait()
            return (rc, out.decode(errors="replace"))
        except Exception as e:
            return (1, str(e))

    async def renew_ssl(self, project: Project):
        """Issue or renew the Let's Encrypt cert on demand, then switch nginx to HTTPS."""
        pid = project.id
        log_id = await self._new_log(pid, "ssl")
        try:
            if not self.caps["nginx"]:
                await self._log(log_id, "nginx not available on this host", stream="error")
                await self._finish_log(log_id, "error")
                return
            if project.ssl_mode != "letsencrypt":
                await self._log(log_id, "Renew SSL only applies to Let's Encrypt mode", stream="error")
                await self._finish_log(log_id, "error")
                return
            if not project.domain:
                await self._log(log_id, "No domain configured", stream="error")
                await self._finish_log(log_id, "error")
                return

            await self._log(log_id, f"Checking DNS for {project.domain}...", stream="info")
            dns = await self.dns_check(project)
            await self._log(
                log_id,
                f"DNS: {project.domain} -> {dns['resolved_ips'] or 'none'} | server {dns['server_ip'] or 'unknown'}",
                stream="info",
            )
            if not dns["matches"]:
                await self._log(
                    log_id,
                    "Domain does not point to this server. Set the DNS A record to the server IP, then retry.",
                    stream="error",
                )
                await self._finish_log(log_id, "error")
                return

            # serve ACME challenge over HTTP, then issue/renew
            self._install_nginx_conf(project, nginx_config_acme_http(project))
            if not await self._nginx_reload(log_id):
                await self._finish_log(log_id, "error")
                return
            await self._issue_letsencrypt(log_id, project)
            cert_path = Path(f"/etc/letsencrypt/live/{project.domain}/fullchain.pem")
            if cert_path.exists():
                self._install_nginx_conf(project, nginx_config(project))
                await self._nginx_reload(log_id)
                await self._log(log_id, "SSL active. HTTPS is live.", stream="success")
                await self._finish_log(log_id, "success")
            else:
                await self._log(log_id, "SSL issuance failed. Site remains on HTTP.", stream="error")
                await self._finish_log(log_id, "error")
        except Exception as e:
            await self._log(log_id, f"error: {e}", stream="error")
            await self._finish_log(log_id, "error")

    async def restart_stats(self, project: Project) -> List[dict]:
        """Per-container restart counts via `docker inspect`. Returns [] when docker unavailable."""
        pdir = project_dir(project.slug)
        if not (
            self.caps["docker"]
            and self.caps["docker_compose"]
            and (pdir / "docker-compose.yml").exists()
        ):
            return []
        try:
            proc = await asyncio.create_subprocess_shell(
                "docker compose ps -q",
                cwd=str(pdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await proc.communicate()
            ids = [x for x in out.decode(errors="replace").split() if x]
            if not ids:
                return []
            fmt = "{{.Name}}|{{.RestartCount}}|{{.State.Status}}"
            proc = await asyncio.create_subprocess_shell(
                f"docker inspect --format '{fmt}' {' '.join(ids)}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await proc.communicate()
            result = []
            for line in out.decode(errors="replace").splitlines():
                parts = line.strip().split("|")
                if len(parts) != 3:
                    continue
                name, count, status = parts
                try:
                    count = int(count)
                except ValueError:
                    count = 0
                result.append({"name": name.lstrip("/"), "restart_count": count, "status": status.lower()})
            return result
        except Exception:
            return []

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

    async def open_container_log_stream(self, project: Project, tail: int = 200):
        """Return a running `docker compose logs -f` subprocess for live streaming, or None."""
        pdir = project_dir(project.slug)
        if not (
            self.caps["docker"]
            and self.caps["docker_compose"]
            and (pdir / "docker-compose.yml").exists()
        ):
            return None
        try:
            return await asyncio.create_subprocess_shell(
                f"docker compose logs -f --tail {tail}",
                cwd=str(pdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception:
            return None

    async def container_health(self, project: Project) -> List[dict]:
        """Per-container state via `docker compose ps`. Returns [] when docker unavailable."""
        pdir = project_dir(project.slug)
        if not (
            self.caps["docker"]
            and self.caps["docker_compose"]
            and (pdir / "docker-compose.yml").exists()
        ):
            return []
        try:
            proc = await asyncio.create_subprocess_shell(
                "docker compose ps --format json",
                cwd=str(pdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await proc.communicate()
            text = out.decode(errors="replace").strip()
            if not text:
                return []
            import json

            entries: list = []
            try:
                data = json.loads(text)
                entries = data if isinstance(data, list) else [data]
            except json.JSONDecodeError:
                for line in text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            result = []
            for e in entries:
                result.append(
                    {
                        "service": e.get("Service") or e.get("Name", ""),
                        "name": e.get("Name", ""),
                        "state": (e.get("State") or "").lower(),
                        "status": e.get("Status") or "",
                        "health": (e.get("Health") or "").lower(),
                    }
                )
            return result
        except Exception:
            return []

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
