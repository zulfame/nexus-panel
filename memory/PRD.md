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

- 2026-06: **Env Var Warning + Generate Secret** (backend 5/5 iteration_13, frontend 100% iteration_14):
  1. **Scan Env Wajib** — endpoint `GET /api/projects/{id}/env-scan` (`deploy_engine.scan_env`): clone repo & scan `os.environ[..]/os.environ.get(..)/os.getenv(..)` (backend) + `process.env.<KEY>` (frontend). ENV_IGNORE mengecualikan MONGO_URL/DB_NAME/REACT_APP_BACKEND_URL. Repo tak-bisa-clone → `scanned:false` + message (tanpa 500). UI tombol "Scan Required Vars": chip hijau (sudah diisi)/merah (belum), banner peringatan var hilang, klik chip merah auto-append (nilai hex acak untuk key secret-hint).
  2. **Generate JWT Secret** — tombol generate nilai hex acak aman langsung ke textarea env.
  3. **BUGFIX stale-closure** (iteration_14): hidrasi `envText` di `loadProject` kini init-once via `envInitRef` (useRef), bukan `if(envText==='')`. Sebelumnya polling 4 detik menghapus editan user (Generate Secret & chip). Terverifikasi nilai bertahan melewati beberapa siklus poll.

## Terminal
- Terminal lokal kini dibuka di home directory user (`cd ~`) — `os.chdir(expanduser("~"))` sebelum exec shell di `terminal.py::local_terminal_session`. Terverifikasi via WS (`pwd` → /root).
- classifyEnv (ProjectDetail.jsx) diperluas: default cerdas untuk variabel non-standar — flag boolean (RESEED→false, SEED_ON_STARTUP→true, ENABLE_/USE_/DEBUG→false), folder (BACKUP_DIR→/app/data/backups, LOG_DIR→/app/data/logs, UPLOAD→/app/data/uploads, APP_DIR→/app), angka/url/email diberi petunjuk. EMERGENT_DEPLOY_PROMPT.md diberi aturan: variabel non-standar WAJIB punya default aman di kode (os.environ.get(k, default)) + didokumentasikan di README.md (tabel Wajib/Opsional/Default/Deskripsi).

## Kontrak Env Standar Nexus
Semua project memakai nama variabel yang sama (lihat /app/memory/EMERGENT_DEPLOY_PROMPT.md untuk prompt Emergent):
- Disuntik panel: MONGO_URL, DB_NAME, CORS_ORIGINS, REACT_APP_BACKEND_URL.
- Panel auto-generate: JWT_SECRET (dibuat sekali saat deploy bila kosong, disimpan ke project → stabil antar-redeploy).
- User isi: ADMIN_EMAIL, ADMIN_PASSWORD.
- Opsional: EMERGENT_LLM_KEY.
- Storage: LOCAL_STORAGE_DIR=/app/data (panel mount ./storage:/app/data → persisten).

## Ringkasan Env + Layout Settings (2026-06)
- Cache env di project (`env_missing_required`, `env_scanned_at`, `env_required`): diisi saat `scan_env`, di-recompute saat simpan env (tanpa clone ulang via `DeployEngine.compute_missing_required`). Terverifikasi curl.
- Badge "N env wajib kosong" (amber) di kartu Projects + kolom "ENV" di tabel Dashboard.
- Prompt Emergent (EMERGENT_DEPLOY_PROMPT.md): section `## Environment Variables` di README kini WAJIB (tabel 4 kolom) + poin konfirmasi (5).
- Halaman Settings dirombak jadi grid 2 kolom (`max-w-6xl`, Server Operations span 2 kolom) — memperbaiki ruang kosong di sisi kanan. Terverifikasi screenshot.

