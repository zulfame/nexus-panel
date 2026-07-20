# Emergent Prompt — Make Projects Compatible with Nexus Panel

Paste one of the prompts below into your Emergent chat so the app it builds (or
already built) deploys cleanly through Nexus Panel.

- Use **PROMPT A** at the *start* of a **new** project.
- Use **PROMPT B** to *retrofit* an **existing** project you already built on Emergent.

Nexus Panel clones the GitHub repo and builds the backend and frontend with Docker,
so the app must follow the conventions below.

---

## PROMPT A — New project (copy from here)

```
I will deploy this app on my own Ubuntu VPS using my custom control panel (Nexus Panel),
which clones the GitHub repo and builds the backend and frontend with Docker. Please follow
ALL of the structure rules below strictly, because my panel relies on these conventions.

REPO STRUCTURE (REQUIRED):
- The repo root must contain exactly two folders: `backend/` and `frontend/`.
- Do not add an extra wrapping folder above them.

BACKEND (FastAPI + MongoDB):
- The entrypoint `backend/server.py` MUST export a FastAPI object named `app`
  (the panel runs: uvicorn server:app --host 0.0.0.0 --port 8001).
- ALL API endpoints MUST be prefixed with `/api` (e.g. /api/auth/login).
- The backend MUST read configuration ONLY from environment variables:
  - `MONGO_URL` and `DB_NAME` for MongoDB (injected by the panel).
  - `CORS_ORIGINS` for CORS.
  - Do NOT hardcode URLs, ports, connection strings, or secrets in code.
- All third-party secrets/keys (e.g. JWT_SECRET, STRIPE_KEY, OPENAI_KEY, EMERGENT_LLM_KEY)
  must be read via os.environ.get("NAME"). List required variables in the README.
- `backend/requirements.txt` MUST be complete and installable with
  `pip install -r requirements.txt` on Python 3.11. Do not pin package versions that
  don't exist on PyPI.
- The backend listens on port 8001 inside the container. Do NOT change this port and do
  NOT add your own backend Dockerfile — the panel generates it.

FRONTEND (React):
- `frontend/package.json` has a `build` script that runs with `yarn build` (Node 20).
  The build must succeed even when eslint warnings exist (warnings must not fail the build).
- ALL API calls MUST use `process.env.REACT_APP_BACKEND_URL` as the base URL AND add the
  `/api` prefix, e.g. axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/items`).
- Do NOT hardcode `http://localhost:8001` or any URL/port. Do NOT add your own frontend
  Dockerfile — the panel generates it. The panel injects REACT_APP_BACKEND_URL automatically.

ENVIRONMENT — NEXUS STANDARD ENV CONTRACT (REQUIRED):
Use these EXACT variable names. Do not invent different names for the same purpose.

- Injected AUTOMATICALLY by the panel (do NOT hardcode; just read from the environment):
  - `MONGO_URL`, `DB_NAME`  -> MongoDB connection
  - `CORS_ORIGINS`          -> backend CORS origins
  - `REACT_APP_BACKEND_URL` -> backend base URL for the frontend
- Internal app secret (the panel generates this; do NOT generate your own):
  - `JWT_SECRET`            -> the panel generates & stores it. Code just reads
    `os.environ.get("JWT_SECRET")`.
- Initial admin credentials (seeded once on startup, idempotent):
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD` -> create/seed the admin account from these two values.
- Optional integrations (only if the app actually uses them):
  - `EMERGENT_LLM_KEY`      -> read via os.environ.get("EMERGENT_LLM_KEY").
- File storage (uploads, etc.):
  - `LOCAL_STORAGE_DIR`     -> default `/app/data`. ALL files that must persist MUST be
    stored inside this folder (the panel mounts it as a persistent volume). Read via
    os.environ.get("LOCAL_STORAGE_DIR", "/app/data"). Do NOT store files elsewhere.

Additional rules:
- The backend MUST seed the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on startup
  (idempotent: don't duplicate if it already exists). Hash the password before storing.
- Do NOT commit a `.env` with real secrets. Provide a `.env.example` listing every variable above.
- Do NOT invent new names for anything that already has a standard name above.

NON-STANDARD VARIABLES (any variable beyond the contract, if the app truly needs it):
Sometimes the app needs extra variables (e.g. RESEED, SEED_ON_STARTUP, APP_DIR, BACKUP_DIR,
LOG_DIR, feature flags, numeric limits, etc.). For EVERY non-standard variable you MUST:
1. Read it with a SAFE DEFAULT in code, e.g.:
   - os.environ.get("RESEED", "false")
   - os.environ.get("BACKUP_DIR", "/app/data/backups")
   The app MUST keep working even if that variable isn't set in the panel (an empty variable
   must never cause a 500/crash). Only variables in the standard contract may be truly required.
2. Document EVERY non-standard variable in the README table (see below).
3. Default-value conventions:
   - Boolean flags -> default `false` (unless it must be `true`; explain why in the README).
   - Folders/paths -> under `/app/data` so they persist (e.g. /app/data/backups, /app/data/logs,
     /app/data/uploads).
   - Numbers (limit/timeout/size) -> give a reasonable numeric default.
   - External URL/email/API key -> may be empty, but any feature that uses it must degrade
     gracefully (not crash) when empty.

REQUIRED — an "Environment Variables" section in README.md (the panel parses this table):
`README.md` at the repo root MUST contain a section titled `## Environment Variables` with a
SINGLE markdown table listing ALL variables the app uses (standard + non-standard). The header
MUST have these 4 columns (order flexible, but the column names must contain these keywords):

