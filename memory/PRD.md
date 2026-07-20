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

## Backlog / Roadmap
- P2: Filter/download deploy logs dari UI.
- P2: Alert Telegram saat container restart-loop terdeteksi (state=restarting).