## Penyesuaian lanjutan (2026-06)
- Layout Settings full-width (`p-8`, tanpa max-w center) agar konsisten lebar dengan Dashboard/Projects. Terverifikasi screenshot.
- `EMERGENT_DEPLOY_PROMPT.md` ditulis ulang dalam Bahasa Inggris + menambah PROMPT B (panduan retrofit untuk project Emergent yang SUDAH ada). README.md & DEPLOY_VPS.md sudah English.
- Scan env terjadwal: `env_scan_scheduler` (server.py) jalan tiap `ENV_SCAN_INTERVAL` (default 1800s), scan semua project → memperbarui cache `env_missing_required` agar badge Dashboard/Projects selalu akurat tanpa buka Config. Scan reuse repo lokal (baca file, tanpa clone ulang bila `.git` ada).
- UI polish: Settings memakai layout masonry (`lg:columns-2`) agar card memadat tanpa ruang kosong; halaman Terminal dibungkus box berpadding (`p-8` + border rounded) agar konsisten dengan halaman lain. Terverifikasi screenshot.
- No-crawl: `frontend/public/robots.txt` (Disallow: /) + meta `noindex,nofollow` di index.html agar panel tidak terindeks mesin pencari (berlaku di deploy VPS).
- Panel Identity (branding): backend `GET/PUT /api/settings/branding` (singleton doc `settings/branding`), field system_name/tagline/logo/favicon (logo & favicon terima URL atau data-URL base64 hasil upload). Frontend `BrandingContext` menerapkan favicon+title global; Layout & Login memakai logo/nama/tagline; Settings punya card "Panel Identity" dengan ImageField (toggle URL/Upload + preview). Terverifikasi end-to-end (save → sidebar live update).
- Konsistensi Bahasa Inggris: semua string UI Dashboard/Projects/ProjectDetail dikonversi ke Inggris; ukuran nama project di tabel Dashboard dikecilkan (`text-sm`) agar seimbang.
- Tombol "Scan Semua Project" di Dashboard → `POST /api/projects/scan-all` memindai semua project & refresh cache badge sekaligus (toast ringkasan: jumlah env wajib kosong / project gagal discan / semua siap). Terverifikasi screenshot end-to-end.
- Split Terminal: tombol Split/Unsplit di TerminalPage membagi layar jadi 2 panel berdampingan (kiri=active hijau, kanan=split biru) dengan header per-panel; sesi tetap hidup (TerminalView mounted sekali, layout flex `flex-1`/`hidden`). ResizeObserver di-coalesce via rAF + suppressor error benign "ResizeObserver loop" di index.js agar overlay CRA tidak muncul saat 2 terminal refit bersamaan. Terverifikasi screenshot (2 sesi independen, 0 error overlay).
- Audit struktur & dokumentasi (2026-06): README.md disinkronkan dengan fitur terkini (Terminal/split, env scan & standard contract, storage persisten, Telegram, badge/scan-all, auto-JWT, scan berkala); Directory layout dikoreksi ke `apps/<slug>/storage` + `data/nginx`. install.sh dirapikan (PANEL_DATA_DIR=data root, tambah NEXUS_APPS_DIR, mkdir apps yang benar) agar sesuai runtime. backup.sh/restore.sh kini menyertakan storage persisten per-project. Semua script tervalidasi `bash -n`.

## Multi-user, Audit Log & Metrics (2026-06)
- Multi-user tanpa peran: semua user = admin penuh. `GET/POST/DELETE /api/auth/users` (min username 3 / password 6; tak bisa hapus diri sendiri, seed admin, atau user terakhir). UI: Settings → card "Users".
- Audit log: helper `audit.log_event(db, actor, action, target, meta)` merekam login, user.create/delete, project.create/update/delete/deploy/start/stop/restart, branding.update, change_password. `GET /api/audit?limit&q&action`. UI: halaman "Activity" (nav baru) dengan tabel + filter + badge warna per action.
- Metrik historis: background `metrics_sampler` (tiap `METRICS_INTERVAL`=60s) sampling `docker stats` per container project running → `db.metrics` (retensi `METRICS_RETENTION_HOURS`=24). `engine.container_stats` + `_parse_mem_mb`. `GET /api/projects/{id}/metrics?minutes`. UI: tab "Metrics" di ProjectDetail dengan chart recharts CPU% & Memory(MB) per container + range 15m/1h/6h/24h. Terverifikasi (data sintetis) via screenshot.

## Settings tabs (2026-06)
- Halaman Settings dirombak dari masonry cards menjadi Tabs berkategori: Account (Admin Account + Change Password), Users, Identity (branding), Notifications (Telegram), System (Host Capabilities + Server Operations). Lebih rapi & jelas. Terverifikasi screenshot semua tab.

