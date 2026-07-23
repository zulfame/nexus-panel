# Nexus Panel — Desain Lisensi & Distribusi (Freemium)

> Status: **BASELINE / ACUAN (disepakati)** — dokumen perencanaan. Belum ada kode yang diubah.
> Bahasa: Indonesia (istilah teknis tetap English). Terakhir diperbarui: 2026-06.

> ⚠️ **PRIORITAS SAAT INI:** memperkokoh & mematangkan panel dulu. Semua rencana **bisnis/harga
> ditunda** — hanya dicatat sebagai acuan. **Implementasi lisensi (Fase 1) BELUM dimulai** atas
> keputusan pemilik; akan dibahas lagi setelah panel benar-benar kokoh.

## 1. Keputusan yang sudah disepakati
- **Model bisnis:** Freemium — panel inti **gratis**, hanya **fitur Pro** yang butuh lisensi (ala aaPanel).
- **Distribusi:** Docker image dari registry privat *(lihat catatan — untuk freemium ini opsional di awal)*.
- **Penegakan lisensi:** **Hybrid** (verifikasi offline signed-license + refresh online berkala).
- **Source backend Python:** boleh terbaca — proteksi utama = **lisensi legal + signed license + gating fitur**.
- **Skala 6–12 bln:** ~100 instalasi → infrastruktur ringan.

## 2. Prinsip inti
1. **Core selalu jalan gratis** tanpa internet, tanpa lisensi.
2. **Fitur Pro dikunci** oleh sebuah **file lisensi bertanda-tangan (Ed25519)** yang diverifikasi offline oleh panel.
3. **Gagal-aman (fail-open untuk core, fail-closed untuk Pro):** kalau lisensi invalid/expired → core tetap jalan, fitur Pro nonaktif + banner upsell.
4. **Ikat lisensi** ke domain + fingerprint server + jumlah seat, agar tidak mudah dibagi.

## 3. Pembagian Free vs Pro (ACUAN — 2FA = Free)
Semua fitur berikut sudah ada di panel; pembagian di bawah adalah **rekomendasi final** (bisa
disesuaikan nanti). Prinsip: **Free** = penarik adopsi + keamanan dasar; **Pro** = nilai
"tim / DR / compliance / skala / white-label".

### Free (Community) — selamanya gratis, tanpa lisensi
- Deploy proyek (Docker per-project isolation)
- Nginx vhost + Let's Encrypt SSL otomatis (auto-renew)
- Deploy logs & container logs (live streaming)
- Web Terminal
- Backup lokal (nightly) + restore
- Telegram notifications (1 channel)
- **2FA / TOTP** — keamanan dasar akun **tidak di-paywall** (kebijakan)
- RBAC dasar (Owner + hingga 2 user)
- Metrics dasar (CPU/RAM real-time, retensi pendek)

### Pro (berbayar) — rekomendasi
| Fitur Pro | Kenapa layak Pro |
|---|---|
| **Cloud Backup ke S3/R2/MinIO (off-site DR) + restore-from-cloud** | Nilai bisnis/keberlangsungan tinggi; biaya storage & DR = "mahal kalau tidak ada" |
| **RBAC multi-user lanjutan (>2 user, role kustom, sign-out-all)** | Kebutuhan tim/enterprise |
| **Audit log immutable (hash-chain) + export CSV/JSON** | Compliance/audit — wajib bagi bisnis teregulasi |
| **CI/CD pipeline + multi-channel notifications (Email/Slack/Discord/webhook)** | Ops lanjutan; integrasi tim |
| **White-label / branding kustom + i18n penuh** | Reseller/agency menjual ulang |
| **Observability lanjutan: alert threshold CPU/RAM, uptime monitor, retensi metrics panjang** | Operasional serius/SLA |
| **Cloud backup terjadwal + retensi lanjutan** | Bagian dari paket DR Pro |

> Catatan: batas angka (mis. "2 user", "retensi 7 hari") adalah **usulan**; bisa diubah saat
> finalisasi paket. 2FA sengaja **Free** demi keamanan & itikad baik.

