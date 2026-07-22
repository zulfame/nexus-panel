#!/usr/bin/env bash
# Nexus Panel — repair the CURRENT release in place.
# Reinstalls backend deps, reinstalls frontend packages, rebuilds the frontend
# and restarts the service — WITHOUT pulling new code (version stays the same).
# Use this to fix a broken install (corrupt venv, missing build, stuck service).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root
load_conf

rel="$(readlink -f "$CURRENT" 2>/dev/null || true)"
[ -n "$rel" ] && [ -d "$rel" ] || die "No current release found at $CURRENT — run update.sh first"

step "Repairing current release ($rel)"

# ensure env links are intact
ln -sfn "$BACKEND_ENV" "$rel/backend/.env"
printf 'REACT_APP_BACKEND_URL=https://%s\nWDS_SOCKET_PORT=443\n' "$PANEL_DOMAIN" > "$rel/frontend/.env"

step "Reinstalling backend deps"
python3 -m venv "$VENV_DIR" >/dev/null 2>&1 || true
"$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
if ! "$VENV_DIR/bin/pip" install -r "$rel/backend/requirements.txt" >"$rel/.pip.log" 2>&1; then
  err "pip install failed — last lines:"; tail -n 30 "$rel/.pip.log" >&2
  die "repair failed at backend deps (see output above)"
fi

step "Reinstalling frontend packages"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! ( cd "$rel/frontend" && timeout 900 sh -c 'yarn install --frozen-lockfile --network-timeout 600000 || yarn install --network-timeout 600000' </dev/null >"$rel/.yarn.log" 2>&1 ); then
  err "yarn install failed/timed out — last lines:"; tail -n 30 "$rel/.yarn.log" >&2
  die "repair failed at frontend packages (see output above)"
fi

step "Rebuilding frontend (production build)"
memkb="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 4194304)"
maxold=$(( memkb / 1024 * 3 / 4 ))
[ "$maxold" -gt 4096 ] && maxold=4096
[ "$maxold" -lt 1024 ] && maxold=1024
if ! ( cd "$rel/frontend" && \
       GENERATE_SOURCEMAP=false CI=false COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_OPTIONS="--max-old-space-size=$maxold" \
       timeout 900 yarn build </dev/null >"$rel/.build.log" 2>&1 ); then
  err "frontend build failed or timed out — last lines:"; tail -n 40 "$rel/.build.log" >&2
  die "repair failed at frontend build (see output above)"
fi

step "Restarting service"
systemctl restart "$SERVICE" 2>/dev/null || true
sleep 3
reload_nginx || true

step "Health check"
if healthcheck; then
  ok "Repair complete → https://$PANEL_DOMAIN"
  notify_telegram "<b>[OK] Repair</b> completed on $(hostname) (version unchanged)
Panel: https://$PANEL_DOMAIN"
else
  err "Health check failed after repair"
  notify_telegram "<b>[FAIL] Repair</b> — health check failed on $(hostname)"
  die "Repair finished but health check failed — check logs"
fi
