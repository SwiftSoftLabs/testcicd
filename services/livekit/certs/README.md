# TURN TLS certificates

LiveKit embedded TURN reads `turn.crt` and `turn.key` from this directory (mounted at `/turn.crt` and `/turn.key` in the container).

Obtain certs on the VPS:

```bash
cd /opt/onework/livekit
chmod +x scripts/setup-turn-certs.sh
sudo ./scripts/setup-turn-certs.sh 5-78-232-172.sslip.io you@email.com
```

Replace the hostname with your Caddyfile / `LIVEKIT_TURN_DOMAIN` value.

Do not commit real certificate files.
