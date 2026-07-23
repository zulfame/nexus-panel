#!/usr/bin/env bash
# Nexus Panel — restore from a backup tarball.  Usage: restore.sh <file|latest>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root
load_conf

sel="${1:-latest}"
if [ "$sel" = "latest" ]; then
  sel="$(ls -1t "$BACKUP_DIR"/nexus-backup-*.tar.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$sel" ] && [ -f "$sel" ] || die "Backup file not found. Usage: restore.sh <path|latest>"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
tar xzf "$sel" -C "$work"
[ -f "$work/nexus/mongo.archive.gz" ] || die "Invalid backup (no mongo archive)"

step "Restoring from $(basename "$sel")"
# Prefer host mongorestore (mongo:7 image lacks the tools); fall back to docker exec.
muri="$(grep -E '^MONGO_URL=' "$BACKEND_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
[ -n "$muri" ] || muri="mongodb://$(docker_bridge_ip):27017"
if command -v mongorestore >/dev/null 2>&1; then
  mongorestore --uri="$muri" --quiet --archive="$work/nexus/mongo.archive.gz" --gzip --drop \
    || die "mongorestore failed"
else
  docker exec -i "$MONGO_CONTAINER" mongorestore --quiet --archive --gzip --drop < "$work/nexus/mongo.archive.gz" \
    || die "mongorestore failed"
fi
[ -f "$work/nexus/backend.env" ] && cp -f "$work/nexus/backend.env" "$BACKEND_ENV"
mkdir -p "$DATA_DIR/nginx"
cp -a "$work/nexus/data/nginx/." "$DATA_DIR/nginx/" 2>/dev/null || true

# Restore persistent per-project storage.
if [ -d "$work/nexus/apps" ]; then
  for sd in "$work"/nexus/apps/*/storage; do
    [ -d "$sd" ] || continue
    slug="$(basename "$(dirname "$sd")")"
    mkdir -p "$NEXUS_HOME/apps/$slug"
    cp -a "$sd" "$NEXUS_HOME/apps/$slug/storage" 2>/dev/null || true
  done
fi

systemctl restart "$SERVICE"; sleep 2; reload_nginx || true
healthcheck && ok "Restore complete" || warn "Restore done but health check failing"
