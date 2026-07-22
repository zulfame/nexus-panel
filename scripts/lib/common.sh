#!/usr/bin/env bash
# Nexus Panel — shared library (sourced by all scripts). Not meant to run directly.

# ---- paths / constants ----
NEXUS_HOME="${NEXUS_HOME:-/opt/nexus-panel}"
NEXUS_CONF="${NEXUS_CONF:-$NEXUS_HOME/nexus.conf}"
RELEASES_DIR="$NEXUS_HOME/releases"
CURRENT="$NEXUS_HOME/current"
SHARED_DIR="$NEXUS_HOME/shared"
DATA_DIR="$NEXUS_HOME/data"
BACKUP_DIR="$NEXUS_HOME/backups"
VENV_DIR="$NEXUS_HOME/venv"
BACKEND_ENV="$SHARED_DIR/backend.env"
PREV_FILE="$NEXUS_HOME/.previous_release"

MONGO_CONTAINER="nexus-mongo"
MONGO_VOLUME="nexus-mongo-data"
MONGO_IMAGE="mongo:7"
SERVICE="nexus-panel"
PANEL_DB="${PANEL_DB:-nexus_panel}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
BACKEND_PORT=8001

# ---- output helpers ----
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_GRN=$'\033[0;32m'; C_YEL=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_BLU=$'\033[0;36m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_GRN=""; C_YEL=""; C_RED=""; C_BLU=""; C_DIM=""
fi
info() { printf "%s\n" "${C_BLU}==>${C_RESET} $*"; }
ok()   { printf "%s\n" "${C_GRN}[ok]${C_RESET} $*"; }
warn() { printf "%s\n" "${C_YEL}[warn]${C_RESET} $*" >&2; }
err()  { printf "%s\n" "${C_RED}[err]${C_RESET} $*" >&2; }
die()  { err "$*"; exit 1; }
step() { printf "\n%s\n" "${C_DIM}────────────────────────────────────────${C_RESET} $*"; }

require_root() { [ "$(id -u)" -eq 0 ] || die "Please run as root:  sudo $0"; }

# Print the last N (default 20) journal lines for the panel service — used to surface the
# real cause whenever the service/API fails to come up, instead of leaving you guessing.
dump_service_logs() {
  local n="${1:-20}"
  err "Last $n log lines for $SERVICE (journalctl -u $SERVICE -n $n):"
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u "$SERVICE" -n "$n" --no-pager 2>/dev/null | sed 's/^/    /' >&2 || true
  else
    warn "journalctl unavailable — run: systemctl status $SERVICE"
  fi
}

load_conf() {
  [ -f "$NEXUS_CONF" ] || die "Config not found at $NEXUS_CONF. Run install.sh first."
  set -a; . "$NEXUS_CONF"; set +a
  : "${PANEL_DOMAIN:?PANEL_DOMAIN missing in $NEXUS_CONF}"
  : "${GIT_REPO_URL:?GIT_REPO_URL missing in $NEXUS_CONF}"
  GIT_BRANCH="${GIT_BRANCH:-main}"
}

docker_bridge_ip() {
  docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1"
}

