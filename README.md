# Nexus Panel

**Version 1.7.1** · A self-hosted **deployment control panel** (mini-PaaS) for running many
**FastAPI + MongoDB + React** apps (built with Emergent) on a **single Ubuntu 24.04
VPS with one public IP** — each project gets its own **subdomain + SSL**, isolated
Docker containers, its own MongoDB database, environment variables, and one-click
**deploy / start / stop / restart** with **live build logs**.

> Think Coolify / Dokploy / Railway, but purpose-built and lightweight for your own server.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full version history.

---

## Table of contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Quick install (fresh server)](#quick-install-fresh-server)
5. [DNS & SSL](#dns--ssl)
6. [Using the panel](#using-the-panel)
7. [Operations (update, backup, rollback…)](#operations)
8. [How deployment works](#how-deployment-works)
9. [Directory layout](#directory-layout-on-the-vps)
10. [Troubleshooting](#troubleshooting)
11. [Security](#security)

---

## Features

### Deployment & lifecycle
- **GitHub pull** (public or **private via Personal Access Token**, stored encrypted).
- **Subdomain per project** with Nginx reverse proxy (`/` → frontend, `/api` → backend).
- **SSL per project**: Let's Encrypt (auto) **or** your own custom/wildcard certificate.
- **Auto port assignment** (frontend `3100+`, backend `8100+`, collision-free).
- **Per-project MongoDB database** + environment variable editor.
- Lifecycle: **deploy / start / stop / restart / delete**, **live WebSocket build logs**, container logs.
- **Release-based deploys** (`releases/<timestamp>` + atomic `current` symlink) for instant rollback.

### CI/CD (v1.1)
- **Deploy History** with per-deploy notes, status and a visual **deploy timeline** chart.
- **One-click Rollback** to any previous commit from the History tab.
- **Auto-Deploy GitHub Webhooks** (opt-in per project, HMAC-verified) with a **Recent Webhook Activity** log.
- **Git Diff viewer** to preview incoming changes before deploying.
- **Check for Updates** with dashboard "behind by N commits" badges + optional Telegram alerts.

### UI / Design System (v1.2)
- Bespoke **Design System** with full **light / dark** mode (toggle in the sidebar).
- **Dynamic primary color** + one-click **theme presets** (Ocean, Emerald, Sunset, Violet, Rose, Slate, Amber, Cyan), set in **Settings › Identity** and applied panel-wide.
- Custom **branding** (system name, tagline, logo, favicon).
- Responsive layouts (mobile/tablet) with **swipe-to-open** sidebar on touch devices.

### Web Terminal (v1.3)
- Browser shell to the host (local PTY) and to remote servers over **SSH**, with tabbed sessions,
  **split view** (two live panes), and saved servers/commands. Uses **JetBrains Mono**.
- **Automatic session recording** with a replay player (play / pause / restart / speed / seek).
  Retention: newest 50 recordings, ~2 MB each.

### Monitoring & multi-user
- **Dashboard**: CPU / RAM / disk meters, project status, per-project **env-readiness badge**, **Scan All Projects**.
- **Projects page**: status stat cards, search / filter / sort, grid & list views, per-card live CPU/RAM meters and quick actions.
- **Project detail**: Overview / Configuration / Metrics / Deploy Logs / Container Logs / History tabs, container **historical metrics** charts.
- **Multiple users** (JWT), **brute-force protection**, per-user **audit log** with pagination.
- **Sidebar system status**: panel version, Docker status, server OS, operational indicator.
- **Domain health monitoring**: reachability ping with green/red status dots on Projects
  cards, the Dashboard table and the Project Detail header.
- **Environment tag** per project (production / staging / demo…) shown as a colored badge
  across cards, tables and the detail view.

### Panel operations & UX (v1.4)
- **Global navbar & footer** on every page: OS / operational / Docker status, theme toggle,
  clickable panel version and panel-ops buttons.
- **Self-service panel ops** from the UI:
  - **Update** — pull & deploy the latest panel code (shows the list of new commits).
  - **Fix / Repair** — rebuild the **current** release in place (no version change) with
    **real-time log streaming** into the modal.
  - **Restart** — restart the panel service or reboot the host.
  - **Update-available indicator** compares your HEAD against `origin/<branch>`.
- **Changelog viewer** — in-app timeline of releases (Added / Changed / Fixed) with search
  and an unread dot when a new version is available.
- **Design System layer** — reusable `DSPanel` / `DSModal` / `DSLabel` primitives enforce a
  consistent Header / Body / Footer layout across forms, cards and dialogs (showcase at `/design-system`).
- **Login**: modern split-screen with password visibility toggle and **Remember me**
  (30-day session vs 12-hour default).
- **Delete safety**: destructive actions require typing the exact project name to confirm.

### Environment handling
- **Nexus Standard Env Contract** — a fixed set of variable names every project uses
  (see [`memory/EMERGENT_DEPLOY_PROMPT.md`](./memory/EMERGENT_DEPLOY_PROMPT.md)).
- **Env scan** of the repo (`os.environ` / `process.env`) to detect required variables,
  reading defaults from a `## Environment Variables` table in the project's `README.md`.
- **Apply Standard Env** + **Generate JWT Secret** helpers; `JWT_SECRET` is auto-generated
  on deploy if empty and stored (stable across redeploys).
- **Deploy safety gate**: deploy is blocked (with a warning + force option) when a truly
  required variable is still empty.
- **Persistent storage**: `./storage` on the host is mounted into the backend container at
  `/app/data` (`LOCAL_STORAGE_DIR`), so uploads survive redeploys.

### Notifications & ops
- **Telegram notifications** on deploy / backup / update / rollback events (optional).
- **Ops automation**: health-check, nightly backup, one-command update with **auto-rollback**.
- **Housekeeping scheduler** (v1.3): periodic pruning of orphaned logs/metrics, backup retention,
  terminal-recording caps and Docker image/build-cache pruning so the panel stays fast over months of use.

---

## Architecture
```
                         ┌────────── VPS (Ubuntu 24.04, 1 public IP) ──────────┐
Internet ─► :80/:443 ─►  │  Nginx  ── panel.domain ─► Nexus Panel (this app)   │
                         │         ── app1.domain  ─► project 1 containers     │
                         │         ── app2.domain  ─► project 2 containers     │
                         │                                                     │
                         │  Nexus backend (systemd, 127.0.0.1:8001, root)      │
                         │     └─ controls: docker, nginx, certbot, git        │
                         │  MongoDB (docker: nexus-mongo, bound to bridge IP)  │
                         │  Each project = docker compose (backend+frontend)   │
                         └─────────────────────────────────────────────────────┘
```
- The **panel backend** runs natively via **systemd** (as root) so it can drive Docker,
  Nginx and Certbot on the host.
- The **panel frontend** is a static build served by Nginx.
- **MongoDB** runs as a container bound to the Docker bridge IP — reachable by the host
  and by project containers (`host.docker.internal`), but **not exposed publicly**.
- Deploys are **release-based** (`releases/<timestamp>` + atomic `current` symlink) →
  instant rollback and no half-built leftovers.

---

## Requirements
- **Fresh Ubuntu 24.04 LTS** server (root/sudo). Nothing else needs to be pre-installed —
  the installer adds Docker, Nginx, Certbot, Node 20, Python.
- A **domain** you control, with the ability to add DNS records.
- Your panel code pushed to a **Git repo** (this repository).

---

## Quick install (fresh server)

1. **Push this repo to GitHub** (public, or private + a PAT).

2. **Point DNS** — create an `A` record for the panel subdomain to your VPS IP, e.g.
   `panel.yourdomain.com → 203.0.113.10`.
   (For project subdomains, a wildcard `*.yourdomain.com → 203.0.113.10` is easiest.)

3. **Run the installer** on the server:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/youruser/nexus-panel.git
   cd nexus-panel/scripts
   sudo bash install.sh
   ```
   You'll be asked for: panel subdomain, Let's Encrypt email, Git repo URL/branch,
   optional GitHub token, and the admin username/password. Everything else
   (Docker, secrets, MongoDB, systemd, Nginx, SSL, firewall, nightly backup) is automatic.

4. Open **`https://panel.yourdomain.com`** and log in.

### Non-interactive / unattended install
Provide answers via environment variables:
```bash
sudo NONINTERACTIVE=1 \
  PANEL_DOMAIN=panel.yourdomain.com \
  LETSENCRYPT_EMAIL=you@yourdomain.com \
  GIT_REPO_URL=https://github.com/youruser/nexus-panel.git \
  GIT_BRANCH=main \
  GIT_TOKEN=ghp_xxx \
  ADMIN_USERNAME=superadmin \
  ADMIN_EMAIL=you@yourdomain.com \
  ADMIN_PASSWORD='choose-a-strong-one' \
  bash install.sh
```
Config is saved to `/opt/nexus-panel/nexus.conf` (see `scripts/config/nexus.conf.example`).

---

## DNS & SSL
- **Panel SSL** is issued automatically with **Let's Encrypt** and **auto-renews**
  (via the system `certbot.timer`). If issuance fails (usually DNS not propagated yet),
  the panel stays on HTTP and the installer prints the exact command to retry.
- **Project SSL** is chosen per project in the UI:
  - **Let's Encrypt** — automatic issuance + renewal, or
  - **Custom certificate** — provide paths to your existing cert/key (e.g. a **wildcard**
    Sectigo cert) on the server.

---

## Using the panel
1. **New Project** → wizard: repo URL + branch + (PAT for private), build config
   (DB name, env vars), domain + SSL mode, review → create.
2. Open the project → **Config → Scan Required Vars** to detect env variables the code uses.
   Defaults declared in the project's README table are filled automatically; use
   **Apply Standard Env** / **Generate JWT Secret** for the rest, then **Save**.
3. **Deploy** and watch the **live build logs** stream in. If a required variable is still
   empty you'll get a warning dialog (fill defaults, or deploy anyway).
4. Manage with **Start / Stop / Restart**, edit config, or **Delete** (removes containers,
   MongoDB database, nginx vhost, SSL cert and cloned source).

### Web Terminal
The **Terminal** page is a full browser shell — no SSH client needed:
- **Local** tab opens a shell on the VPS host (starts in `~`).
- Add **Servers** to connect to remote machines over SSH (password or key).
- **Split** toggles a two-pane view so you can watch two live sessions at once.
- Save frequently used **Commands** and run/paste them into the active pane.

### Preparing an Emergent project for deploy
Every project should follow the **Nexus Standard Env Contract** and include a
`## Environment Variables` table in its `README.md`. Ready-to-paste prompts for **new** and
**existing** Emergent projects are in
[`memory/EMERGENT_DEPLOY_PROMPT.md`](./memory/EMERGENT_DEPLOY_PROMPT.md).

---

## Operations
All ops scripts live in `scripts/` (also at `/opt/nexus-panel/current/scripts/` after install)
and read `/opt/nexus-panel/nexus.conf` automatically.

| Task | Command |
|---|---|
| **Update** panel to latest code (backup + deploy + auto-rollback on failure) | `sudo /opt/nexus-panel/current/scripts/update.sh` |
| **Repair / Fix** — rebuild the current release in place (no version change) | `sudo .../scripts/repair.sh` |
| **Roll back** to the previous release | `sudo .../scripts/rollback.sh` |
| **Backup** now (Mongo + config + nginx + project storage) | `sudo .../scripts/backup.sh` |
| **Restore** a backup | `sudo .../scripts/restore.sh latest` (or a file path) |
| **Health check** | `sudo .../scripts/healthcheck.sh` (add `--watch` to loop) |
| **Uninstall** (keep data/backups) | `sudo .../scripts/uninstall.sh` |
| **Uninstall + wipe everything** | `sudo .../scripts/uninstall.sh --purge` |
| Service logs | `journalctl -u nexus-panel -f` |
| Restart service | `sudo systemctl restart nexus-panel` |

- **Nightly backups** run automatically at 02:30 (`nexus-backup.timer`), keeping the last
  `KEEP_BACKUPS` (default 10). Backups are stored in `/opt/nexus-panel/backups/`.
- **Updates** pull a fresh shallow clone into a new `releases/<timestamp>`, build it, then
  atomically flip the `current` symlink. If the post-deploy health check fails, it
  **automatically rolls back**. Only the last `KEEP_RELEASES` (default 5) are kept.

---

## How deployment works
On deploy the panel backend:
1. `git clone`/pull your project (with PAT if private).
2. Ensures `JWT_SECRET` exists (auto-generates & stores it if empty).
3. Generates artifacts (always regenerated so template fixes apply): backend `Dockerfile`,
   frontend `Dockerfile`, `docker-compose.yml`, backend `.env` + frontend `.env`
   (`REACT_APP_BACKEND_URL=https://<subdomain>`), and an Nginx vhost. A persistent
   `./storage` volume is mounted into the backend at `/app/data` (`LOCAL_STORAGE_DIR`).
4. `docker compose up -d --build` (backend on `127.0.0.1:<8100+>`, frontend on `127.0.0.1:<3100+>`).
5. Installs the Nginx vhost for the subdomain and reloads Nginx.
6. Issues SSL (Let's Encrypt) or wires your custom certificate.

Managed variables (`MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`, `LOCAL_STORAGE_DIR`,
`REACT_APP_BACKEND_URL`) are injected by the panel and take precedence over any user copies.
Project containers reach MongoDB via `host.docker.internal:27017` (the shared `nexus-mongo`),
each using its own database name.

A background job re-scans every project's env references periodically
(`ENV_SCAN_INTERVAL`, default 30 min) to keep the dashboard readiness badge accurate.

---

## Directory layout (on the VPS)
```
/opt/nexus-panel/
├── nexus.conf                 # your install config
├── current -> releases/<ts>   # atomic symlink to the live release
├── releases/<timestamp>/      # each deployed version (frontend/ backend/ scripts/)
├── shared/backend.env         # panel secrets + admin (persists across releases)
├── venv/                      # backend Python virtualenv
├── apps/<slug>/               # cloned project sources + generated compose files
│   └── storage/               # persistent volume mounted to container /app/data
├── data/nginx/<slug>.conf     # generated project vhosts (staging, copied to sites-available)
└── backups/nexus-backup-*.tar.gz
```

---

## Troubleshooting
- **Panel not loading / 502**: `journalctl -u nexus-panel -n 100` and `sudo nginx -t`.
- **SSL failed**: confirm `dig +short panel.yourdomain.com` returns your IP, then rerun the
  `certbot --nginx ...` command the installer printed.
- **A project deploy ends in `error`**: open its **Deploy Logs** tab — the streamed output
  shows the failing step (git auth, build error, port clash, nginx test).
- **Docker/Mongo status**: `docker ps` should list `nexus-mongo` and each project's containers.
- **Re-running install is safe** — it's idempotent and cleans partial/failed builds.

---

## Security
- Change the admin password in **Settings** after first login (persists across restarts).
- Login is protected against brute force (5 failed attempts → 15-minute lockout).
- Secrets (`JWT_SECRET`, `PANEL_ENCRYPTION_KEY`) are generated at install and kept in
  `shared/backend.env` (mode 600). GitHub tokens are encrypted at rest.
- MongoDB is bound to the Docker bridge IP (not the public interface); UFW allows only
  22/80/443.

---

_Default admin (unless you changed it during install): username `superadmin`._
