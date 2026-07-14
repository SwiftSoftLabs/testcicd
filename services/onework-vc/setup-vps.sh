#!/usr/bin/env bash
# OneWork Version Control — VPS bootstrap (run on Hetzner as root)
set -euo pipefail

INSTALL_DIR="/opt/onework-vc"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Docker if missing..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> Preparing ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}/data" "${INSTALL_DIR}/config"
cp "${SCRIPT_DIR}/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
# Rootless Gitea image runs as UID/GID 1000
chown -R 1000:1000 "${INSTALL_DIR}/data" "${INSTALL_DIR}/config"

echo "==> Starting OneWork VC engine..."
cd "${INSTALL_DIR}"
docker compose pull
docker compose up -d

echo "==> Configuring firewall (ufw)..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp comment 'SSH' || true
  ufw allow 3001/tcp comment 'OneWork VC HTTP' || true
  ufw allow 2222/tcp comment 'OneWork VC Git SSH' || true
fi

echo ""
echo "OneWork Version Control engine is starting."
echo "  HTTP API/UI: http://5.78.232.172:3001"
echo "  Git SSH:     git@5.78.232.172:2222"
echo ""
echo "Next steps:"
echo "  1. Open http://5.78.232.172:3001 and complete first-run setup (create admin user)."
echo "  2. Settings → Applications → Generate New Token (admin, all scopes)."
echo "  3. Set ONEWORK_VC_ADMIN_TOKEN, ONEWORK_VC_ADMIN_PASSWORD, and ONEWORK_VC_GITEA_URL in OneWork app env."
echo "  4. Confirm: curl -H \"Authorization: token <TOKEN>\" http://5.78.232.172:3001/api/v1/version"
