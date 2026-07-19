#!/usr/bin/env bash
# Emergent Deploy Panel — VPS installer for Ubuntu 24.04 LTS
# Installs Docker, Nginx, Certbot and prepares the host so the panel can
# manage project deployments. Run as root:  sudo bash install.sh
set -euo pipefail

echo "==> Updating apt"
apt-get update -y

echo "==> Installing base packages (git, nginx, certbot)"
apt-get install -y git nginx certbot python3-certbot-nginx curl ca-certificates

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Preparing nginx sites + certbot webroot"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /var/www/certbot
grep -q "sites-enabled" /etc/nginx/nginx.conf || \
  sed -i '/http {/a \    include /etc/nginx/sites-enabled/*.conf;' /etc/nginx/nginx.conf

echo "==> Panel data directory"
mkdir -p /opt/emergent-panel/data/apps /opt/emergent-panel/data/nginx

cat <<'NOTE'

============================================================
 Base host is ready. Next steps to run the PANEL itself:

 1) Ensure MongoDB is available (host install or docker):
      docker run -d --name panel-mongo -p 27017:27017 \
        -v panel_mongo:/data/db --restart unless-stopped mongo:7

 2) Clone the panel repo, then set backend/.env:
      MONGO_URL="mongodb://localhost:27017"
      DB_NAME="deploy_panel"
      JWT_SECRET="<random 64 hex>"
      ADMIN_USERNAME="admin"
      ADMIN_PASSWORD="<strong password>"
      PANEL_ENCRYPTION_KEY="<fernet key: python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())'>"
      PANEL_DATA_DIR="/opt/emergent-panel/data/apps"
      NGINX_SITES_DIR="/opt/emergent-panel/data/nginx"
      HOST_MONGO_URL="mongodb://host.docker.internal:27017"

 3) Run the panel backend (needs root or docker group + nginx write access):
      cd backend && pip install -r requirements.txt
      uvicorn server:app --host 0.0.0.0 --port 8001
    Frontend: set REACT_APP_BACKEND_URL to the panel's public URL, then
      yarn install && yarn build   (serve the build/ dir behind nginx)

 4) Point a wildcard DNS record (*.yourdomain.com) at this server's IP.
    Each project you add gets its own subdomain + nginx vhost automatically.
============================================================
NOTE
echo "Done."
