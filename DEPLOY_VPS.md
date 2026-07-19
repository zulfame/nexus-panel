# Deploying Nexus Panel to your VPS

Full documentation now lives in **[README.md](./README.md)**.

**TL;DR** on a fresh Ubuntu 24.04 server:
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/youruser/nexus-panel.git
cd nexus-panel/scripts
sudo bash install.sh
```
The installer sets up Docker, Nginx, Certbot, Node, Python, MongoDB, the systemd
service, your subdomain + Let's Encrypt SSL (auto-renew), the firewall, and a nightly
backup — then prints your panel URL.

Day-2 operations (`update`, `backup`, `restore`, `rollback`, `healthcheck`, `uninstall`)
are documented in the README under **Operations**.
