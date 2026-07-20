# Prompt untuk Agent Emergent — Agar Project Kompatibel dengan Nexus Panel

Tempelkan teks di bawah ini di AWAL percakapan setiap project baru di Emergent
(atau kirim sebagai instruksi tambahan sebelum minta build), supaya hasilnya
langsung bisa di-deploy lewat Nexus Panel tanpa kendala.

---

## PROMPT (salin mulai dari sini)

Aku akan men-deploy aplikasi ini di VPS Ubuntu-ku sendiri memakai control panel
buatanku (Nexus Panel) yang meng-clone repo GitHub lalu mem-build backend & frontend
dengan Docker. Tolong ikuti SEMUA aturan struktur di bawah ini secara ketat, karena
panel-ku mengandalkan konvensi ini:

STRUKTUR REPO (WAJIB):
- Root repo harus punya dua folder: `backend/` dan `frontend/`.
- Jangan menaruh kode di folder lain atau menambah lapisan folder di atasnya.

BACKEND (FastAPI + MongoDB):
- File utama `backend/server.py` HARUS mengekspor objek FastAPI bernama `app`
  (panel menjalankan: `uvicorn server:app --host 0.0.0.0 --port 8001`).
- SEMUA endpoint API HARUS diawali prefix `/api` (contoh: `/api/auth/login`).
- Backend HARUS membaca konfигurasi HANYA dari environment variables:
  - `MONGO_URL` dan `DB_NAME` untuk koneksi MongoDB (panel yang menyuntikkan).
  - `CORS_ORIGINS` untuk CORS.
  - JANGAN hardcode URL, port, connection string, atau secret di dalam kode.
- Semua secret/kunci pihak ketiga (mis. `JWT_SECRET`, `STRIPE_KEY`, `OPENAI_KEY`,
  `EMERGENT_LLM_KEY`) dibaca via `os.environ.get("NAMA")`. Tulis daftar variabel
  yang dibutuhkan di README, supaya bisa kuisi di panel.
- `backend/requirements.txt` HARUS lengkap dan bisa `pip install -r requirements.txt`
  pada Python 3.11. Jangan pakai versi paket yang tidak ada di PyPI.
- Server listen di port 8001 di dalam container. JANGAN mengubah port ini.
- Jangan menambahkan Dockerfile atau docker-compose sendiri untuk backend —
  panel yang membuatnya.

FRONTEND (React):
- Ada `frontend/package.json` dengan script `build` yang jalan via `yarn build`
  (Node 20). Pastikan build lolos walau ada eslint warning (jangan sampai warning
  bikin build gagal).
- SEMUA panggilan API ke backend HARUS memakai `process.env.REACT_APP_BACKEND_URL`
  sebagai base URL, DAN menambahkan prefix `/api`. Contoh:
  `axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/items`)`.
- JANGAN hardcode `http://localhost:8001` atau URL/port apa pun di frontend.
- Panel menyuntik `REACT_APP_BACKEND_URL` otomatis; kamu jangan set nilai final-nya.
- Jangan menambahkan Dockerfile sendiri untuk frontend — panel yang membuatnya.

ENVIRONMENT — KONTRAK ENV STANDAR NEXUS (WAJIB dipatuhi):
Gunakan PERSIS nama variabel berikut. Jangan pakai nama lain untuk maksud yang sama.

- Variabel yang DISUNTIK OTOMATIS oleh panel (JANGAN kamu hardcode, cukup baca dari environment):
  - `MONGO_URL`, `DB_NAME`  -> koneksi MongoDB
  - `CORS_ORIGINS`          -> daftar origin CORS backend
  - `REACT_APP_BACKEND_URL` -> base URL backend untuk frontend
- Secret internal aplikasi (panel yang buat otomatis, JANGAN generate sendiri):
  - `JWT_SECRET`            -> panel meng-generate & menyimpannya. Kode cukup `os.environ.get("JWT_SECRET")`.
