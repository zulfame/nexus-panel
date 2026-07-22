#!/usr/bin/env bash
# Nexus Panel — install MongoDB Database Tools (mongodump/mongorestore) on the host.
# Triggered from the panel's Databases page so no SSH is needed. Streams output to a log
# file that the UI polls. The panel detects the tools at runtime — a page refresh is enough.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
require_root

LOG="${NEXUS_HOME:-/opt/nexus-panel}/db-tools-install.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "__DBTOOLS_END__ rc=$?"' EXIT

install_mongo_tools

if command -v mongodump >/dev/null 2>&1 && command -v mongorestore >/dev/null 2>&1; then
  ok "Database tools ready — refresh the Databases page to enable backup & restore."
else
  die "Database tools still unavailable after the install attempt (see log above)."
fi
