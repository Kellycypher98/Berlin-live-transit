#!/usr/bin/env bash
# One-time setup on a fresh AWS Lightsail instance (Ubuntu 24.04, 2 GB plan).
# Run in the instance's browser SSH:
#   curl -fsSL https://raw.githubusercontent.com/Kellycypher98/Berlin-live-transit/main/deploy/setup.sh | bash -s -- you@example.com
# Optional 2nd argument: your own domain for the API (default: <ip>.sslip.io, no domain needed).
set -euo pipefail
CONTACT="${1:?Usage: setup.sh <your-email> [api-domain]}"
REPO="https://github.com/Kellycypher98/Berlin-live-transit.git"
APP_DIR="$HOME/berlin-live"

echo "==> Swap (extra safety while the timetable is built)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR/deploy"

IP="$(curl -fsS https://checkip.amazonaws.com)"
DOMAIN="${2:-${IP//./-}.sslip.io}"

if [ ! -f .env ]; then
  echo "==> Settings (deploy/.env)"
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  cat > .env <<ENV
DOMAIN=$DOMAIN
CONTACT=$CONTACT
ADMIN_TOKEN=$ADMIN_TOKEN
ENV
  chmod 600 .env
else
  ADMIN_TOKEN="$(grep ^ADMIN_TOKEN= .env | cut -d= -f2)"
  DOMAIN="$(grep ^DOMAIN= .env | cut -d= -f2)"
fi

echo "==> Start (first build takes a few minutes)"
sudo docker compose up -d --build

cat <<DONE

Done. In a few minutes (the timetable loads first):
  API:          https://$DOMAIN/health
  Netlify:      set BACKEND_URL = https://$DOMAIN   then redeploy
  Admin token:  $ADMIN_TOKEN
                (also in ~/berlin-live/deploy/.env — keep it secret)

Logs:   cd ~/berlin-live/deploy && sudo docker compose logs -f api
Update: cd ~/berlin-live/deploy && ./update.sh
DONE