## Skalabilitas Tampilan Data Besar (2026-06)
- **Activity/Audit pagination**: `GET /api/audit` kini terima `skip` & balas `{items, total, limit, skip}` (limit max 200). Halaman Activity pakai pagination server-side (page size 50) dengan footer "Showing X–Y of N", tombol Prev/Next + indikator page, dan tabel scrollable (sticky header, `max-h-[calc(100vh-300px)]`). Reset ke page 1 saat query berubah. Terverifikasi (curl skip/total + screenshot UI).
- **Retensi audit log**: `prune_audit_logs()` dipanggil di loop `metrics_sampler` → cap `audit_logs` ke `AUDIT_MAX_RECORDS` (default 10000) record terbaru. Index `audit_logs.ts(-1)` dibuat saat startup.
- **Backups list scrollable**: daftar backup di Settings→System dibungkus `max-h-[320px] overflow-y-auto` agar tidak memanjangkan halaman saat backup menumpuk.

## Update Project dari GitHub (Check for Updates) — 2026-06
- **Backend** `DeployEngine.check_updates(project, token)`: `git fetch origin <branch>` lalu bandingkan HEAD lokal vs `origin/<branch>`. Balas `{checked, cloned, up_to_date, behind, branch, current, remote, commits[]}`. `current/remote` = {hash, short, message, author, date}; `commits` = daftar commit baru (maks 20). Repo belum di-clone → `cloned:false`. Terverifikasi dengan repo asli (octocat/Hello-World reset HEAD~1 → behind=2 + daftar commit benar).
- **Endpoint**: `GET /api/projects/{id}/updates` (cache `updates_behind`, `updates_checked_at`, `current_commit`, `remote_commit` ke project doc) & `POST /api/projects/check-all-updates` (cek semua project sekaligus). Field baru di model Project.
- **Scheduler**: `update_check_scheduler` (server.py) jalan tiap `UPDATE_CHECK_INTERVAL` (default 900s) → refresh cache badge update di background.
- **Frontend ProjectDetail**: panel "Source Updates" — tampilkan commit terpasang (short+message), badge "N updates available"/"Up to date", daftar commit baru (scrollable max-h-180), tombol "Check for Updates" (live fetch) & "Update Now" (muncul saat behind>0). "Update Now" memakai flow `deploy` → **gating cek env wajib tetap aktif** (428 dialog) sesuai permintaan user (server production).
- **Frontend Dashboard**: kolom "Updates" (badge amber "N new" / "latest") + tombol "Check Updates" (POST check-all-updates). Terverifikasi screenshot (Dashboard kolom + ProjectDetail panel, 0 error).

## Deploy History, Rollback & Telegram Update Alert — 2026-06
- **Deploy History**: koleksi baru `deploy_history` (retensi `MAX_DEPLOY_HISTORY`=50/project). `deploy()` merekam tiap deploy/rollback: `{action, commit{hash,short,message,author,date}, status(success/error), message, started_at, finished_at, duration_s, log_id}`. Commit ditangkap via `_head_commit(pdir)` setelah git step. Endpoint `GET /api/projects/{id}/history`. UI: tab "History" di ProjectDetail (tabel When/Type/Commit/Result/Duration + badge "current" pada commit yang sedang jalan). Terverifikasi engine dgn repo git asli (deploy commit b0262ad + rollback ke 9835ed1 keduanya terekam).
- **Rollback Commit**: `deploy(project, token, target_commit, action="rollback")` — `git fetch --unshallow` (deepen) → `git fetch origin <sha>` → `git reset --hard <sha>` → rebuild. **Clone awal diubah dari `--depth 1` ke full clone** agar riwayat commit tersedia untuk rollback. Endpoint `POST /api/projects/{id}/rollback` body `{commit}` (400 bila kosong). UI: tombol "Rollback" pada baris history status=success yang bukan commit current + dialog konfirmasi. **Rollback TIDAK melewati env-gating** (pemulihan ke versi yang sudah pernah jalan). Terverifikasi (git reset ke commit lama sukses, endpoint validasi).
- **Telegram Update Alert**: di `update_check_scheduler`, saat project `behind>0` dan `remote.hash != updates_alerted_commit` → kirim Telegram (\U0001f514 nama + jumlah update + commit terbaru), throttle via field baru `updates_alerted_commit` (alert sekali per commit remote baru). Field `updates_alerted_commit` ditambah ke model Project. Index `deploy_history(project_id, started_at)` dibuat saat startup. Catatan: alert Telegram belum diuji runtime (butuh bot terkonfigurasi + update nyata di VPS), mengikuti pola `send_telegram` yang sudah ada.