## 4. Paket lisensi (DITUNDA — dicatat saja)
> Semua urusan paket & **harga ditunda** sampai panel matang. Struktur di bawah hanya catatan awal.
- **Community (Free):** semua fitur Free, tanpa lisensi.
- **Pro (berbayar, per server / per tahun):** buka semua fitur Pro, 1 domain, N seat.
- **Agency/Reseller (opsional):** multi-domain, white-label.

## 5. Arsitektur teknis

### 5.1 Format License (blob bertanda-tangan)
```json
{
  "license_id": "NX-XXXX-XXXX-XXXX",
  "plan": "pro",
  "features": ["cloud_backup", "rbac_multi", "cicd", "white_label", "audit_export"],
  "domain": "panel.pelanggan.com",
  "seats": 5,
  "issued_at": "2026-06-01T00:00:00Z",
  "expires_at": "2027-06-01T00:00:00Z",
  "fingerprint": "sha256:...."
}
```
- Ditandatangani **Ed25519** oleh **private key** (hanya di license server).
- Panel menyimpan **public key** tertanam → verifikasi tanda tangan **offline**.

### 5.2 Modul di panel (`backend/licensing.py`)
- `load_license()` → baca file lisensi lokal (mis. `/opt/nexus-panel/license.key`) + verifikasi tanda tangan & expiry & domain/fingerprint.
- `has_feature(name) -> bool` → dipakai untuk gating.
- Endpoint `GET /api/license` → `{plan, features, expires_at, valid, reason}` untuk UI.
- Endpoint `POST /api/license/activate` `{license_key}` → hubungi license server, unduh signed license, simpan lokal.
- Middleware/dependency `require_feature("cloud_backup")` untuk endpoint Pro → balikan **402 Payment Required** bila tak berlisensi.

### 5.3 Gating di frontend
- Ambil `GET /api/license` saat load; simpan di context.
- Komponen Pro dibungkus `<ProGate feature="cloud_backup">` → jika tidak lisensi, tampilkan **badge "PRO"** + tombol upsell (link ke halaman pembelian), bukan fitur asli.
- Tab/menu Pro tetap terlihat (untuk upsell) tapi terkunci.

### 5.4 License Server (layanan kecil terpisah — FastAPI + DB)
Endpoint:
- `POST /activate` `{license_key, fingerprint, domain}` → validasi → catat aktivasi (cek seat/domain) → balikan **signed license** (+ opsional kredensial registry bila kelak pakai image Pro).
- `POST /validate` (heartbeat berkala dari panel) → perbarui `expires_at` signed license (bagian "online" hybrid) → cek **revocation**.
- Admin CRUD: buat/cabut lisensi, lihat aktivasi.
Data: `licenses` (key, plan, features, seats, expiry, status), `activations` (license_id, fingerprint, domain, last_seen).
Kunci: simpan **private key** Ed25519 hanya di sini.

### 5.5 Hybrid enforcement (alur runtime di panel)
1. Startup → `load_license()` (offline verify). Valid → aktifkan fitur sesuai `features`.
2. Scheduler tiap N jam → `POST /validate` ke license server → jika sukses, simpan signed license baru (expiry diperpanjang).
3. **Grace period**: jika server tak terjangkau, panel tetap jalan pakai license lama sampai `expires_at`. Setelah lewat + grace (mis. 7–14 hari) → fitur Pro nonaktif + banner "perbarui lisensi".
4. **Revocation**: `/validate` bisa menandai lisensi dicabut → panel kunci Pro pada refresh berikutnya.

### 5.6 Fingerprint server
`sha256(machine-id + primary-mac + panel-domain)` → dikirim saat activate/validate; license diikat ke sini agar tidak bisa disalin ke server lain.