# Host-side mongodump/mongorestore for the panel's Databases (backup/restore) feature.
# The mongo:7 image does not ship these tools, so install them on the host. Primary method is
# MongoDB's standalone Database Tools .deb (version-independent, works across distros where the
# mongodb-org apt repo may not yet publish the current release codename, e.g. Ubuntu 24.04).
install_mongo_tools() {
  if command -v mongodump >/dev/null 2>&1 && command -v mongorestore >/dev/null 2>&1; then
    ok "mongodb-database-tools present"; return 0
  fi
  step "Installing MongoDB Database Tools (mongodump/mongorestore)"
  export DEBIAN_FRONTEND=noninteractive
  local os_id verid arch deb_arch platform tmp url ver
  os_id="$(. /etc/os-release && echo "${ID:-ubuntu}")"
  verid="$(. /etc/os-release && echo "${VERSION_ID:-}")"
  arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  case "$arch" in arm64) deb_arch="arm64";; *) deb_arch="x86_64";; esac
  if [ "$os_id" = "debian" ]; then
    case "$verid" in 11*) platform="debian11";; 12*|13*) platform="debian12";; *) platform="debian12";; esac
  else
    case "$verid" in 20*) platform="ubuntu2004";; 22*) platform="ubuntu2204";; 24*|25*) platform="ubuntu2404";; *) platform="ubuntu2204";; esac
  fi
  tmp="/tmp/nexus-mongodb-database-tools.deb"
  for ver in 100.10.0 100.11.0; do
    url="https://fastdl.mongodb.org/tools/db/mongodb-database-tools-${platform}-${deb_arch}-${ver}.deb"
    info "Downloading $url"
    if curl -fsSL "$url" -o "$tmp" 2>/dev/null; then
      if apt-get install -y -q "$tmp" >/dev/null 2>&1 || { dpkg -i "$tmp" >/dev/null 2>&1; apt-get install -y -q -f >/dev/null 2>&1; }; then
        rm -f "$tmp"
        ok "mongodb-database-tools installed ($(mongodump --version 2>/dev/null | head -1))"
        return 0
      fi
    fi
  done
  rm -f "$tmp"
  # Fallback: MongoDB apt repo (8.0 has the widest codename coverage incl. noble/bookworm).
  warn "Standalone package failed — trying MongoDB apt repo (8.0)"
  local codename repo_base component
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg --dearmor -o /etc/apt/keyrings/mongodb-8.0.gpg 2>/dev/null || true
  chmod a+r /etc/apt/keyrings/mongodb-8.0.gpg 2>/dev/null || true
  if [ "$os_id" = "debian" ]; then
    repo_base="https://repo.mongodb.org/apt/debian"; component="main"; [ -n "$codename" ] || codename="bookworm"
  else
    repo_base="https://repo.mongodb.org/apt/ubuntu"; component="multiverse"; [ -n "$codename" ] || codename="jammy"
  fi
  echo "deb [ signed-by=/etc/apt/keyrings/mongodb-8.0.gpg ] $repo_base $codename/mongodb-org/8.0 $component" \
    > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -y -q || true
  if apt-get install -y -q mongodb-database-tools; then
    ok "mongodb-database-tools installed ($(mongodump --version 2>/dev/null | head -1))"
    return 0
  fi
  warn "mongodb-database-tools install failed."
  return 1
}

reload_nginx() {
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
    return 0
  fi
  warn "nginx config test failed"; return 1
}

# Best-effort Telegram notification (reads TELEGRAM_* from nexus.conf via load_conf).
notify_telegram() {
  local text="$1"
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -fsS --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    ${TELEGRAM_THREAD_ID:+-d message_thread_id="${TELEGRAM_THREAD_ID}"} \
    -d parse_mode=HTML \
    --data-urlencode text="$text" >/dev/null 2>&1 || true
}

# ---- release-based atomic deploy (used by install & update) ----
prune_releases() {
  local cur prev
  cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  prev="$(cat "$PREV_FILE" 2>/dev/null || true)"
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r d; do
    d="${d%/}"
    [ "$d" = "$cur" ] && continue
    [ "$d" = "$prev" ] && continue
    rm -rf "$d"
  done
}

# Validate a backend requirements.txt before an expensive build. Rejects entries that are not
# installable from public PyPI — the classic failure being a stray `pip freeze` that captured
# Emergent's internal packages / private wheel URLs. Returns non-zero (with a clear message) on
# a bad file so the caller can abort early instead of failing deep inside pip.
validate_requirements() {
  local req="$1"
  [ -f "$req" ] || { err "requirements.txt not found at $req"; return 1; }
  local bad
  # internal-only package that does not exist on public PyPI
  bad="$(grep -inE '^[[:space:]]*emergentintegrations([[:space:]=<>!~]|$)' "$req" || true)"
  if [ -n "$bad" ]; then
    err "requirements.txt contains the internal-only package 'emergentintegrations' (not on PyPI):"
    printf '    %s\n' "$bad" >&2
    err "This usually means the file was overwritten by 'pip freeze'. Restore a minimal, PyPI-only list."
    return 1
  fi
  # direct-URL / private wheel dependencies (e.g. customer-assets.emergentagent.com)
  bad="$(grep -inE '@[[:space:]]*https?://|emergentagent\.com' "$req" || true)"
  if [ -n "$bad" ]; then
    err "requirements.txt references private/direct-URL dependencies that won't resolve on the VPS:"
    printf '    %s\n' "$bad" >&2
    err "Remove URL-pinned deps and use plain PyPI version pins instead."
    return 1
  fi
  ok "requirements.txt validated (PyPI-only)"
  return 0
}


