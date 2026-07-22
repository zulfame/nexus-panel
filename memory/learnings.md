# Nexus Panel — agent learnings / pitfalls

## NEVER run `pip freeze > backend/requirements.txt` in this sandbox
- The shared dev environment contains internal packages (`emergentintegrations`, a private
  `litellm @ https://customer-assets.emergentagent.com/...whl`) plus dozens of unrelated heavy
  deps (google-generativeai, boto3, pandas, numpy, black, mypy, ...).
- `pip freeze` captures ALL of them. `emergentintegrations` and the litellm wheel are NOT on
  public PyPI, so the VPS updater's `pip install -r requirements.txt` fails with
  `No matching distribution found for emergentintegrations==0.2.0` and the update auto-rolls-back.
- Correct way to add a backend dep: `pip install <pkg>` for the sandbox, then MANUALLY append
  the single pinned line to `backend/requirements.txt`. Keep the file minimal & PyPI-only.
- Canonical minimal list (v1.6.0): fastapi, uvicorn[standard], websockets, motor, pymongo,
  pydantic, python-dotenv, bcrypt, pyjwt, cryptography, requests, psutil, paramiko,
  python-multipart, ijson.

## Update flow (VPS)
- `scripts/update.sh` → `deploy_release()` in `common.sh`: git clone → pip install → yarn build →
  atomic symlink switch → restart → healthcheck; auto-rollback via `rollback.sh` on failure.
- Ops scripts that restart the service MUST run via `systemd-run` (see ops.py `run_script`).

## UI Design source of truth (2026-06)
- The ONLY authoritative UI spec is the in-app Design System page (`/design-system`,
  `frontend/src/pages/DesignSystem.jsx`) + `frontend/src/styles/design-system.css` + `tailwind.config.js`.
- Typography (DS section 02): body & headings = **Geist (primary) / Inter (fallback)**;
  **JetBrains Mono ONLY** for code, technical data, terminal logs. Do NOT make the whole UI monospace.
- `design_guidelines.json` is a supporting reference only; it previously conflicted (said "JetBrains
  Mono everywhere") which caused a wrong global-mono change. That conflict has been removed. If it ever
  conflicts with the Design System again, the Design System wins.