## English-Only + Mobile/Tablet Responsive — 2026-06
- **Full English conversion**: sisa string Bahasa Indonesia dikonversi ke Inggris — validasi project & konflik slug/domain/port (server.py), pesan 428 deploy-gating ("N required variable(s) are still empty..."), notifikasi Telegram deploy sukses/gagal + ringkasan error + restart-loop + update-alert (deploy_engine.py & server.py), "No changes" pada update kosong, komentar classifyEnv (ProjectDetail.jsx), dan `scripts/renew-ssl.sh` ("SSL renew job FAILED"). Docs (README/DEPLOY_VPS/EMERGENT_DEPLOY_PROMPT/install.sh) sudah English (diverifikasi grep bersih).
- **Responsive Layout**: sidebar jadi off-canvas drawer di <lg (fixed w-64, `-translate-x-full` → `translate-x-0` saat dibuka, `lg:translate-x-0`), backdrop blur (`sidebar-backdrop`), tombol hamburger (`sidebar-open-btn`) + close (`sidebar-close-btn`) di mobile top bar (sticky, `lg:hidden`), main `lg:ml-64`. Nav klik menutup drawer. Terverifikasi (innerWidth 414 → sidebar x=-256 default, x=0 saat open, hamburger visible, backdrop ada).
- **Responsive pages**: PageHeader `px-4 sm:px-8`, flex-wrap actions, judul `text-xl sm:text-2xl`, sticky `top-14 lg:top-0` (di bawah mobile bar). Padding konten semua halaman `p-4 sm:p-6 lg:p-8`. Tabel (Dashboard projects, Activity, ProjectDetail history, Settings users) dibungkus `overflow-x-auto` + `min-w`. Tabs ProjectDetail scrollable horizontal. AddProject grid `sm:grid-cols-2`. TerminalPage stack `flex-col lg:flex-row` (terminal atas, panel Servers/Commands bawah h-64 di mobile). ProjectDetail header stack `flex-col sm:flex-row`. Terverifikasi screenshot mobile (Dashboard, ProjectDetail, Terminal, drawer) 414px.

## Auto-Deploy Webhook (per-project, optional) — 2026-06
- **Per-project toggle**: field `auto_deploy_enabled` (default false) + `webhook_id` (unguessable URL token) + `webhook_secret` (HMAC), digenerate saat create project (lazy-generate untuk project lama via GET webhook). `ProjectUpdate` menerima `auto_deploy_enabled`. `project_public` menyembunyikan `webhook_secret`, ekspos `has_webhook`.
- **Receiver** `POST /api/webhooks/github/{webhook_id}` (TANPA auth, dipanggil GitHub): verifikasi HMAC-SHA256 `X-Hub-Signature-256` (constant-time), handle event `ping`→pong & non-push→ignore, dedupe via `X-GitHub-Delivery` (koleksi `webhook_deliveries`, unique index + TTL 7 hari BSON Date), cek `auto_deploy_enabled`, cocokkan branch (`refs/heads/<branch>` == project.branch), lalu trigger deploy di background. Terverifikasi 6 skenario curl (ping/valid/dedupe/invalid-sig/wrong-branch/unknown=404).
- **Auto-deploy aman**: helper `_auto_deploy` menjalankan `scan_env` dulu — bila ada required env kosong → SKIP deploy + kirim Telegram alert + set `last_message` (tidak deploy dgn env kurang, sesuai prinsip production-safe). Bila lengkap → `engine.deploy` normal (rekam history + notifikasi).
- **Management endpoints** (auth): `GET /api/projects/{id}/webhook` (returns enabled, webhook_id, secret, url, path, branch — lazy-generate creds), `POST /api/projects/{id}/webhook/regenerate` (rotate secret + id).
- **UI**: panel "Auto-Deploy (GitHub Webhook)" di ProjectDetail — Switch toggle (`auto-deploy-toggle`), saat On tampil Payload URL (dibangun dari `window.location.origin + path` agar cocok domain publik) + Copy, Secret (masked) + Copy + Rotate, dan 4 langkah setup GitHub. Terverifikasi screenshot (URL publik benar, panel render). Toggle via API terverifikasi (auto_deploy_enabled=true).
- Catatan: deploy aktual butuh Docker (VPS). Alert Telegram butuh bot terkonfigurasi.