## Environment Variables

| Variable | Required/Optional | Default Value | Description |
|----------|-------------------|---------------|-------------|
| JWT_SECRET | Required | (auto by panel) | JWT signing key |
| ADMIN_EMAIL | Required | - | Initial admin email |
| ADMIN_PASSWORD | Required | - | Initial admin password |
| EMERGENT_LLM_KEY | Optional | - | LLM key, set if using AI |
| LOCAL_STORAGE_DIR | Optional | /app/data | Persistent files folder |
| RESEED | Optional | false | Set true to re-seed data |
| BACKUP_DIR | Optional | /app/data/backups | Backup folder |

Table rules:
- The "Required/Optional" column must contain exactly `Required` or `Optional`.
- The "Default Value" column holds the default; use `-` when there is none.
- Every variable the app reads from the environment MUST have a row. No hidden variables.
The panel uses this table to (a) auto-fill defaults during scan, and (b) block deploy only for
variables that are truly Required with no default. Writing this table correctly = smoother deploys.

Please build the app following the rules above and confirm at the end that:
(1) `backend/server.py` exports `app`, (2) every route is prefixed with `/api`,
(3) the frontend uses `REACT_APP_BACKEND_URL` for all requests,
(4) nothing (URL/port/secret) is hardcoded, and
(5) `README.md` has a `## Environment Variables` section with the full 4-column table.
```

## (end of PROMPT A)

---

## PROMPT B — Existing project (adapt an app you already built)

```
This app is already built. I want to deploy it on my own Ubuntu VPS using my custom control
panel (Nexus Panel), which clones the GitHub repo and builds backend + frontend with Docker.
Please AUDIT the current code and make the MINIMAL changes needed to comply with the rules
below, without breaking existing functionality. Do not redesign features — only adapt for
deployability.

Please DO the following and report a short checklist of what you changed:

1) STRUCTURE
   - Ensure the repo root has `backend/` and `frontend/` folders (move files if needed).

2) BACKEND
   - Ensure `backend/server.py` exports a FastAPI object named `app` (the panel runs
     `uvicorn server:app --host 0.0.0.0 --port 8001`). If the entrypoint differs, add/rename
     so `server:app` works.
   - Ensure EVERY API route is prefixed with `/api`. Fix any route that isn't.
   - Replace any hardcoded config (Mongo URL, ports, secrets, base URLs) with environment
     variables. Mongo MUST come from `MONGO_URL` + `DB_NAME`; CORS from `CORS_ORIGINS`.
   - Ensure `backend/requirements.txt` is complete and installs on Python 3.11.
   - Remove any custom backend Dockerfile/docker-compose (the panel generates them).

3) FRONTEND
   - Replace every hardcoded backend URL (e.g. http://localhost:8001) with
     `process.env.REACT_APP_BACKEND_URL`, and make sure API paths include the `/api` prefix.
   - Ensure `yarn build` succeeds even with eslint warnings.
   - Remove any custom frontend Dockerfile.

4) STANDARD ENV NAMES
   - Rename config to the standard names where applicable: JWT_SECRET, ADMIN_EMAIL,
     ADMIN_PASSWORD, EMERGENT_LLM_KEY, LOCAL_STORAGE_DIR (default /app/data).
   - The admin account must be seeded from ADMIN_EMAIL/ADMIN_PASSWORD on startup (idempotent,
     hashed). JWT_SECRET must be read from the environment (the panel provides it).
   - Any file that must persist must be written under LOCAL_STORAGE_DIR (default /app/data).

5) SAFE DEFAULTS FOR NON-STANDARD VARIABLES
   - For every other environment variable the app reads, ensure it uses a safe default
     (os.environ.get("NAME", "<default>")) so a missing value never causes a 500/crash.

6) README ENV TABLE
   - Add or update a `## Environment Variables` section in README.md with a single markdown
     table of 4 columns: | Variable | Required/Optional | Default Value | Description |.
     Include EVERY variable the app reads. Use `-` when there is no default. Mark only truly
     mandatory variables as `Required`.

At the end, confirm: server:app exists, all routes are /api-prefixed, the frontend uses
REACT_APP_BACKEND_URL everywhere, nothing is hardcoded, files persist under LOCAL_STORAGE_DIR,
and README.md has the complete Environment Variables table.
```

## (end of PROMPT B)

---

### Why these rules matter
- The panel overwrites the Dockerfiles & docker-compose, and injects `MONGO_URL`, `DB_NAME`,
  `REACT_APP_BACKEND_URL`, plus the `.env` variables you set in the panel.
- The backend always runs as `uvicorn server:app` on port 8001; the frontend is built with
  `yarn build` and served on port 3000. The panel's Nginx proxies `/api` to the backend and
  `/` to the frontend.
- If a route isn't `/api`-prefixed, or the frontend hardcodes a URL, the deploy will 404 or
  fail to connect even when the build succeeds.
- The README Environment Variables table lets the panel auto-fill defaults on scan and block a
  deploy only when a truly required variable is still empty.
