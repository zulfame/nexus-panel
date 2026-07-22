# Changelog

All notable changes to **Nexus Panel** are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

> **v1.9.0 is the current release (in active development).** v1.4.0 closed the previous
> line. New work is listed under the newest version heading below.

---

## [1.9.0] — 2026-06 · Observability, docs & quality (Phases 3–5)

### Added
- **Resource threshold alerts (Phase 3).** The metrics sampler now sends a throttled Telegram
  alert when a project's aggregate CPU crosses `CPU_ALERT_PCT` (default 90%) or RAM crosses
  `MEM_ALERT_MB` (default off). Metrics **retention extended to 72 h** (`METRICS_RETENTION_HOURS`)
  with a new **3-day range** in the metrics chart.
- **Interactive API docs (Phase 4).** Swagger UI at **`/api/docs`**, ReDoc at `/api/redoc`,
  schema at `/api/openapi.json`.
- **Audit log export + tamper-evidence (Phase 4).** Every audit record is now **hash-chained**
  (`seq`, `prev_hash`, `hash`); `GET /api/audit/verify` recomputes the chain and reports any
  break, and `GET /api/audit/export?format=csv|json` downloads the log. The Activity page gained
  **Verify / CSV / JSON** controls.
- **Committed-secret scanning (Phase 4).** The repo env-scan now also flags hard-coded secrets
  (private keys, AWS/Google/Slack/Stripe/GitHub tokens, DB URIs with passwords, JWTs, generic
  `secret=…` assignments), skipping obvious placeholders and vendored dirs. Findings are cached on
  the project and shown as a warning in the Environment tab.
- **Pagination** added to the terminal recordings list (`limit`/`skip`/`total`).
- **Centralized toast helper (Phase 5):** `frontend/src/lib/notify.js`
  (`notify.success/info/warn/error`) for consistent notifications.
- **CI pipeline (Phase 5):** `.github/workflows/ci.yml` — guards `requirements.txt` against
  non-PyPI deps, installs backend deps, runs the unit suite, and builds the frontend.
- **Automated test suite (Phase 5):** `backend/tests/test_core_units.py` — 8 unit tests covering
  secret encryption, audit hash-chain, disk guard, JSON restore shape detection/parsing, and
  committed-secret scanning. All green.

---

## [1.8.0] — 2026-06 · Reliability (Phase 2): disk guard + uptime monitoring

### Added
- **Disk-space guard.** Disk-heavy operations now refuse to run when free space is below a
  safety floor (`DISK_GUARD_MIN_FREE_MB`, default 2048 MB, and `DISK_GUARD_MIN_FREE_PCT`,
  default 5%), returning HTTP 507 with a clear message instead of failing mid-build or filling
  the disk. Enforced on **project deploy**, **panel backup** (`/ops/backup`) and **database
  backup** (`/databases/{id}/backup`).
- **Scheduled uptime monitoring + alerts.** A new background monitor (`UPTIME_CHECK_INTERVAL`,
  default 5 min) probes every project domain and sends a **Telegram alert on down → and again on
  recovery** (throttled by `UPTIME_ALERT_COOLDOWN`). The latest reachability is stored on each
  project (`domain_up`, `domain_checked_at`) and exposed via the API.
- **Disk-usage alert.** The same monitor sends a Telegram warning when host disk usage crosses
  `DISK_ALERT_PCT` (default 90%), throttled by `DISK_ALERT_COOLDOWN`.

*(Container restart-loop detection with Telegram alerts, historical CPU/RAM metrics, SSL
auto-renew and housekeeping/retention already shipped in earlier releases.)*

---

## [1.7.1] — 2026-06 · Fix: JSON restore of full-backup / wrapped exports

### Fixed
- **Database restore failed for full-backup JSON files** with `an inserted document is too large`.
  The v1.6.0 streaming shape-detector mis-classified exports whose root object starts with
  metadata fields or wraps collections (e.g. `{"metadata": {...}, "collections": {...}}`,
  `{"exported_at": ..., "users": [...], ...}`) as a single giant document, so `mongoimport`
  tried to insert the whole file as one record and hit MongoDB's 16 MB limit. JSON files up to
  120 MB are now parsed with a **robust in-memory shape detector** that correctly recognises
  plain arrays, NDJSON, object-of-arrays, metadata-prefixed objects, `collections`/`data`
  wrappers, and `{coll: {documents: [...]}}` layouts. Files above 120 MB keep the constant-memory
  streaming path. The restore preview now reflects the same accurate collections/counts.

---

## [1.7.0] — 2026-06 · Security hardening (Phase 1)

