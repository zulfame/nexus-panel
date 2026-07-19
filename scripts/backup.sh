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
docker exec "$MONGO_CONTAINER" mongodump --quiet --archive --gzip > "$stage/mongo.archive.gz" \
  || die "mongodump failed (is $MONGO_CONTAINER running?)"

cp -f "$BACKEND_ENV" "$stage/backend.env" 2>/dev/null || true
cp -f "$NEXUS_CONF"  "$stage/nexus.conf"  2>/dev/null || true
cp -a "$DATA_DIR/nginx" "$stage/data/nginx" 2>/dev/null || true

tar czf "$out" -C "$work" nexus
find "$BACKUP_DIR" -maxdepth 1 -name 'nexus-backup-*.tar.gz' | sort | head -n "-$KEEP_BACKUPS" | xargs -r rm -f
ok "Backup created: $out  ($(du -h "$out" | cut -f1))"
notify_telegram "<b>[OK] Backup</b> created on $(hostname)
File: $(basename "$out") ($(du -h "$out" | cut -f1))"
