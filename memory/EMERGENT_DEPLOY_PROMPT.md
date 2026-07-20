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

ENVIRONMENT:
- Sediakan file `.env.example` di backend dan frontend yang mendaftar SEMUA variabel
  yang dibutuhkan (tanpa nilai rahasia), agar aku tahu apa yang harus kuisi di panel.
- Jangan commit file `.env` berisi secret asli.

Tolong bangun aplikasinya mengikuti aturan di atas dan konfirmasi di akhir bahwa:
(1) `backend/server.py` mengekspor `app`, (2) semua route ada prefix `/api`,
(3) frontend memakai `REACT_APP_BACKEND_URL` untuk semua request, dan
(4) tidak ada URL/port/secret yang di-hardcode.

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
