#!/usr/bin/env bash
# Nexus Panel — renew all Let's Encrypt certificates and reload nginx.
# The panel also auto-renews in-process (daily). Use this for a real cron job:
#   0 3 * * 1  /opt/nexus-panel/current/scripts/renew-ssl.sh >> /var/log/nexus-renew.log 2>&1
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
load_conf 2>/dev/null || true

require_root
step "Renewing Let's Encrypt certificates"

if ! command -v certbot >/dev/null 2>&1; then
  die "certbot not installed"
fi

mkdir -p /var/www/certbot

if certbot renew --webroot -w /var/www/certbot --non-interactive --quiet; then
  ok "certbot renew completed"
  reload_nginx || true
  notify_telegram "🔐 <b>Nexus Panel</b>%0ASSL renew job selesai (certbot renew)."
else
  err "certbot renew failed"
  notify_telegram "⚠️ <b>Nexus Panel</b>%0ASSL renew job GAGAL. Cek log renew."
  exit 1
fi
