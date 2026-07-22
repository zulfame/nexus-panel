#!/usr/bin/env bash
# Nexus Panel — one-shot installer for a FRESH Ubuntu 24.04 LTS server.
# Installs Docker, Nginx, Certbot, Node, Python; deploys the panel; configures
# a subdomain vhost + Let's Encrypt SSL (auto-renew); registers a systemd service.
# Safe to re-run: idempotent, and failed builds never accumulate leftover files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_root

# ------------------------------------------------------------ config gather --
prompt_var() {  # prompt_var VAR "Question" "default" [secret]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" cur="${!1:-}" ans
  [ -n "$cur" ] && { printf -v "$var" '%s' "$cur"; return; }
  if [ "${NONINTERACTIVE:-0}" = "1" ]; then
    [ -n "$def" ] && { printf -v "$var" '%s' "$def"; return; }
    die "Missing required value for $var (non-interactive mode)"
  fi
  if [ "$secret" = "secret" ]; then
    read -rsp "$q: " ans; echo
  else
    read -rp "$q${def:+ [$def]}: " ans
  fi
  printf -v "$var" '%s' "${ans:-$def}"
}

gather_config() {
  if [ -f "$NEXUS_CONF" ]; then
    info "Using existing config: $NEXUS_CONF"
    set -a; . "$NEXUS_CONF"; set +a
  fi
  step "Configuration"
  prompt_var PANEL_DOMAIN       "Panel subdomain (e.g. panel.yourdomain.com)"
  prompt_var LETSENCRYPT_EMAIL  "Email for Let's Encrypt"
  prompt_var GIT_REPO_URL       "Panel Git repo URL"
  prompt_var GIT_BRANCH         "Git branch" "main"
  prompt_var GIT_TOKEN          "GitHub token (blank if public)" ""
  prompt_var ADMIN_USERNAME     "Admin username" "superadmin"
  prompt_var ADMIN_EMAIL        "Admin email" "admin@$PANEL_DOMAIN"
  if [ -z "${ADMIN_PASSWORD:-}" ]; then
    prompt_var ADMIN_PASSWORD   "Admin password" "" secret
    [ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)"
  fi
  prompt_var TELEGRAM_BOT_TOKEN  "Telegram bot token (blank to skip notifications)" ""
  prompt_var TELEGRAM_CHAT_ID    "Telegram chat id" ""
  prompt_var TELEGRAM_THREAD_ID  "Telegram message thread id (blank if none)" ""

  mkdir -p "$NEXUS_HOME"
  umask 077
  cat > "$NEXUS_CONF" <<EOF
PANEL_DOMAIN="$PANEL_DOMAIN"
LETSENCRYPT_EMAIL="$LETSENCRYPT_EMAIL"
GIT_REPO_URL="$GIT_REPO_URL"
GIT_BRANCH="$GIT_BRANCH"
GIT_TOKEN="$GIT_TOKEN"
ADMIN_USERNAME="$ADMIN_USERNAME"
ADMIN_EMAIL="$ADMIN_EMAIL"
TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
TELEGRAM_THREAD_ID="$TELEGRAM_THREAD_ID"
KEEP_RELEASES="${KEEP_RELEASES}"
KEEP_BACKUPS="${KEEP_BACKUPS}"
EOF
  umask 022
  ok "Saved config to $NEXUS_CONF"
}

# ---------------------------------------------------------- package installs --
apt_base() {
  step "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y -q
  apt-get install -y -q ca-certificates curl git gnupg jq ufw openssl \
    build-essential python3 python3-dev python3-venv python3-pip libffi-dev libssl-dev \
    nginx certbot python3-certbot-nginx
  ok "Base packages ready"
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker already present"; return
  fi
  step "Installing Docker Engine + Compose"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed"
}

install_node() {
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if command -v node >/dev/null 2>&1 && node -v | grep -qE 'v(20|22)'; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare yarn@1.22.22 --activate >/dev/null 2>&1 || true
    ok "Node already present ($(node -v))"; return
  fi
  step "Installing Node.js 20 + Yarn (corepack)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs
  corepack enable >/dev/null 2>&1 || npm i -g yarn >/dev/null 2>&1 || true
  corepack prepare yarn@1.22.22 --activate >/dev/null 2>&1 || true
  ok "Node $(node -v) ready"
}

# ---------------------------------------------------------- mongodb -----
setup_mongo() {
  step "Starting MongoDB (container: $MONGO_CONTAINER)"
  local bip; bip="$(docker_bridge_ip)"
  docker volume create "$MONGO_VOLUME" >/dev/null 2>&1 || true
  # remove any previous (possibly failed) container so we never stack duplicates
  docker rm -f "$MONGO_CONTAINER" >/dev/null 2>&1 || true
  # bound to the docker bridge IP: reachable by host + project containers, NOT the public interface
  docker run -d --name "$MONGO_CONTAINER" --restart unless-stopped \
    -p "$bip:27017:27017" -v "$MONGO_VOLUME:/data/db" "$MONGO_IMAGE" >/dev/null
  ok "MongoDB up on $bip:27017"
}

# Host-side mongodump/mongorestore, used by the panel's Databases (backup/restore) feature.
# The mongo:7 image does not ship these tools, so install them on the host (best-effort).
# Primary method is MongoDB's standalone Database Tools .deb (version-independent, works across
# distros where the mongodb-org apt repo may not yet publish the current release codename).
install_mongo_tools() {
  if command -v mongodump >/dev/null 2>&1 && command -v mongorestore >/dev/null 2>&1; then
    ok "mongodb-database-tools present"; return
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
        return
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
  else
    warn "mongodb-database-tools install failed — Databases backup/restore stays disabled until"
    warn "you install it manually (see the panel's Databases page)."
  fi
}

