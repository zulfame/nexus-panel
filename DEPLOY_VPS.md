# Emergent Deploy Panel — VPS Deployment Guide

A self-hosted control panel to deploy multiple **FastAPI + MongoDB + React** projects
(built with Emergent) on a **single Ubuntu 24.04 VPS with one public IP**.

## What it does
- Pulls each project from a **private GitHub repo** (Personal Access Token, stored encrypted).
- Auto-assigns **ports** (frontend from `3100+`, backend from `8100+`, no collisions).
- Generates **Docker Compose** + Dockerfiles per project and runs them.
- Generates **Nginx** reverse-proxy vhost per **subdomain** (`app1.domain.com`), routing
  `/api` → backend container and `/` → frontend container.
- **SSL** in two modes:
  - **Let's Encrypt** (auto via certbot), or
  - **Custom certificate** — point to your existing **wildcard** cert/key paths (e.g. Sectigo).
- Per-project **MongoDB database** (`<slug>_db`) on the shared Mongo instance.
- Lifecycle controls: **deploy / start / stop / restart / delete**, live build logs,
  container logs, and server resource stats (CPU / RAM / disk).

## How it works
The panel detects host capabilities (`git`, `docker`, `docker compose`, `nginx`, `certbot`).
On this Emergent preview sandbox Docker/certbot are absent, so deploys **generate all
artifacts** (compose files, Dockerfiles, nginx vhost, `.env`) but do not start containers.
On your **real VPS** (after running `scripts/install.sh`) every step executes for real.

## Install on the VPS
```bash
sudo bash scripts/install.sh
```
Then follow the printed steps to configure `backend/.env` and run the panel.
Point a wildcard DNS record `*.yourdomain.com` to your server IP.

## Security notes
- Change `ADMIN_PASSWORD` and set a strong `JWT_SECRET` + `PANEL_ENCRYPTION_KEY` in `.env`.
- The panel needs permission to write `/etc/nginx/sites-*` and reload nginx, and access to
  the Docker socket — run it as root or a user in the `docker` group with sudo for nginx.
- GitHub tokens are encrypted at rest with Fernet (`PANEL_ENCRYPTION_KEY`).

## Default login
- Username: `admin`  ·  Password: `admin123` (change via `.env`).
