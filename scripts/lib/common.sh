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

# deploy_release [git-ref]  -> clones fresh, builds, atomically switches "current".
# On any failure the partial release dir is removed so nothing accumulates.
deploy_release() {
  local ref="${1:-$GIT_BRANCH}"
  local ts rel repo prev
  ts="$(date +%Y%m%d%H%M%S)"
  rel="$RELEASES_DIR/$ts"
  mkdir -p "$RELEASES_DIR" "$SHARED_DIR"

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

  info "Installing backend deps"
  python3 -m venv "$VENV_DIR" >/dev/null 2>&1 || true
  "$VENV_DIR/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
  if ! "$VENV_DIR/bin/pip" install -r "$rel/backend/requirements.txt" >/dev/null 2>&1; then
    rm -rf "$rel"; die "pip install failed"
  fi

  info "Building frontend (this can take a few minutes)"
  if ! ( cd "$rel/frontend" && (yarn install --frozen-lockfile >/dev/null 2>&1 || yarn install >/dev/null 2>&1) ); then
    rm -rf "$rel"; die "yarn install failed"
  fi
  if ! ( cd "$rel/frontend" && yarn build >/dev/null 2>&1 ); then
    rm -rf "$rel"; die "yarn build failed"
  fi

  # atomic switch
  prev="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  ln -sfn "$rel" "$CURRENT"
  [ -n "$prev" ] && echo "$prev" > "$PREV_FILE"

  systemctl restart "$SERVICE" 2>/dev/null || true
  reload_nginx || true
  prune_releases
  ok "Release $ts is now live"
}

healthcheck() {
  local fail=0
  if systemctl is-active --quiet "$SERVICE"; then ok "service: $SERVICE active"; else err "service: $SERVICE not active"; fail=1; fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then ok "mongo: container up"; else err "mongo: $MONGO_CONTAINER not running"; fail=1; fi
  if curl -fsS --max-time 6 "http://127.0.0.1:$BACKEND_PORT/api/" >/dev/null 2>&1; then ok "api: responding on :$BACKEND_PORT"; else err "api: not responding"; fail=1; fi
  return $fail
}