# ------------------------------------------------------------- backend env ----
write_backend_env() {
  mkdir -p "$SHARED_DIR" "$NEXUS_HOME/apps" "$DATA_DIR/nginx"
  if [ -f "$BACKEND_ENV" ]; then
    ok "Preserving existing backend env (admin password kept)"; return
  fi
  step "Generating backend environment + secrets"
  local bip jwt fkey
  bip="$(docker_bridge_ip)"
  jwt="$(openssl rand -hex 32)"
  fkey="$(python3 -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
  umask 077
  cat > "$BACKEND_ENV" <<EOF
MONGO_URL="mongodb://$bip:27017"
DB_NAME="$PANEL_DB"
CORS_ORIGINS="https://$PANEL_DOMAIN"
JWT_SECRET="$jwt"
ADMIN_EMAIL="$ADMIN_EMAIL"
ADMIN_USERNAME="$ADMIN_USERNAME"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
PANEL_ENCRYPTION_KEY="$fkey"
PANEL_DATA_DIR="$DATA_DIR"
NEXUS_APPS_DIR="$NEXUS_HOME/apps"
NGINX_SITES_DIR="$DATA_DIR/nginx"
HOST_MONGO_URL="mongodb://host.docker.internal:27017"
NEXUS_HOME="$NEXUS_HOME"
NEXUS_SCRIPTS_DIR="$CURRENT/scripts"
NEXUS_BACKUP_DIR="$BACKUP_DIR"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_THREAD_ID="${TELEGRAM_THREAD_ID:-}"
EOF
  umask 022
  ok "Backend env written"
}

# --------------------------------------------------------- systemd service ----
write_service() {
  step "Registering systemd service"
  cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Nexus Panel Backend
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$CURRENT/backend
ExecStart=$VENV_DIR/bin/uvicorn server:app --host 127.0.0.1 --port $BACKEND_PORT
Restart=always
RestartSec=3
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1 || true
  ok "Service $SERVICE registered"
}

# ------------------------------------------------------------------ nginx -----
write_nginx() {
  step "Configuring Nginx vhost for $PANEL_DOMAIN"
  rm -f /etc/nginx/sites-enabled/default
  local conf="/etc/nginx/sites-available/$SERVICE.conf"
  cat > "$conf" <<EOF
server {
    listen 80;
    server_name $PANEL_DOMAIN;
    root $CURRENT/frontend/build;
    index index.html;
    client_max_body_size 25m;

    location /api {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
  ln -sfn "$conf" "/etc/nginx/sites-enabled/$SERVICE.conf"
  reload_nginx || die "nginx failed to reload"
  ok "Nginx vhost active (HTTP)"
}

issue_ssl() {
  step "Requesting Let's Encrypt certificate"
  if certbot --nginx -d "$PANEL_DOMAIN" --non-interactive --agree-tos \
       -m "$LETSENCRYPT_EMAIL" --redirect >/dev/null 2>&1; then
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    ok "SSL issued + auto-renew enabled (https://$PANEL_DOMAIN)"
  else
    warn "SSL issuance failed. Ensure the DNS A record for '$PANEL_DOMAIN' points to this server, then run:"
    warn "  certbot --nginx -d $PANEL_DOMAIN -m $LETSENCRYPT_EMAIL --agree-tos --redirect"
    warn "Panel is reachable over HTTP for now."
  fi
}

# ------------------------------------------------------------ backup timer ----
setup_backup_timer() {
  step "Enabling nightly automatic backup"
  cat > "/etc/systemd/system/nexus-backup.service" <<EOF
[Unit]
Description=Nexus Panel nightly backup
[Service]
Type=oneshot
ExecStart=$CURRENT/scripts/backup.sh
EOF
  cat > "/etc/systemd/system/nexus-backup.timer" <<EOF
[Unit]
Description=Run Nexus Panel backup daily
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now nexus-backup.timer >/dev/null 2>&1 || true
  ok "Nightly backup scheduled (02:30)"
}

# -------------------------------------------------------------------- swap ----
ensure_swap() {
  local memkb; memkb="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
  if [ "${memkb:-0}" -lt 2000000 ] && ! swapon --show 2>/dev/null | grep -q .; then
    step "Low RAM detected — adding 2G swap (helps the frontend build)"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1 || true
    swapon /swapfile 2>/dev/null || true
    grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "Swap enabled"
  fi
}

# ------------------------------------------------------------------ firewall --
setup_firewall() {
  step "Configuring firewall (UFW)"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "Firewall: 22, 80, 443 allowed"
}

# --------------------------------------------------------------------- main ---
main() {
  step "Nexus Panel installer"
  gather_config
  apt_base
  install_docker
  install_node
  setup_mongo
  install_mongo_tools
  write_backend_env
  ensure_swap
  write_nginx        # writes vhost pointing at $CURRENT (built next)
  deploy_release "$GIT_BRANCH"
  write_service
  systemctl restart "$SERVICE"
  sleep 3
  reload_nginx || true
  setup_firewall
  setup_backup_timer
  issue_ssl

  step "Health check"
  if healthcheck; then
    printf "\n%s\n" "${C_GRN}Nexus Panel installed successfully.${C_RESET}"
  else
    warn "Some checks failed — inspect: journalctl -u $SERVICE -n 100"
  fi
  cat <<EOF

  URL       : https://$PANEL_DOMAIN
  Username  : $ADMIN_USERNAME
  Password  : (the one you set during install)
  Data      : $DATA_DIR
  Manage    : $CURRENT/scripts/{update,backup,restore,rollback,healthcheck,uninstall}.sh

EOF
}

main "$@"