## 6. Distribusi & Registry (rekomendasi bertahap)
Karena **freemium (core gratis & source boleh terbaca)**:
- **Fase awal — TIDAK perlu registry privat.** Kode Pro **tetap di codebase** tapi **terkunci** signed license (feature flags). Ini paling sederhana & cukup untuk mulai monetisasi.
- **Jika kelak** ingin benar-benar menahan *kode* fitur Pro dari user gratis:
  - **Opsi A (plugin gated download):** fitur Pro dipindah jadi paket/modul yang diunduh dari **endpoint license-gated** (ala plugin aaPanel).
  - **Opsi B (private image):** fitur/panel Pro sebagai Docker image di **GHCR privat**; kredensial pull di-scope per lisensi.
- **Registry pilihan bila dibutuhkan:** **GHCR (GitHub Container Registry) privat** — gratis untuk skala Anda, integrasi mudah, tak perlu urus server registry sendiri. Alternatif self-host `registry:2` bila ingin kendali penuh.

## 7. Instalasi & one-liner
- **Free:** installer saat ini tetap dipakai (git clone / public) — **tanpa perubahan wajib**.
- **Aktivasi Pro:** user tempel **license key** di **Settings → License** → panel `activate` → fitur Pro terbuka. Tanpa reinstall.
- **Opsional:** flag installer `--license NX-XXXX` untuk pra-aktivasi saat pertama pasang.
- One-liner ala aaPanel bisa dibuat **terpisah** dari topik lisensi (lihat diskusi sebelumnya) dan **tidak wajib** untuk model freemium.

## 8. Anti-abuse (secukupnya untuk freemium)
- Ikat domain + fingerprint + batas seat.
- Heartbeat + daftar revocation.
- Grace period offline agar UX tetap baik saat internet mati.
- **Realistis:** cek client-side bisa dibongkar oleh yang gigih (source terbaca). Palang ini + **EULA/perjanjian lisensi** cukup untuk mayoritas kasus. Obfuscation (PyArmor/Nuitka) bisa ditambah nanti bila perlu.

## 9. Roadmap eksekusi bertahap (usulan)
- **Fase 0 — Keputusan bisnis:** finalisasi daftar fitur Pro + paket + harga. *(butuh input Anda)*
- **Fase 1 — Licensing in-panel (MVP):**
  - `backend/licensing.py` (verify signed license offline, `has_feature`, `require_feature`).
  - Gating beberapa endpoint Pro (mis. Cloud Backup) + `GET /api/license`.
  - Frontend `<ProGate>` + badge PRO + halaman Settings → License (tempel key).
  - Uji pakai **signed license dibuat manual** (script generator + key pair) — **belum perlu server**.
- **Fase 2 — License Server:** activate/validate/revoke + admin + heartbeat scheduler di panel.
- **Fase 3 — Billing:** integrasi **Stripe/Razorpay** → otomatis terbitkan license saat bayar; portal pelanggan.
- **Fase 4 (opsional):** pindah kode Pro ke gated download / GHCR privat; containerize panel; one-liner `--license`; obfuscation.

## 10. Status keputusan
**Sudah diputuskan:**
- Model = **Freemium**; core gratis, fitur Pro berlisensi.
- Distribusi = Docker image privat *(registry belum diperlukan di fase awal — cukup feature-flag)*.
- Enforcement = **Hybrid** (offline signed license + refresh online).
- **2FA = Free.**
- Fitur Pro = lihat §3 (Cloud Backup/DR, RBAC lanjutan, audit export, CI/CD + multi-channel notif, white-label/i18n, observability lanjutan).
- Source Python boleh terbaca; proteksi = lisensi legal + signed license.

**DITUNDA (dibahas setelah panel kokoh):**
- Struktur paket & **harga** (§4).
- Domisili license server (VPS terpisah / self-host).
- Billing (manual vs Stripe/Razorpay).
- **Mulai implementasi Fase 1** — belum, atas keputusan pemilik.

**Fokus sekarang:** mematangkan & mengokohkan panel (stabilitas, fitur, UX). Dokumen ini
dikunci sebagai **acuan** dan akan ditinjau ulang saat siap bicara bisnis.
