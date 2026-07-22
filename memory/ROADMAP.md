# Nexus Panel — Roadmap & Improvement Recommendations

> **v1.4.0 is the closed stable release** (see `CHANGELOG.md`). Everything below is
> future work. New changes go into the `[Unreleased]` section of `CHANGELOG.md` and
> roll into the next version.
>
> This file exists so any future agent has a clear, prioritized direction. Pick the
> highest-priority open item unless the user asks for something specific. Keep the
> **Indonesian communication / English UI** rule, and always use `DSPanel`/`DSModal`
> for any new form or dialog.

Last updated: 2026-06 (end of the 1.4.0 line).

---

## Priority legend
- **P0** — must-have / blocks correctness or safety.
- **P1** — high value, do next.
- **P2** — valuable, medium effort.
- **P3** — nice-to-have / larger scope.

---

## P1 — Do next

### 1. Role-Based Access Control (RBAC)
Today every user is a full admin (`role` field exists but is always `"admin"`).
Add real roles: **Owner / Admin / Developer / Viewer**.
- Backend: enforce role on every mutating endpoint (deploy, start/stop, delete, user mgmt,
  settings, terminal, ops). Add a `require_role(...)` dependency in `auth.py`.
- Frontend: conditionally render/disable actions by role; hide Users/Settings/Ops for
  Viewers/Developers as appropriate.
- Migration: existing users default to Admin; the seeded admin becomes Owner.
- **Call `integration_expert` before touching auth code.**

---

## P2 — Valuable, medium effort

### 2. Security hardening
- **SSH known-hosts verification** — the terminal currently uses `AutoAddPolicy`
  (`backend/terminal.py`). Add host-key pinning / verification to prevent MITM.
- **Two-factor auth (TOTP)** for panel login (optional per user).
- **API tokens** — scoped tokens for CI/programmatic use instead of sharing a password.

### 3. Resource guardrails & alerting
- **Per-project resource limits** — emit `deploy.resources.limits` (cpus/memory) into the
  generated `docker-compose.yml`.
- **Threshold alerts** — Telegram alert when a container/host exceeds CPU/RAM/disk
  thresholds (reuse the existing `metrics_sampler` + `send_telegram`).

### 4. Per-project database backup / restore
UI button to `mongodump`/`mongorestore` a single project's database (separate from the
whole-panel backup), with download.

### 5. Deploy approvals for production
When `environment == "production"`, require an explicit confirm/approval step before
deploy or auto-deploy (extends the existing env-gating dialog).

### 6. Tech debt — split `ProjectDetail.jsx`
It's ~1200 lines. Extract each tab (Overview / Configuration / Metrics / Deploy Logs /
Container Logs / History) into its own component file under
`frontend/src/components/project/`. No behavior change; keep all `data-testid`s.

---

## P3 — Nice-to-have / larger scope

### 7. Internationalization (i18n)
Multi-language UI via `react-i18next` (e.g. English + Indonesian). Extract UI strings to
locale files; keep code identifiers in English.

### 8. Cloud backups
Ship panel + project backup tarballs to **S3 / Google Drive** on a schedule (extend
`scripts/backup.sh` + a settings panel for provider creds; store secrets encrypted).

### 9. More notification channels
Beyond Telegram: **email (Resend/SendGrid)**, **Slack**, **Discord**, generic **webhook**.
Add a per-event channel matrix in Settings › Notifications.

### 10. Container shell from the UI
`docker exec` into a running project container from the Terminal page (a "shell into
container" action on the project).

### 11. Uptime history & incident log
Persist domain-health ping results over time; show an uptime % and a small incident
timeline per project (builds on the existing `domain-health` endpoints).

### 12. Scheduled deploys / maintenance windows
Cron-like scheduled deploys, and a maintenance-window toggle that pauses auto-deploy.

### 13. Multi-server support (big)
Manage projects across **multiple VPS** from one panel (the SSH server list already exists
as a foundation).

---

## Cross-cutting reminders for future agents
- **Language:** reply to the user in **Bahasa Indonesia**; keep all UI/code in **English**.
- **Design System:** any new card/form → `DSPanel`; any modal → `DSModal`; labels → `DSLabel`.
  Do not use raw shadcn `Card`/`Dialog`. Check `/app/design_guidelines.json`.
- **Auth = integration:** call `integration_expert` before any auth change.
- **Docker-dependent features** can only be fully verified on the VPS; in the sandbox they
  must degrade gracefully (no crashes / 500s). Repair streaming, panel-updates and real
  deploys fall in this bucket.
- **Env & credentials** only from `.env`; never hardcode. Keep `/app/memory/test_credentials.md`
  current after any auth change.
- **Version discipline:** log changes under `[Unreleased]` in `CHANGELOG.md`; bump the
  version only on a deliberate release (update `PANEL_VERSION` in `backend/server.py` and
  `frontend/package.json`).