# deploy_release [git-ref]  -> clones fresh, builds, atomically switches "current".
# On any failure the partial release dir is removed so nothing accumulates.
deploy_release() {
  local ref="${1:-$GIT_BRANCH}"
  local ts rel repo prev
  ts="$(date +%Y%m%d%H%M%S)"
  rel="$RELEASES_DIR/$ts"
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR"
  # clean the partial release if the user aborts (Ctrl+C) so nothing accumulates
  trap 'rm -rf "$rel" 2>/dev/null; err "aborted — partial release removed"; exit 130' INT TERM

  repo="$GIT_REPO_URL"
  if [ -n "${GIT_TOKEN:-}" ] && [[ "$repo" == https://* ]]; then
    repo="https://${GIT_TOKEN}@${repo#https://}"
  fi

  info "Fetching source ($ref) → release $ts"
  if ! git clone --branch "$ref" --depth 1 "$repo" "$rel" >/dev/null 2>&1; then
    rm -rf "$rel"; die "git clone failed (check GIT_REPO_URL / GIT_BRANCH / GIT_TOKEN)"
  fi

  # link shared backend env; write frontend build env
  ln -sfn "$BACKEND_ENV" "$rel/backend/.env"
  printf 'REACT_APP_BACKEND_URL=https://%s\nWDS_SOCKET_PORT=443\n' "$PANEL_DOMAIN" > "$rel/frontend/.env"

  # Guard: reject a requirements.txt that was accidentally overwritten by a full `pip freeze`
  # of a dev environment. Such files pull in internal-only packages (emergentintegrations) or
  # private wheel URLs (customer-assets.emergentagent.com) that don't exist on public PyPI, so
  # the build would fail deep inside pip and trigger a needless rollback. Fail fast & clearly.
  validate_requirements "$rel/backend/requirements.txt" || { rm -rf "$rel"; die "requirements.txt failed pre-deploy validation (see above)"; }

  info "Installing backend deps"
  python3 -m venv "$VENV_DIR" >/dev/null 2>&1 || true
  "$VENV_DIR/bin/pip" install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
  if ! "$VENV_DIR/bin/pip" install -r "$rel/backend/requirements.txt" >"$rel/.pip.log" 2>&1; then
    err "pip install failed — last lines:"; tail -n 30 "$rel/.pip.log" >&2
    rm -rf "$rel"; die "pip install failed (see output above)"
  fi

  info "Installing frontend packages"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if ! ( cd "$rel/frontend" && timeout 900 sh -c 'yarn install --frozen-lockfile --network-timeout 600000 || yarn install --network-timeout 600000' </dev/null >"$rel/.yarn.log" 2>&1 ); then
    err "yarn install failed/timed out — last lines:"; tail -n 30 "$rel/.yarn.log" >&2
    rm -rf "$rel"; die "yarn install failed (see output above)"
  fi

  info "Compiling frontend (production build) — sourcemaps off for speed"
  local memkb maxold
  memkb="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 4194304)"
  maxold=$(( memkb / 1024 * 3 / 4 ))
  [ "$maxold" -gt 4096 ] && maxold=4096
  [ "$maxold" -lt 1024 ] && maxold=1024
  if ! ( cd "$rel/frontend" && \
         GENERATE_SOURCEMAP=false CI=false COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_OPTIONS="--max-old-space-size=$maxold" \
         timeout 900 yarn build </dev/null >"$rel/.build.log" 2>&1 ); then
    err "frontend build failed or timed out — last lines:"; tail -n 40 "$rel/.build.log" >&2
    rm -rf "$rel"; die "frontend build failed (see output above)"
  fi

  # atomic switch
  trap - INT TERM
  prev="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  ln -sfn "$rel" "$CURRENT"
  [ -n "$prev" ] && echo "$prev" > "$PREV_FILE"

  systemctl restart "$SERVICE" 2>/dev/null || true
  sleep 3
  reload_nginx || true
  prune_releases
  ok "Release $ts is now live"
}

healthcheck() {
  local fail=0 i
  # wait up to ~40s for the service to boot and the API to bind (avoids false rollback)
  for i in $(seq 1 20); do
    if systemctl is-active --quiet "$SERVICE" 2>/dev/null \
       && curl -fsS --max-time 4 "http://127.0.0.1:$BACKEND_PORT/api/" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if systemctl is-active --quiet "$SERVICE"; then ok "service: $SERVICE active"; else err "service: $SERVICE not active"; fail=1; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then ok "mongo: container up"; else err "mongo: $MONGO_CONTAINER not running"; fail=1; fi
  if curl -fsS --max-time 6 "http://127.0.0.1:$BACKEND_PORT/api/" >/dev/null 2>&1; then ok "api: responding on :$BACKEND_PORT"; else err "api: not responding"; fail=1; fi
  # On any failure, surface the service logs so the root cause is immediately visible.
  if [ "$fail" -ne 0 ]; then dump_service_logs 20; fi
  return $fail
}