### Added
- **Session hardening.** Access tokens now carry a unique `jti` + `iat`. A new
  `revoked_tokens` collection (MongoDB TTL-expired at the token's own expiry) backs two new
  endpoints: `POST /api/auth/logout` (revoke the current session) and `POST /api/auth/logout-all`
  (bump the user's `token_epoch` to invalidate every existing session on all devices). The
  Settings → Account page gained an **"Active Sessions → Sign out all devices"** panel, and the
  sidebar **Sign out** now revokes the token server-side before clearing local storage.
- **Global API rate limiting.** A per-IP sliding-window middleware (`RATE_LIMIT_PER_MIN`,
  default 600/min) protects every `/api` route from abuse/DoS; WebSockets are exempt. Returns
  HTTP 429 when exceeded.
- **Secret env encryption at rest.** Project `env_vars` values and the Telegram bot token are
  now stored **encrypted** (Fernet, reusing `PANEL_ENCRYPTION_KEY`) with an `enc:v1:` marker.
  Values are transparently decrypted when read by the app/UI and when writing container `.env`
  files. A one-time idempotent startup migration encrypts any pre-existing plaintext secrets.

### Changed
- **Brute-force lockout is now per-IP + username** (was username-only), so one attacker IP
  can't lock a legitimate user out and grinding a single account from many requests is throttled.

---

## [1.6.0] — 2026-06 · Large-file database restore (streaming)

### Added
- **`ijson`** streaming JSON dependency, enabling constant-memory processing of very large
  exports.

### Fixed
- **Panel update failed with `No matching distribution found for emergentintegrations`.** The
  `requirements.txt` had been accidentally overwritten by a `pip freeze` of the whole dev
  environment, pulling in the internal `emergentintegrations` package and a private `litellm`
  wheel URL that don't exist on public PyPI, so `pip install` failed on the VPS and the updater
  auto-rolled-back. Restored the minimal, PyPI-only dependency list (14 original packages +
  `ijson`).
- **Added a pre-deploy guard** in `scripts/lib/common.sh` (`validate_requirements`, run by
  `deploy_release` before pip/yarn): the update now aborts *early* with a clear message if
  `requirements.txt` contains the internal-only `emergentintegrations` package or any private
  direct-URL/wheel dependency (e.g. `emergentagent.com`), so this class of breakage can't reach
  a full build/rollback cycle again.

### Changed
- **Database restore now handles 100 MB – 1 GB+ backup files without crashing.** Previously a
  JSON restore read the entire file into memory (`read_text` + `json.loads` + re-dump), which
  could consume several GB of RAM and get the process OOM-killed. JSON handling was rewritten to
  **detect the file shape by peeking** (a single `[…]` array, NDJSON, a full-database object of
  arrays, or a single document) and then:
  - **array / NDJSON** → stream the file **directly into `mongoimport`** (no in-memory copy, no
    temp re-dump).
  - **multi-collection object** → stream each collection out with `ijson` into a temporary NDJSON
    file, one document at a time (constant memory).
  - Verified: a **125 MB / 400k-doc** array restores in ~13 s with **~57 MB peak RSS**.
- **Restore preview (inspect) is now lightweight** — for files above 25 MB it detects the shape
  and lists collections without loading the file or computing exact counts, so the preview modal
  never stalls or OOMs on large exports. Multi-collection enumeration is skipped above 250 MB.
- **Archive (`.gz`) restores skip a redundant `--dryRun` pass.** The source-database detection
  computed for the restore preview is now cached to a hidden `.meta` sidecar and reused by the
  restore job, roughly halving the work for large archives.
- **Chunked uploads are more robust for large files** — chunk size raised from 4 MB to 8 MB and
  each chunk now **retries up to 3× with backoff** on transient network errors.

### UI
- **Project detail tabs reordered**: `Environment` now sits directly after `Configuration`
  (`Overview · Configuration · Environment · Metrics · Deploy Logs · Container Logs · History`).

---

## [1.5.11] — 2026-06 · On-brand toast styling

### Changed
- Replaced Sonner's generic `richColors` with **custom on-brand toasts** built from the design
  tokens (`--ds-success` / `--ds-info` / `--ds-warning` / `--ds-danger`): a colored left accent,
  a subtle matching tint, and a **distinct icon per type** (check / info / triangle / cross), so
  toasts blend with the panel theme in both light and dark mode.

---

## [1.5.10] — 2026-06 · Toast colors per type

### Changed
- **Toasts are now color-coded by type** instead of all looking the same: **success = green,
  info = blue, warning = amber/orange, error = red** (Sonner `richColors`). Toasts also **follow
  the active light/dark theme** instead of always rendering dark, and gained a close button.

---

## [1.5.9] — 2026-06 · Manual "Check update" button

### Added
- **"Check update" button** in the Update dialog that **forces a fresh git check** (bypassing
  the 5-minute cache) — no more waiting/guessing after pushing new code.

### Changed
- The Update dialog now shows **"Check update"** when you're up to date and only switches to
  **"Start update"** when a newer version is actually detected — so **Start update can no longer
  be clicked when there's nothing to update**. A toast reports the result of each check.

---

## [1.5.8] — 2026-06 · Fix: confirm before deleting from the Projects list

### Fixed
- **Deleting a project from the Projects list (card 3-dot menu → Delete) removed it instantly
  with no confirmation.** It now opens the same **type-the-name-to-confirm** dialog used on the
  Project Detail page, preventing accidental deletions.

---

## [1.5.7] — 2026-06 · Restore contents preview

### Added
- **Contents preview before restoring.** The Restore dialog now inspects the selected archive/
  JSON first and shows the collections it will import — with **document counts for JSON** and the
  detected **source database** (and its remap target) for mongodump archives — so you can confirm
  what will land in production before overwriting anything.

---

## [1.5.6] — 2026-06 · Restore from JSON exports

### Added
- **Restore a database from a JSON export** (via `mongoimport`), not just gzipped mongodump
  archives. Upload a `.json` file on the Databases page and the panel **auto-detects** its shape:
  a single array of documents, NDJSON (one doc per line), or a **full-database object**
  `{ "users": [...], "orders": [...] }` — importing each key as its own collection. MongoDB
  Extended JSON (`$oid`, `$date`, …) is preserved. Merge by default, with the same
  "Drop & overwrite" option.

---

## [1.5.5] — 2026-06 · Fix: Update modal hangs after a panel update

### Fixed
- **The "Updating panel" modal could get stuck forever** (couldn't be closed) after an update
  finished and you logged back in. Root cause: ops scripts (`update.sh`/`repair.sh`) ran inside
  the panel service's systemd cgroup, so when the script restarted `nexus-panel`
  (`KillMode=control-group`) systemd **killed the script mid-run** — it never wrote its
  completion marker, so the UI polled "running" indefinitely. Ops scripts now launch via
  **`systemd-run`** as a separate transient unit (their own cgroup) that survives the service
  restart and always writes the marker.
- **Safety net:** the log endpoints now return the log's `age`; the panel only auto-resumes a
  *fresh* in-flight update (< 10 min) and force-closes a run whose log has been idle too long, so
  a stale log can never resurrect a stuck modal.

---

## [1.5.4] — 2026-06 · Install database tools from the UI

### Added
- **"Install database tools" button** on the Databases page (shown when `mongodump`/
  `mongorestore` are missing). It installs MongoDB Database Tools on the host with **live
  streaming logs — no SSH required**. The panel detects the tools at runtime, so backup/restore
  light up as soon as the install finishes (just Refresh). `install_mongo_tools` now lives in
  `lib/common.sh`, shared by `install.sh` and the new `install-db-tools.sh`.

---

## [1.5.3] — 2026-06 · Fix: database tools install on Ubuntu 24.04

### Fixed
- `install.sh` failed to install **MongoDB Database Tools** on **Ubuntu 24.04 (noble)** because
  the mongodb-org 7.0 apt repo has no `noble` component (fresh installs showed "Database tools
  not installed"). The installer now downloads MongoDB's official **standalone Database Tools
  `.deb`** (auto-detecting distro + architecture) with an apt 8.0-repo fallback, so
  `mongodump`/`mongorestore` install reliably on Ubuntu 20.04/22.04/24.04 and Debian 11/12.
  The panel detects the tools at runtime, so a page **Refresh** enables backup/restore
  immediately after they're installed — no restart needed.

---

## [1.5.2] — 2026-06 · Hotfix: fresh-install startup + database tools

### Fixed
- **Backend failed to start on a fresh VPS install** (systemd `nexus-panel` inactive / "api not
  responding"). The Databases archive-upload endpoint uses multipart form data, which requires
  **`python-multipart`** — it was missing from `backend/requirements.txt`, so FastAPI raised at
  startup and uvicorn never came up. Added the dependency.

### Changed
- `install.sh` now installs **MongoDB Database Tools** (`mongodump`/`mongorestore`) on the host,
  OS-aware (Debian/Ubuntu) and best-effort, so the Databases backup/restore feature works out of
  the box on a fresh install.
- **Health check now surfaces the cause of failures automatically**: whenever the service or API
  fails to come up (during install / update / repair), the last 20 `journalctl -u nexus-panel`
  lines are printed inline — no more guessing why a fresh install didn't start.

---

## [1.5.1] — 2026-06 · UI polish: navbar / footer status split

### Changed
- **De-duplicated system status.** The **navbar** now shows only the server **OS**; the
  **footer** shows **System Operational** and **Docker** status. Removed the duplicate OS from
  the footer and the duplicate Operational/Docker indicators from the navbar.
- The footer product name is now the static **NEXUS.PANEL** wordmark and no longer follows the
  configurable **System Name** in Identity settings.

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
