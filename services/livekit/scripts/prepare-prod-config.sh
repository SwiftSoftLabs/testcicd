#!/usr/bin/env bash
# Render livekit.runtime.yaml + keys.yaml from .env (run before docker compose up).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVEKIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${LIVEKIT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example and fill in values." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

for var in LIVEKIT_API_KEY LIVEKIT_API_SECRET LIVEKIT_TURN_DOMAIN REDIS_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing ${var} in .env" >&2
    exit 1
  fi
done

export REDIS_PASSWORD LIVEKIT_TURN_DOMAIN

envsubst '${REDIS_PASSWORD} ${LIVEKIT_TURN_DOMAIN}' \
  < "${LIVEKIT_DIR}/livekit.yaml.template" \
  > "${LIVEKIT_DIR}/livekit.runtime.yaml"

cat > "${LIVEKIT_DIR}/keys.yaml" <<EOF
${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF
chmod 600 "${LIVEKIT_DIR}/keys.yaml"

echo "Wrote ${LIVEKIT_DIR}/livekit.runtime.yaml and keys.yaml"
