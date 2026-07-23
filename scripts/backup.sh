#!/usr/bin/env bash
# Nexus Panel — backup MongoDB + panel config/nginx into a single tarball.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root
load_conf

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d%H%M%S)"
out="$BACKUP_DIR/nexus-backup-$ts.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

stage="$work/nexus"
mkdir -p "$stage/data"

step "Dumping MongoDB ($PANEL_DB + managed DBs)"
# mongo:7 image does NOT ship the database tools — use the host binaries (installed by
# install_mongo_tools) against the mongo container over the docker bridge. Fall back to
# docker exec only if the host tools are somehow missing.
muri="$(grep -E '^MONGO_URL=' "$BACKEND_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
[ -n "$muri" ] || muri="mongodb://$(docker_bridge_ip):27017"
if command -v mongodump >/dev/null 2>&1; then
  mongodump --uri="$muri" --quiet --archive="$stage/mongo.archive.gz" --gzip \
    || die "mongodump failed (host tools; check mongodb-database-tools & $MONGO_CONTAINER)"
else
  docker exec "$MONGO_CONTAINER" mongodump --quiet --archive --gzip > "$stage/mongo.archive.gz" \
    || die "mongodump failed (is $MONGO_CONTAINER running?)"
fi

cp -f "$BACKEND_ENV" "$stage/backend.env" 2>/dev/null || true
cp -f "$NEXUS_CONF"  "$stage/nexus.conf"  2>/dev/null || true
cp -a "$DATA_DIR/nginx" "$stage/data/nginx" 2>/dev/null || true

# Persistent per-project storage (uploads etc. mounted to container /app/data).
if [ -d "$NEXUS_HOME/apps" ]; then
  for d in "$NEXUS_HOME"/apps/*/storage; do
    [ -d "$d" ] || continue
    slug="$(basename "$(dirname "$d")")"
    mkdir -p "$stage/apps/$slug"
    cp -a "$d" "$stage/apps/$slug/storage" 2>/dev/null || true
  done
fi

tar czf "$out" -C "$work" nexus
find "$BACKUP_DIR" -maxdepth 1 -name 'nexus-backup-*.tar.gz' | sort | head -n "-$KEEP_BACKUPS" | xargs -r rm -f
ok "Backup created: $out  ($(du -h "$out" | cut -f1))"
notify_telegram "<b>[OK] Backup</b> created on $(hostname)
File: $(basename "$out") ($(du -h "$out" | cut -f1))"
