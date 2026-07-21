# Changelog

All notable changes to **Nexus Panel** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.4.0] — 2026-06 · Projects & Project Detail redesign

### Added
- **Projects page** redesigned into a professional dashboard: status stat cards
  (Total / Running / Deploying / Stopped / Failed), toolbar (search + status filter +
  sort + grid/list view toggle), per-card 3-dot action menu (Deploy / Start / Stop /
  Restart / Delete), contextual card footer (failed alert, deploy progress, Start button,
  live CPU/RAM meters), pagination and result count.
- **Project Detail** redesigned: breadcrumb header + Created/Updated timestamps, aligned
  meta strip (Branch / Domain / Ports / Database), 5 stat cards
  (Status / Deployment / Uptime / Last Deploy / Environment), and an **Overview** tab
  (Source Updates + Auto-Deploy, Container Health, Configuration Summary) alongside
  Configuration / Metrics / Deploy Logs / Container Logs / History.
- **Sidebar system-info footer**: panel version, operational status, Docker state, server OS.
- Backend endpoints `GET /api/system/panel-info` and `GET /api/system/containers-stats`.

### Fixed
- Terminal toolbar buttons (Split / New) now clearly visible in both light and dark themes.
- Terminal renders **JetBrains Mono** reliably (re-measures glyphs after the web font loads).
- Light-mode input/border visibility across Settings, Project Detail, Login and forms.

---

## [1.3.0] — 2026-06 · Terminal recording, theming & housekeeping

### Added
- **Automatic terminal session recording** (local + SSH) with a replay player
  (play / pause / restart / speed / seek). Retention: newest 50, ~2 MB each.
- **Theme presets** (Ocean, Emerald, Sunset, Violet, Rose, Slate, Amber, Cyan) and a
  **dynamic primary color** stored in Settings › Identity, applied panel-wide.
- **Swipe-to-open** sidebar on touch devices.
- **Housekeeping scheduler**: prunes orphaned logs/metrics/history, enforces backup and
  recording retention, and prunes dangling Docker images / build cache periodically.

### Changed
- Unified typography to a single design language (JetBrains Mono kept for code/terminal).

---

## [1.2.0] — 2026-06 · Design System & light/dark themes

### Added
- Bespoke **Design System** (tokens, primitives) with full **light / dark** mode toggle.
- Custom **branding**: system name, tagline, logo, favicon.
- Global theme unification across all pages and the sidebar.

---

## [1.1.0] — 2026-06 · CI/CD

### Added
- **Deploy History** with notes, status and a visual **deploy timeline** chart.
- **One-click Rollback** to any previous commit.
- **Auto-Deploy GitHub Webhooks** (HMAC-verified, opt-in per project) + webhook activity log.
- **Git Diff viewer** and **Check for Updates** with dashboard badges + Telegram alerts.
- Activity-log pagination and backup list scrolling.

---

## [1.0.0] — 2026-05 · Initial mini-PaaS

### Added
- GitHub pull (public/private via PAT), subdomain + Nginx reverse proxy, per-project SSL
  (Let's Encrypt or custom), auto port assignment, per-project MongoDB, env editor.
- Lifecycle controls (deploy / start / stop / restart / delete) with live WebSocket build logs.
- Dashboard with CPU/RAM/disk meters and env-readiness scanning.
- Web Terminal (local PTY + SSH, tabs, split view, saved servers/commands).
- Multi-user auth (JWT) with brute-force protection and an audit log.
- Ops automation: health-check, nightly backup, one-command update with auto-rollback.
- Optional Telegram notifications.