- Kredensial admin awal (di-seed sekali saat startup, idempotent):
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD` -> buat/seed akun admin dari kedua nilai ini.
- Integrasi opsional (hanya jika app memang memakainya):
  - `EMERGENT_LLM_KEY`      -> dibaca via `os.environ.get("EMERGENT_LLM_KEY")`.
- Penyimpanan file (upload, dsb):
  - `LOCAL_STORAGE_DIR`     -> default `/app/data`. SEMUA file yang perlu persisten HARUS disimpan
    di dalam folder ini (panel mem-mount folder ini sebagai volume persisten). Baca via
    `os.environ.get("LOCAL_STORAGE_DIR", "/app/data")`. JANGAN simpan file di path lain.

Aturan tambahan:
- Backend HARUS meng-seed admin dari `ADMIN_EMAIL`/`ADMIN_PASSWORD` saat startup (idempotent: jangan
  duplikat kalau sudah ada). Hash password sebelum simpan.
- JANGAN commit `.env` berisi secret asli. Sediakan `.env.example` yang mendaftar SEMUA variabel di atas.
- JANGAN buat nama variabel baru untuk hal yang sudah punya nama standar di atas.

VARIABEL NON-STANDAR (variabel lain di luar kontrak, jika app memang membutuhkannya):
Kadang app perlu variabel tambahan (mis. RESEED, SEED_ON_STARTUP, APP_DIR, BACKUP_DIR, LOG_DIR,
FEATURE flags, limit angka, dsb). Untuk SETIAP variabel non-standar, WAJIB:
1. Baca dengan NILAI DEFAULT AMAN di kode, contoh:
   - `os.environ.get("RESEED", "false")`
   - `os.environ.get("BACKUP_DIR", "/app/data/backups")`
   App HARUS tetap berjalan normal walau variabel itu belum diisi di panel (JANGAN sampai
   variabel kosong bikin 500/crash). Variabel yang benar-benar wajib (tanpa default) hanya boleh
   yang sudah ada di kontrak standar.
2. Dokumentasikan SEMUA variabel non-standar di `README.md` dalam tabel:
   | Variabel | Wajib/Opsional | Nilai Default | Deskripsi |
   Contoh baris: `| RESEED | Opsional | false | Set true untuk seed ulang data (hati-hati). |`
3. Konvensi nilai default:
   - Flag boolean → default `false` (kecuali harus `true`, jelaskan alasannya di README).
   - Folder/path → di bawah `/app/data` agar persisten (mis. `/app/data/backups`, `/app/data/logs`,
     `/app/data/uploads`).
   - Angka (limit/timeout/size) → beri angka default yang wajar.
   - URL/email/API key eksternal → boleh kosong, tapi fitur yang memakainya harus gracefully mati
     (bukan crash) saat kosong.
Tujuannya: aku bisa deploy tanpa bingung — variabel opsional punya default jelas di README, dan app
tidak pernah gagal hanya karena satu variabel belum kuisi.

WAJIB — SECTION "Environment Variables" DI README.md (panel membaca tabel ini otomatis):
Di `README.md` root repo HARUS ada satu section berjudul `## Environment Variables` yang memuat
SATU tabel markdown berisi SEMUA variabel yang dipakai app (standar + non-standar), dengan HEADER
PERSIS 4 kolom berikut (urutan bebas, tapi nama kolom harus mengandung kata kunci ini):

```
## Environment Variables

| Variabel | Wajib/Opsional | Nilai Default | Deskripsi |
|----------|----------------|---------------|-----------|
| JWT_SECRET | Wajib | (auto oleh panel) | Kunci penandatangan JWT |
| ADMIN_EMAIL | Wajib | - | Email admin awal |
| ADMIN_PASSWORD | Wajib | - | Password admin awal |
| EMERGENT_LLM_KEY | Opsional | - | Key LLM, isi jika pakai AI |
| LOCAL_STORAGE_DIR | Opsional | /app/data | Folder file persisten |
| RESEED | Opsional | false | Set true untuk seed ulang data |
| BACKUP_DIR | Opsional | /app/data/backups | Folder backup |
```

Aturan tabel:
- Kolom "Wajib/Opsional" isi tepat kata `Wajib` atau `Opsional`.
- Kolom "Nilai Default" isi nilai default; jika tidak ada default gunakan `-`.
- Setiap variabel yang app baca dari environment HARUS ada barisnya. Jangan ada variabel "siluman".
Panel memakai tabel ini untuk: (a) mengisi default otomatis saat scan, (b) memblokir deploy hanya
untuk variabel yang benar-benar Wajib tanpa default. Jadi menuliskan tabel ini dengan benar =
deploy jauh lebih mulus.

Tolong bangun aplikasinya mengikuti aturan di atas dan konfirmasi di akhir bahwa:
(1) `backend/server.py` mengekspor `app`, (2) semua route ada prefix `/api`,
(3) frontend memakai `REACT_APP_BACKEND_URL` untuk semua request,
(4) tidak ada URL/port/secret yang di-hardcode, dan
(5) `README.md` punya section `## Environment Variables` dengan tabel 4 kolom lengkap.

## (akhir prompt)

---

### Catatan singkat kenapa aturan ini penting
- Panel menimpa Dockerfile & docker-compose, menyuntik `MONGO_URL`, `DB_NAME`,
  `REACT_APP_BACKEND_URL`, dan variabel `.env` yang kamu isi di panel.
- Backend selalu dijalankan sebagai `uvicorn server:app` di port 8001; frontend
  di-`yarn build` lalu di-serve di port 3000. Nginx panel yang mem-proxy `/api`
  ke backend dan `/` ke frontend.
- Kalau route tidak berprefix `/api` atau frontend hardcode URL, hasil deploy
  akan 404 / gagal konek walau build sukses.