## Deploy Notes + Diff Viewer + Delete Guard + Webhook Activity — 2026-06
- **Deploy Notes**: field `note` (≤280 char) di setiap record `deploy_history`. `deploy()` & `_record_history()` menerima `note`; endpoint deploy menerima body `{note}`; rollback→"Rollback to <sha>"; auto-deploy→"Auto-deploy from webhook push". UI: input "Deploy note (optional)" di panel Source Updates + kolom "Note" di tabel History. Terverifikasi (note tersimpan & tampil).
- **Diff Viewer**: `engine.git_diff(project, base, head)` — `git diff --numstat` (daftar file +/-) + patch (truncate 60k). Endpoint `GET /projects/{id}/diff?base=&head=` (base default `head~1`). UI: tombol "Changes" per baris History (bandingkan commit vs commit deploy sebelumnya) → Dialog dengan daftar file + patch berwarna (hijau/merah/biru). Terverifikasi (README +1/-1, patch berwarna render).
- **Delete Guard**: dialog hapus project mewajibkan ketik nama project persis; tombol "Delete permanently" disabled sampai cocok. Terverifikasi (disabled saat kosong/salah, enabled saat benar).
- **Webhook Activity**: koleksi `webhook_events` (retensi 50/project, index project_id+ts). Webhook push merekam {ts, delivery, commit(head_commit), pusher, branch, result}. `_auto_deploy` update result → deployed/skipped: env missing/deploy failed/error. Endpoint `GET /projects/{id}/webhook-events`. UI: "Recent Webhook Activity" di panel Auto-Deploy (waktu, commit, pesan, pusher, badge result). Terverifikasi end-to-end (event tercatat + result "deploy failed" di sandbox tanpa Docker).

## Deploy Timeline — 2026-06
- Komponen `DeployTimeline.jsx` (recharts BarChart) di atas tab History, dibangun dari data `deploy_history` yang sudah dimuat (tanpa endpoint baru). Menampilkan: kartu ringkasan (Success rate %, Total deploys, Failed, Avg build), bar chart per-deploy (urut lama→baru, tinggi = durasi build, warna hijau=sukses / merah=gagal) dengan tooltip (waktu, action, status, durasi, commit, note) + legend. Terverifikasi screenshot (83% rate, 6 deploy, bar hijau/merah render benar).

