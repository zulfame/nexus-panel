#!/usr/bin/env bash
# Nexus Panel — uninstall. Keeps backups by default.
#   uninstall.sh          -> remove service, nginx vhost, releases, keep Mongo data + backups
#   uninstall.sh --purge   -> also delete MongoDB volume, all data and backups
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root

PURGE=0; [ "${1:-}" = "--purge" ] && PURGE=1

if [ "${NONINTERACTIVE:-0}" != "1" ]; then
  read -rp "Uninstall Nexus Panel${PURGE:+ and PURGE all data}? [y/N]: " a
  [[ "$a" =~ ^[Yy]$ ]] || die "Aborted"
fi

step "Stopping service"
systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/$SERVICE.service"; systemctl daemon-reload || true

step "Removing nginx vhost"
rm -f "/etc/nginx/sites-enabled/$SERVICE.conf" "/etc/nginx/sites-available/$SERVICE.conf"
reload_nginx || true

step "Removing MongoDB container"
docker rm -f "$MONGO_CONTAINER" >/dev/null 2>&1 || true

if [ "$PURGE" = "1" ]; then
  step "Purging data + volume + backups"
  docker volume rm "$MONGO_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$NEXUS_HOME"
  ok "Everything removed."
else
  step "Removing releases (keeping data, backups, config)"
  rm -rf "$RELEASES_DIR" "$CURRENT" "$VENV_DIR"
  ok "Panel removed. Data + backups kept in $NEXUS_HOME. Use --purge to wipe."
fi
