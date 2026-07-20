# Nexus Panel — Mini-PaaS Control Panel (PRD)

## Problem Statement
User memiliki 5 proyek full-stack (FastAPI + MongoDB + React) buatan Emergent, di-host di VPS Ubuntu 24.04 LTS dengan satu IP publik. Butuh control panel (mini-PaaS) untuk mengelola deployment: clone repo GitHub, auto-konfigurasi port, Nginx reverse proxy + SSL (Let's Encrypt / Custom Wildcard), provisioning DB MongoDB, kelola `.env`, kontrol lifecycle (start/stop/logs), notifikasi Telegram, dan script bash idempotent untuk manajemen VPS.

## Bahasa
User berbahasa INDONESIA. Selalu balas dalam Bahasa Indonesia.

## Arsitektur
- Backend: FastAPI + MongoDB (Motor), WebSockets untuk stream log build.
- deploy_engine.py: generate Dockerfile, docker-compose.yml, konfigurasi Nginx on-the-fly.
- Frontend: React + Tailwind + Shadcn + Framer Motion (tema gelap, JetBrains Mono, gaya Vercel/Railway).
- scripts/: install.sh, update.sh, backup.sh, restore.sh, rollback.sh, healthcheck.sh, uninstall.sh (idempotent).
- Integrasi: Telegram Bot API, Let's Encrypt/Certbot.

## Kredensial Admin
- superadmin / sa@4dm1n (lihat /app/memory/test_credentials.md)

## Status Fitur (Completed)
- Control Panel MVP (backend + frontend)
- JWT Auth + brute-force protection
- Real-time deploy logs via WebSockets
- UI revamp (dark, JetBrains Mono)
- Bash scripts idempotent
- Telegram notifications
- Fix berbagai bug instalasi VPS

## Changelog
- 2026-06: Fix bug build `emergentintegrations` — template `BACKEND_DOCKERFILE` di deploy_engine.py kini memakai `--extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/`. Selain itu `_write_artifacts` kini SELALU regenerate Dockerfile backend & frontend (sebelumnya di-skip jika file sudah ada), agar fix template berlaku saat redeploy. Terverifikasi lokal (string gen + backend health 200).
- 2026-06: 4 fitur baru (teruji 8/8 backend + frontend, iteration_7.json):
  1. **Rotasi Log** — deploy logs (MongoDB) dipangkas ke MAX_DEPLOY_LOGS=20 per proyek via `_prune_logs`; tiap deploy log dibatasi MAX_LOG_LINES=2000 baris via `$slice`. Container logs (Docker) memakai driver `json-file` dengan `max-size=10m`, `max-file=3` di `docker-compose.yml` yang di-generate.
  2. **Live Container Logs** — WebSocket `/api/ws/projects/{id}/container-logs` streaming `docker compose logs -f`; tombol "Go Live"/"Stop Live" di tab Container Logs.
  3. **Health per-container** — endpoint `GET /api/projects/{id}/health` & `GET /api/system/containers-health` (parse `docker compose ps --format json`). Panel "Container Health" di ProjectDetail + kolom "Containers" (dots) di Dashboard.
  4. **Notifikasi Deploy Detail** — Telegram menyertakan durasi build + ringkasan error saat deploy gagal (`_notify_deploy`, `_error_summary`, `_fmt_duration`).
  Catatan: fitur berbasis Docker terverifikasi degradasi mulus di sandbox (Docker tidak tersedia) — perlu diverifikasi penuh di VPS.
- 2026-06: Fix konflik dependency `ResolutionImpossible` — `BACKEND_DOCKERFILE` kini fallback ke `pip install --no-deps` bila install strict gagal (kasus: proyek & emergentintegrations sama-sama menunjuk URL wheel litellm identik). Terverifikasi dgn requirements.txt Flowdesk asli di venv bersih.
- 2026-06: Fix 404 setelah deploy sukses (2 bug nginx):
  1. **Directive http2** — `nginx_config` diubah dari `listen 443 ssl; http2 on;` (sintaks nginx 1.25.1+) ke `listen 443 ssl http2;` yang kompatibel dgn nginx 1.24.0 (Ubuntu 24.04). Sebelumnya `nginx -t` gagal → config tak pernah di-load → 404.
  2. **Bootstrap Let's Encrypt** — flow SSL didesain ulang: `_apply_web` menyajikan app + ACME challenge via HTTP dulu (buat `/var/www/certbot`), issue cert, lalu switch ke config HTTPS. Jika SSL gagal, situs tetap bisa diakses via HTTP (tidak 404). Directive http2 kedua config lolos `nginx -t` (nginx 1.22.1 sandbox).
- 2026-06: 3 fitur SSL/monitoring (teruji 9/9 backend + frontend, iteration_8.json):
  1. **Cek DNS Otomatis** — helper `check_domain_dns` (socket + public IP via ipify, override `PANEL_SERVER_IP`). `_apply_web` cek DNS sebelum certbot saat bootstrap letsencrypt; jika domain belum mengarah ke IP VPS, SSL di-skip (hindari rate-limit) & situs tetap di HTTP. Endpoint `GET /api/projects/{id}/dns-check`.
  2. **Renew SSL** — endpoint `POST /api/projects/{id}/renew-ssl` (guard 400 utk non-letsencrypt) + method `renew_ssl` (deploy log action='ssl': cek DNS → issue → switch HTTPS → reload). Tombol "Renew SSL" + "Check DNS" di ProjectDetail (muncul saat ssl_mode=letsencrypt).
  3. **Alert Restart-Loop** — background task `restart_loop_monitor` (server.py) poll `restart_stats` (docker inspect RestartCount + State); kirim alert Telegram bila restart ≥ RESTART_THRESHOLD(3) dalam RESTART_WINDOW(300s), throttle RESTART_ALERT_COOLDOWN(1800s).
- 2026-06: 4 fitur SSL/UX + 1 bugfix DNS (teruji 12/12 backend + frontend, iteration_9.json):
  1. **Badge SSL** — `SslBadge` (http/pending/active/expiring/expired + sisa hari) di kartu Projects, kolom SSL Dashboard, dan header ProjectDetail. Endpoint `GET /api/projects/{id}/ssl-status` & `GET /api/system/ssl-status` (parse expiry via cryptography x509).
  2. **Auto-Renew Terjadwal** — background task `ssl_renew_scheduler` (server.py) jalan `certbot renew` tiap SSL_RENEW_INTERVAL (default harian, no-op sampai <30 hari expiry) + reload nginx. Script cron opsional `scripts/renew-ssl.sh`.
  3. **Filter & Unduh Log** — `LogViewer` dapat prop `filterable` + `downloadable`: input pencarian (filter baris live) + tombol download .txt. Aktif di Deploy Logs & Container Logs.
  4. **Tombol URL Proyek** — link buka-tab-baru di kartu Projects, Dashboard, & header ProjectDetail (scheme https bila SSL aktif, else http; muncul bila domain diisi).
  5. **BUGFIX Deteksi IP DNS** — `check_domain_dns` kini cocokkan domain ke set kandidat: `PANEL_SERVER_IP` + IP publik + **IP interface lokal** (`get_local_ips` via psutil). Memperbaiki false-negative saat IP outbound VPS ≠ IP inbound (kasus user: domain→165.99.160.122 tapi ipify balas 165.99.160.108). Sekarang SSL bisa di-issue → tiap proyek punya blok HTTPS sendiri (mencegah domain proyek nyasar ke blok 443 default/Nexus Panel).
- 2026-06: **Menu Terminal (web shell ala aaPanel)** — teruji 19/19 backend + frontend (iteration_10.json):
  - Terminal Lokal (PTY bash via WebSocket `/api/ws/terminal/local`, xterm.js), multi-tab, close/new.
  - Server List SSH (paramiko) — CRUD `/api/terminal/servers` (secret dienkripsi Fernet, tidak pernah dikembalikan), auth password/key, connect buka tab SSH `/api/ws/terminal/ssh/{id}`.
  - Commands library — CRUD `/api/terminal/commands`, Run (kirim + Enter) / Paste (tanpa Enter) / Edit / Delete.
  - File: `backend/terminal.py`, `frontend/src/pages/TerminalPage.jsx`, `frontend/src/components/TerminalView.jsx`. Nav item `nav-terminal`, route `/terminal`.
- 2026-06: Penyempurnaan Terminal (self-test via API):
  - **Lokasi proyek default `/opt/nexus-panel/apps`** — `APPS_DIR` kini pakai `NEXUS_APPS_DIR` / `$NEXUS_HOME/apps` (default /opt/nexus-panel/apps) alih-alih di bawah PANEL_DATA_DIR.
  - **16 Command bawaan** di-seed sekali (`seed_default_commands`, ditandai `system:true`, idempotent via `app_meta`): update.sh/backup.sh/healthcheck.sh/renew-ssl.sh, git pull, docker ps/compose/prune, nginx reload, certbot certificates, df/free/htop, apt upgrade, cd apps dir.
  - Hardening `TerminalView` fit() (skip saat container 0px) untuk hilangkan error dev-overlay xterm-addon-fit.
- 2026-06: Cleanup hapus proyek + fix Terminal (self-test + screenshot):
  - **Hapus proyek kini bersih total** (`destroy`): `docker compose down -v --rmi local --remove-orphans` (container+volume+image built), hapus nginx conf (available+enabled) + reload, `certbot delete --cert-name {domain}`, **drop database MongoDB proyek** (`db_name`) — ini penyebab utama "re-install seolah data sudah ada", hapus folder proyek. Terverifikasi: db proyek benar-benar ter-drop setelah delete.
  - **Fix error xterm 'dimensions'** saat buka Terminal → upgrade `xterm@5.3` → `@xterm/xterm@6.0.0` (+`@xterm/addon-fit`), plus defer `term.open()` sampai container punya ukuran. Error overlay hilang.
  - **Fix layout Add Command** yang turun jauh → pakai wrapper `relative flex-1` + TabsContent `absolute inset-0` (bypass quirk sizing Radix). Tombol Add kini di atas, list scroll di bawah (verified btn_top=147).

## Backlog / Roadmap
- P2: Deteksi/peringatan env var wajib yang belum diisi sebelum deploy.
- P2: Recording/riwayat sesi terminal.
- P2: Known-hosts verification untuk SSH (saat ini AutoAddPolicy).