## Design System (foundation only — no page redesign) — 2026-06
- **Tujuan**: fondasi UI reusable untuk semua halaman (tahap berikutnya), TANPA meredesain Dashboard/Projects/Terminal/Activity/Settings & tanpa menambah menu sidebar. Verified: Dashboard dll tetap identik (font JetBrains Mono, layout sama).
- **Tokens** (`src/styles/design-system.css`): variabel `--ds-*` di `:root` (aditif, tidak menimpa tema lama) — brand (primary #3B82F6, accent #00D084), semantic (success/warning/danger/info/purple), neutral (page/sidebar/card/hover/border/muted/text), radius (badge/btn/input/card/modal), shadow (default/hover/dropdown), motion (ease + durasi). Font Geist/Inter di-scope ke `.ds-root` saja (via Google Fonts) agar app lain tak berubah. Utility: `.ds-transition`, `.ds-focus-ring`, `.ds-skeleton`, `.ds-spin`, keyframe `ds-modal-in`.
- **Komponen reusable** (`src/components/ds/index.jsx`): DSButton (primary/secondary/ghost/outline/success/danger + size + loading + disabled), DSIconButton, DSBadge (running/deploying/building/stopped/failed/pending, dot + pulse), DSCard/DSStatCard/DSDangerCard, form (DSInput/DSTextarea/DSSelect/DSCheckbox/DSRadio/DSToggle), DSTable (header/row/hover/pagination/empty), DSAlert (success/info/warning/error), DSProgressBar/DSSkeleton/DSSpinner, DSEmptyState.
- **Showcase page** (`src/pages/DesignSystem.jsx`, route `/design-system` — TIDAK di sidebar sesuai aturan): 11 seksi bergaya Figma (Colors, Typography, Spacing 8px, Radius & Shadow, Components, Progress, Alerts, Modal, Empty State, Toast, Motion) dibungkus Layout (sidebar tetap). Modal pakai shadcn Dialog + animasi ds-modal-in; Toast pakai sonner. Terverifikasi screenshot full-page (11 seksi, 0 runtime error).
- Cara akses: buka URL `/design-system` langsung (tidak ada menu baru).

## Design System Applied — Dashboard, Projects, DS Link, Light/Dark — 2026-06
- **Dashboard** (`Dashboard.jsx`, di-rewrite): dibungkus `.ds-root`, memakai token & komponen DS — meter CPU/RAM/Disk (progress + warna DS), stat cards (Projects/Running/Stopped/Errors), tabel projects dgn DSBadge status (running/deploying/building/stopped/failed/pending via STATUS_MAP), DSButton (Check Updates / Scan All). Semua logic, data fetch, testid, & aksi dipertahankan. Font Geist.
- **Projects** (`Projects.jsx`, di-rewrite): grid Project Card DS (DSCard hover), DSBadge status + SslBadge + badge env-missing, DSButton "New Project", DSEmptyState saat kosong, DSSkeleton saat loading. Testid dipertahankan (`project-card-{slug}`, dll).
- **DS Nav Link**: tautan halus "Design System" (ikon Palette) di header Settings via PageHeader actions (`data-testid="ds-nav-link"`) → route `/design-system` (tetap tidak ada di sidebar).
- **Light/Dark toggle**: token light discope `.ds-root.ds-light` (page #f7f8fa, card #fff, dst) di design-system.css. Hook `useDsTheme` (`lib/dsTheme.js`) simpan preferensi di localStorage (`nexus-ds-theme`) + sinkron antar-tab. Tombol toggle (Sun/Moon) di header Design System. Dashboard/Projects/Modal DS ikut membaca preferensi (konsisten). Terverifikasi via computed styles: dark `#09090b` ↔ light `#f7f8fa`, persist saat reload. Default = dark.
- Catatan: sidebar (Layout) sengaja tetap tema lama (JetBrains Mono) — rollout bertahap; konten halaman kini bertema DS (Geist).

## Create Project DS Alignment + Light-mode Input Visibility — 2026-06
- **AddProject.jsx di-rewrite ke Design System**: hapus semua `font-mono`/`border-white/20 bg-transparent` (font kini Geist konsisten DS). Header sticky bergaya DS (bukan PageHeader lama), stepper pakai token DS (rounded-btn, border-primary/muted), form pakai DSCard + DSInput/DSTextarea/DSSelect, tombol pakai DSButton (outline/primary/success). Semua testid dipertahankan (wizard-name-input, wizard-repo-input, dst).
- **Visibilitas input mode terang** (keluhan user: batas input hampir tak terlihat di light mode):
  - DS fields diberi marker class `.ds-field` (di inputBase ds/index.jsx). CSS `html.theme-light .ds-field` → bg putih, border lebih tegas (#cbd2dc), subtle shadow, hover #b6bdc9, focus ring biru.
  - Shadcn `--input` di light mode dinaikkan kontrasnya dari `220 13% 91%` → `220 13% 80%` (memperbaiki input shadcn di Settings/ProjectDetail/Login yang nyaris tak terlihat di light mode). `--border` (outline card) dibiarkan halus.
- Terverifikasi screenshot dark & light (border input jelas, font Geist, stepper & tombol DS render benar).

## Dynamic Primary Color + Full DS Migration (Settings/ProjectDetail) — 2026-06
- **Dynamic Primary Color** (Settings › Identity): field baru `primary_color` di branding (backend `BrandingUpdate` + `BRANDING_DEFAULTS` default `#3b82f6`; PUT `/api/settings/branding` validasi hex, 400 bila salah). `BrandingContext.applyPrimaryColor` men-set `--ds-primary` di `document.documentElement` dari `branding.primary_color`. `design-system.css`: `--ds-primary-hover/active` kini diturunkan via `color-mix` dari `--ds-primary` (satu nilai dinamis mengalir ke semua). UI: color picker (native + hex input + 7 swatch preset + tombol preview live) di tab Identity; `setPrimary()` live-apply, `saveBranding()` persist. Terverifikasi end-to-end (live preview, aksen sidebar/logo/nav ikut berubah, persist setelah reload). Testid: `brand-primary-color-picker/-hex`, `brand-swatch-<hex>`, `brand-primary-preview`.
- **Elemen brand mengikuti primary dinamis**: Layout (logo box + indikator nav aktif), BrandName dot, ikon header section Settings, tombol CTA (Add User / Save Identity / Save Config / Change Password / Telegram Save / rollback / restore), toggle ImageField, dan semua komponen DS (`var(--ds-primary)`). Warna semantik (running/success hijau, error merah, warning amber, diff +/-) sengaja dipertahankan.
- **Create Project wizard**: full-width (hapus `max-w-3xl`), field disusun grid 2-kolom responsif, pakai komponen DS (Geist, bukan mono). Terverifikasi 4 step navigasi + input jelas di light & dark.
- **Migrasi DS penuh Settings.jsx & ProjectDetail.jsx**: ganti semua util white-opacity yang tak terlihat di light mode (`border-white/20`, `border-white/15`, `bg-white/5`, `bg-white/[0.02]`, `ring-white`, `data-[state=active]:bg-white/10`, `bg-white text-black`) → token DS; `field` const kini `ds-field` (border tegas + shadow di light mode). Strip `font-mono` dari ProjectDetail (52) & label agar seragam Geist dengan Dashboard/Projects (mono dipertahankan hanya untuk blok diff `<pre>` dan nilai kode kecil). Terverifikasi testing agent frontend 100% (iteration_17.json) — semua tab/aksi ProjectDetail & Settings tetap berfungsi, tidak ada regresi.
- **Light-mode input global**: token shadcn `--input` dinaikkan kontras (`91%`→`80%`), plus `.ds-field` (border #cbd2dc + subtle shadow + focus ring) untuk semua input DS.

## Theme Presets + Terminal Recording + Housekeeping + Font Sweep — 2026-06
- **Theme Presets** (Settings › Identity): grid 8 preset satu-klik (`THEME_PRESETS`: Ocean/Emerald/Sunset/Violet/Rose/Slate/Amber/Cyan) — klik menerapkan `--ds-primary` live, preset aktif diberi border warna. Swatch bulat lama di samping input hex DIHAPUS (duplikat preset). Testid `theme-preset-<name>`. Color picker native + input hex tetap ada.
- **Terminal Session Recording (otomatis)**: `TerminalRecorder` (backend/terminal.py) merekam OUTPUT sesi Local & SSH (offset waktu, decode utf-8) → koleksi `terminal_recordings`, disimpan saat sesi berakhir. Cap `TERMINAL_REC_MAX_BYTES` (~2MB, truncation marker) & retensi `TERMINAL_MAX_RECORDINGS` (50). Endpoint `GET/DELETE /api/terminal/recordings`, `GET /api/terminal/recordings/{id}`, `DELETE /api/terminal/recordings` (clear). Frontend: side tab "Rec" di TerminalPage (list: judul/waktu/durasi/ukuran, Replay + delete) + `RecordingPlayer.jsx` (xterm) dengan play/pause/restart/kecepatan(0.5–4x)/seek + autoplay. WS `/api/ws/terminal/local` kini pass `db`. Terverifikasi E2E (iteration_18: record→list→replay→delete PASS).
- **Housekeeping / retensi jangka panjang** (agar panel tetap cepat setelah 1+ tahun): scheduler `housekeeping_scheduler` (tiap `HOUSEKEEPING_INTERVAL`=6h): (a) `_prune_orphans` hapus deploy_logs/metrics/deploy_history/webhook_events/webhook_deliveries milik project yang sudah dihapus; (b) `_prune_backups` sisakan `MAX_BACKUPS`=14 arsip terbaru (ops.prune_backups); (c) cap terminal_recordings; (d) `_docker_prune` (`docker image prune -f` + `builder prune -f`, aman, no-op tanpa docker). `delete_project` kini juga bersihkan deploy_history/webhook_events/webhook_deliveries. Index `terminal_recordings.started_at`. (Retensi lain sudah ada: deploy_logs 20/proj, deploy_history 50/proj, audit 10000, metrics 24h, webhook_deliveries TTL 7h.)
- **Font sweep DS**: hapus sisa `font-mono` dari teks UI human-readable — tabel Users (username/tanggal + badge "you" kini biru primary), tabel Activity (timestamp/actor/target/page indicator), Login (label/input/error/footer + tombol→primary), Terminal (label tab, empty states), ContainerHealth (empty states). Mono dipertahankan hanya untuk kode/nilai (ports, branch, domain, command, key, hex, diff, log, terminal, chip service name).

## Projects & ProjectDetail Redesign + Terminal Contrast + Sidebar Footer — 2026-06
- **Projects page** dirombak sesuai referensi: 5 stat card (Total/Running/Deploying/Stopped/Failed), toolbar (search + filter status + sort + toggle grid/list), kartu kaya (badge status + menu 3-titik: Open/Deploy/Start-Stop/Restart/Delete, branch, SSL badge, domain+open, port FE/BE, badge env-missing, footer kontekstual: failed→alert merah, deploying→progress bar, stopped→tombol Start, running→meter CPU/RAM real via /system/containers-stats), footer "Showing X to Y of Z" + pagination (8/hal). Testid: project-stats, stat-*, project-search, filter-status, sort-select, view-grid/list, project-menu-*, page-*. Teruji 100% (iteration_20).
- **ProjectDetail** dirombak & disusun ulang sesuai referensi: header breadcrumb "Projects / name" + Created/Updated (timeAgo) + action bar; meta strip 4-kolom (Branch/Domain/Ports/Database) rounded & sejajar; 5 stat card berlabel **STATUS/DEPLOYMENT/UPTIME/LAST DEPLOY/ENVIRONMENT**; **Tabs kini controlled** (activeTab) dengan urutan **Overview**(default)/Configuration/Metrics/Deploy Logs/Container Logs/History; konten Overview: Source Updates + Auto-Deploy (2-kolom), Container Health, dan **Configuration Summary** (read-only grid + tombol "Edit Configuration" → pindah ke tab Configuration). Semua card kini lebar sama & sejajar dalam satu kolom. Teruji tab-switch + edit-config.
- **Terminal contrast fixes**: tombol Split/New diubah ke plain `<button>` bergaya dark-surface (terlihat jelas di light & dark tanpa hover); Connect/Run/Replay jadi solid primary; tab bar & pane header pakai styling dark-surface tetap; tab "Rec"→"Records"; hover card halus.
- **Sidebar system-info footer** (global, di kedua referensi): version, System Operational, Docker status, Server OS — via `GET /api/system/panel-info`. Endpoint baru: `/api/system/panel-info`, `/api/system/containers-stats`.

## Backlog / Roadmap
- P1: Dialog konfirmasi (ketik nama proyek) sebelum hapus proyek.
- P2: Auto-Deploy Webhook: trigger deploy otomatis saat push ke branch GitHub.

## Cek Env Sebelum Deploy + Baca Default README (2026-06)
- Backend `scan_env` kini juga parse tabel README.md (kolom Variabel/Wajib-Opsional/Default/Deskripsi) → mengembalikan `readme_defaults`, `missing_required` (var yang benar-benar memblokir: belum diisi, bukan managed/JWT, dan di README bertanda Wajib tanpa default / tidak terdokumentasi).
- Endpoint `POST /projects/{id}/deploy` menolak dengan HTTP 428 + detail {message, missing_required, readme_defaults} bila ada var wajib kosong; lolos dengan `?force=true`.
- Frontend: tombol Deploy → bila 428 muncul dialog "Variabel wajib belum terisi" (Batal / Isi Default & Simpan / Deploy Paksa). `scanEnv` otomatis mengisi default dari README untuk var yang belum diisi. Terverifikasi backend (428/force/scan) + UI dialog (screenshot).
- P2: Recording/riwayat sesi terminal.
- P2: Known-hosts verification untuk SSH (saat ini AutoAddPolicy).