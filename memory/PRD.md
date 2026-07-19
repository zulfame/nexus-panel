# PRD — Emergent Deploy Panel (Self-hosted mini-PaaS)

## Original Problem Statement
User has 5 Emergent projects (FastAPI + MongoDB + React). They own a large Ubuntu 24.04
VPS but only ONE public IP, so they can currently deploy only one project. They want a
web control panel to manage deployment of all projects: pull each from a GitHub repo,
configure port, domain + SSL, database, env vars, and control lifecycle.

## User Choices
- Real tool to run directly on their VPS (not just a demo).
- Docker per project (recommended by agent).
- Subdomain per project + SSL: Let's Encrypt auto, plus option for custom wildcard cert (Sectigo).
- Private GitHub repos via Personal Access Token.
- Single admin login (JWT username/password).

## Architecture
- Backend: FastAPI + Motor/MongoDB. Modules: `server.py` (routes), `auth.py` (JWT bearer,
  admin seed), `deploy_engine.py` (git/docker/nginx/certbot engine + capability detection +
  Fernet token encryption), `system_stats.py` (psutil), `models.py` (BaseDocument pattern).
- Frontend: React 19 + Tailwind (brutalist dark theme, Chivo/IBM Plex/JetBrains Mono),
  shadcn/ui, sonner, react-router. Token in localStorage `panel_token`.
- Deployment engine detects host tools; on sandbox (no docker/certbot) it generates all
  artifacts (docker-compose, Dockerfiles, nginx vhost, .env) and reports docker unavailable.
  On the real VPS every step runs (build containers, nginx reload, certbot issue).

## User Personas
- Solo developer / indie hoster managing several full-stack apps on one VPS.

## Core Requirements (static)
- Single-admin auth; private GitHub pull; per-project port auto-assignment; subdomain +
  reverse proxy; SSL (LE auto / custom); per-project Mongo DB; env var management;
  deploy/start/stop/restart/delete; live build & container logs; server resource dashboard.

## Implemented (2026-07-19)
- JWT auth (bcrypt, seeded admin from env), 401 guards on all API routes.
- Project CRUD with encrypted GitHub token (never returned; `has_github_token` flag).
- Port auto-assignment (FE 3100+, BE 8100+, collision-free).
- Add Project 4-step wizard (Repository → Build Config → Domain/SSL → Review).
- Project detail: editable config, domain/SSL modes, env editor, ports, DB name.
- Deploy engine: git clone/pull (PAT), artifact generation (compose/Dockerfiles/nginx/.env),
  docker compose up, nginx vhost apply+reload, certbot issuance; lifecycle + container logs.
- Streamed deploy logs persisted to MongoDB `deploy_logs`, terminal-style viewer.
- Dashboard (CPU/RAM/disk meters + project counts), Settings (host capabilities).
- VPS installer `scripts/install.sh` + `DEPLOY_VPS.md` guide.
- Tested: 19/19 backend pass, all frontend flows pass (iteration_1.json).

## Backlog / Remaining
- P1: Brute-force lockout on /auth/login; shorter token TTL + refresh.
- P1: Refresh capability detection at runtime (not only at startup).
- P2: Cap/rotate deploy log documents ($push growth); paginate logs.
- P2: WebSocket live log streaming (replace polling); per-project metrics.
- P2: Change-admin-password UI; multi-user roles (future).
- P2: One-click SSL renew; webhook auto-deploy on git push.

## Next Tasks
- Ship as-is for user review; on their VPS run install.sh and connect real repos.

## Ops & Docs (2026-07-19)
- Added /scripts automation (idempotent, fresh-Ubuntu-24.04 ready, failed builds self-clean):
  install.sh (Docker+Nginx+Certbot+Node+Python+Mongo+systemd+subdomain+LE SSL auto-renew+UFW+nightly backup),
  update.sh (backup+atomic release deploy+auto-rollback), rollback.sh, backup.sh, restore.sh,
  healthcheck.sh, uninstall.sh(--purge), lib/common.sh, config/nexus.conf.example.
- Release-based deploy: /opt/nexus-panel/releases/<ts> + atomic `current` symlink; keeps last 5.
- Comprehensive README.md + short DEPLOY_VPS.md pointer. Panel runs backend via systemd (root),
  frontend static via nginx, Mongo container bound to docker bridge IP (not public).

## Backup UI + Telegram (2026-07-19)
- Backend /api/ops/*: info, backups(list), backup, restore, rollback + Telegram test. ops.py runs
  scripts detached (setsid) so restore/rollback survive service restart; validates backup filename.
- notifications.py send_telegram (requests, HTML, message_thread_id, no-op if unset). Deploy engine
  notifies on running/error via _set_status. Shell scripts notify on backup/update/rollback.
- Settings UI: Telegram card (status + send-test) and Server Operations card (release info,
  Backup now, Rollback confirm, backups list with Restore confirm). Tested 100% (iteration_4.json).
- Telegram env in backend/.env + nexus.conf (installer prompts). Verified: real test message sent.
