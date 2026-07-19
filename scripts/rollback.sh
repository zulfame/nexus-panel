#!/usr/bin/env bash
# Nexus Panel — instantly switch back to the previous release.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root
load_conf

prev="$(cat "$PREV_FILE" 2>/dev/null || true)"
[ -n "$prev" ] && [ -d "$prev" ] || die "No previous release recorded to roll back to."
cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"

step "Rolling back"
info "current : $cur"
info "target  : $prev"
ln -sfn "$prev" "$CURRENT"
[ -n "$cur" ] && echo "$cur" > "$PREV_FILE"   # allow toggling forward again
systemctl restart "$SERVICE"; sleep 2; reload_nginx || true

if healthcheck; then ok "Rolled back to $(basename "$prev")"; else warn "Rollback done but health check still failing"; fi
