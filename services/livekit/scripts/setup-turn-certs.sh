#!/usr/bin/env bash
# Obtain Let's Encrypt certs for LiveKit TURN and copy to ./certs/
# Usage: sudo ./scripts/setup-turn-certs.sh YOUR_HOSTNAME you@email.com
set -euo pipefail

DOMAIN="${1:?Usage: $0 DOMAIN EMAIL}"
EMAIL="${2:?Usage: $0 DOMAIN EMAIL}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVEKIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CERTS_DIR="${LIVEKIT_DIR}/certs"

cd "${LIVEKIT_DIR}"

if docker compose -f docker-compose.prod.yml ps --status running 2>/dev/null | grep -q caddy; then
  echo "Stopping Caddy so certbot can bind port 80..."
  docker compose -f docker-compose.prod.yml stop caddy
  RESTART_CADDY=1
else
  RESTART_CADDY=0
fi

mkdir -p "${CERTS_DIR}"

certbot certonly --standalone \
  -d "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  -m "${EMAIL}"

cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${CERTS_DIR}/turn.crt"
cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${CERTS_DIR}/turn.key"
chmod 644 "${CERTS_DIR}/turn.crt"
chmod 600 "${CERTS_DIR}/turn.key"

echo "TURN certs installed in ${CERTS_DIR}"

if [[ "${RESTART_CADDY}" -eq 1 ]]; then
  docker compose -f docker-compose.prod.yml start caddy
fi
