#!/usr/bin/env bash
# Nexus Panel — update to the latest code from the configured Git repo.
# Backs up first, deploys a fresh release atomically, and auto-rolls-back on failure.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root
load_conf

UPDATE_LOG="${NEXUS_HOME:-/opt/nexus-panel}/update.log"
: > "$UPDATE_LOG"
exec > >(tee -a "$UPDATE_LOG") 2>&1
trap 'echo "__UPDATE_END__ rc=$?"' EXIT

step "Pre-update backup"
"$SCRIPT_DIR/backup.sh" || warn "backup failed (continuing anyway)"

step "Deploying latest ($GIT_BRANCH)"
deploy_release "$GIT_BRANCH"

step "Health check"
if healthcheck; then
  ok "Update complete → https://$PANEL_DOMAIN"
  notify_telegram "<b>[OK] Update</b> deployed on $(hostname)
Panel: https://$PANEL_DOMAIN"
else
  err "Health check failed after update — rolling back"
  notify_telegram "<b>[FAIL] Update</b> failed on $(hostname) — rolling back"
  "$SCRIPT_DIR/rollback.sh" || true
  die "Update rolled back to previous release"
fi
