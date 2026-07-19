#!/usr/bin/env bash
# Nexus Panel — health check. Exit 0 = healthy. Add --watch to loop every 5s.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
load_conf 2>/dev/null || true

run_once() {
  step "Nexus Panel health"
  healthcheck; local rc=$?
  if [ -n "${PANEL_DOMAIN:-}" ]; then
    if curl -fsS --max-time 8 "https://$PANEL_DOMAIN/api/" >/dev/null 2>&1; then
      ok "public: https://$PANEL_DOMAIN reachable"
    else
      warn "public: https://$PANEL_DOMAIN not reachable (DNS/SSL?)"
    fi
  fi
  return $rc
}

if [ "${1:-}" = "--watch" ]; then
  while true; do clear; run_once || true; sleep 5; done
else
  run_once
fi
