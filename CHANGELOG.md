# Changelog

All notable changes to **Nexus Panel** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

> **v1.5.0 is the current release (in active development).** v1.4.0 closed the previous
> line. New work is listed under the newest version heading below.

---

## [1.5.0] — 2026-06 · Databases + streaming panel update

### Added
- **Databases** — a new sidebar section to manage every project's MongoDB from the panel:
  list all project databases with live stats (size, collections, objects), one-click
  **Backup** and **Restore** (merge by default, optional "Drop & overwrite") with real-time
  streaming logs, **Upload** an external mongodump archive and restore it (auto-remaps a
  differently-named source database into the project's production database), plus
  **Download** and **Delete** of archives and automatic retention.

### Optimized
- **Panel Update flow** is now a blocking, streaming process: clicking **Start update** shows
  live progress and locks the UI (the Update/Fix/Restart buttons are disabled and the window
  can't be dismissed) so the update runs without interruption — and it **auto-resumes** the
  progress view if the page is reloaded mid-update. A **Reload panel** button appears when the
  update finishes.
- **Change Logs** gained a dedicated **Optimized** category (distinct icon & color) so
  performance/flow improvements are tracked separately from features and fixes.

See [`memory/ROADMAP.md`](./memory/ROADMAP.md) for the prioritized backlog and
improvement recommendations.

---

## [1.4.0] — 2026-06 · Redesign, global chrome, design system & panel ops

The largest release: a full UI redesign of Projects & Project Detail, a global
navbar/footer, a reusable design-system component layer (DSPanel / DSModal / DSLabel),
domain health monitoring, panel self-service ops (Update / Fix / Restart) with a
changelog viewer, environment tagging, a redesigned login, and quality-of-life auth.

### Added
- **Projects page redesign** — status stat cards (Total / Running / Deploying / Stopped /
  Failed), toolbar (search + status filter + sort + grid/list toggle), per-card 3-dot
  action menu (Open / Deploy / Start / Stop / Restart / Delete), contextual card footer
  (failed alert, deploy progress bar, Start button, live CPU/RAM meters), pagination and
  result count.
- **Project Detail redesign** — breadcrumb header + Created/Updated timestamps, aligned
  meta strip (Branch / Domain / Ports / Database), 5 stat cards
  (Status / Deployment / Uptime / Last Deploy / Environment), and a controlled **Overview**
  tab (Source Updates + Auto-Deploy, Container Health, Configuration Summary) alongside
  Configuration / Metrics / Deploy Logs / Container Logs / History.
- **Global sticky navbar** (all pages) — OS/operational/Docker status, theme toggle,
  clickable panel version, and **Update / Fix / Restart** panel-ops buttons.
- **Global footer** (all pages) — copyright, system name, version/build, operational status.
- **Changelog viewer modal** — timeline of releases (Added / Changed / Fixed) with search +
  category filter and an **unread dot** on the version button when a new release is available.
  Backend `GET /api/system/changelog` parses this file.
- **Panel self-service ops** — `POST /api/ops/update`, `POST /api/ops/fix`,
  `POST /api/ops/restart` (panel|server), plus a live **Update available** indicator
  (`GET /api/system/panel-updates`, git fetch vs origin) showing the list of new commits.
- **Real Repair** — `scripts/repair.sh` rebuilds the **current** release in place (no version
  change) with **real-time log streaming** to the Fix modal (`GET /api/ops/repair-log`).
- **Environment tag per project** — free-form `environment` (production / staging / demo…)
  in the wizard, Configuration tab, Configuration Summary and a stat card, plus a colored
  **EnvBadge** on Projects cards and the Dashboard table.
- **Domain Health monitoring** — reachability ping (`GET /api/projects/{id}/domain-health`,
  `GET /api/system/domains-health`) with green/red status dots on Projects cards, the
  Dashboard table, and the Project Detail header.
- **Design System component layer** — `DSPanel` (Header / Body / Footer form card),
  `DSModal` (tinted header + scrollable body + footer) and `DSLabel`, applied consistently
  across Settings, Project Detail and modals. Showcase at `/design-system`.
- **Login redesign** — modern split-screen (brand panel + form) with password visibility
  toggle and a **Remember me** option (30-day vs 12-hour token).
- **Sidebar system-info footer**, `GET /api/system/panel-info` and
  `GET /api/system/containers-stats`.

### Changed
- Sidebar **Dashboard → Overview** (LayoutGrid icon); home page title updated to match.
- Adjustable **JWT token lifetime** — 30 days when "Remember me" is checked, else 12 hours;
  token stored in `localStorage` (remember) or `sessionStorage` (session-only).
- **Delete confirmation** now requires typing the exact project name; destructive dialogs
  migrated to `DSModal`.
- Unified typography and light/dark input visibility across the app.

### Fixed
- Terminal renders **JetBrains Mono** reliably (re-measures glyphs after the web font loads).
- Terminal toolbar buttons (Split / New) clearly visible in both themes.
- Responsive layout hardening for small screens (navbar, headers, tables, terminal).

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
