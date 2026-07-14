# LiveKit on Hetzner VPS (steps 7C–10)

Continue here after **Part 7B** (`.env` created on the VPS). Assumes:

- Server at `/opt/onework/livekit` and `/opt/onework/livekit-agent`
- **No company DNS** — use **sslip.io** or **DuckDNS** (see [hosting comparison](./livekit-sfu-hosting-comparison.md))
- Example hostname: `5-78-232-172.sslip.io` (replace with `YOUR-IP-WITH-DASHES.sslip.io`)

Parts 1–7B: create server, firewall, SSH, copy files, generate keys, Caddyfile + `.env` — same as Oracle runbook with Hetzner instead of Oracle.

---

## 7C — Redis fix (already in repo)

`livekit-server` uses **host networking**. Redis must be on **`127.0.0.1:6379`** with a password.

**Re-sync from your Mac** after pulling latest repo changes:

```bash
cd /Users/sayudhalw/Code/04-SwiftSoftLabs-Projects/01-OneWork
rsync -avz services/livekit/ root@YOUR_SERVER_IP:/opt/onework/livekit/
```

On the VPS, confirm `livekit.yaml` contains:

```yaml
redis:
  address: 127.0.0.1:6379
  password: ${REDIS_PASSWORD}
```

And `docker-compose.prod.yml` publishes Redis:

```yaml
ports:
  - "127.0.0.1:6379:6379"
```

Your `/opt/onework/livekit/.env` must still have `REDIS_PASSWORD=...` (from step 7B).

---

## 7D — TURN TLS certificates

LiveKit TURN needs `certs/turn.crt` and `certs/turn.key`.

On the **VPS**:

```bash
apt install -y certbot
cd /opt/onework/livekit
chmod +x scripts/setup-turn-certs.sh
sudo ./scripts/setup-turn-certs.sh 5-78-232-172.sslip.io you@email.com
```

Replace hostname and email. If Caddy was running, the script stops it briefly for certbot.

Verify:

```bash
ls -la /opt/onework/livekit/certs/
```

---

## 7E — Render config and start LiveKit + Redis + Caddy

LiveKit does **not** expand `${VAR}` in `livekit.yaml` for API keys. Run the prepare script first:

```bash
cd /opt/onework/livekit
apt install -y gettext-base   # provides envsubst
chmod +x scripts/prepare-prod-config.sh scripts/setup-turn-certs.sh
./scripts/prepare-prod-config.sh
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Test LiveKit **on the server** (public URL may fail from inside the VPS):

```bash
curl -I http://127.0.0.1:7880
```

All three services should be **running**.

HTTPS check:

```bash
curl -I https://5-78-232-172.sslip.io
```

Logs if something fails:

```bash
docker compose -f docker-compose.prod.yml logs -f livekit
docker compose -f docker-compose.prod.yml logs -f caddy
```

---

## 8 — Python agent + Whisper (`distil-large-v3`)

Re-sync agent from Mac if needed:

```bash
rsync -avz --exclude '.venv' --exclude '.cache' --exclude '__pycache__' \
  services/livekit-agent/ root@YOUR_SERVER_IP:/opt/onework/livekit-agent/
```

On the **VPS**:

```bash
cd /opt/onework/livekit-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env
```

### Agent `.env` (production)

```bash
LIVEKIT_URL=wss://5-78-232-172.sslip.io
LIVEKIT_API_KEY=<same as /opt/onework/livekit/.env>
LIVEKIT_API_SECRET=<same as /opt/onework/livekit/.env>
LIVEKIT_AGENT_NAME=onework-meeting-assistant

NEXT_PUBLIC_APP_URL=https://your-onework-app.vercel.app
CALL_AI_LLM_WEBHOOK_SECRET=<openssl rand -hex 32 — same value on Vercel>

WHISPER_MODEL_SIZE=distil-large-v3
WHISPER_LANGUAGE=en
WHISPER_DEVICE=auto
```

Pre-download Whisper weights (recommended — first call otherwise waits minutes):

```bash
source .venv/bin/activate
python download_whisper_model.py
```

### Systemd (agent always on)

```bash
cp /opt/onework/livekit-agent/onework-livekit-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now onework-livekit-agent
journalctl -u onework-livekit-agent -f
```

When a call starts with AI enabled, expect logs like:

- `onework agent joining room=...`
- `caption [en]: ...` after speech

---

## 9 — Vercel environment variables

Vercel → OneWork project → **Settings → Environment Variables** (Production):

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_LIVEKIT_URL` | `wss://5-78-232-172.sslip.io` |
| `LIVEKIT_URL` | `https://5-78-232-172.sslip.io` |
| `LIVEKIT_API_KEY` | from `generate-keys` |
| `LIVEKIT_API_SECRET` | from `generate-keys` |
| `LIVEKIT_AGENT_NAME` | `onework-meeting-assistant` |
| `CALL_AI_LLM_WEBHOOK_SECRET` | same as agent `.env` |
| `CALL_AI_ENABLED` | `true` |
| `CALL_RECORDING_ENABLED` | `true` |
| `GEMINI_API_KEY` | existing Gemini key |

**Redeploy** Vercel after saving.

Optional InsForge secrets (if you use CLI secrets for server-side):

```bash
npx @insforge/cli secrets add LIVEKIT_API_KEY <key>
npx @insforge/cli secrets add LIVEKIT_API_SECRET <secret>
```

---

## 10 — Smoke tests

### 10.1 LiveKit connectivity

1. Open [example.livekit.io](https://example.livekit.io)
2. Custom URL: `wss://5-78-232-172.sslip.io`
3. API key + secret from step 6
4. Should connect and show local preview

### 10.2 OneWork call

1. Open deployed Vercel app (after redeploy)
2. Start a call with **AI enabled**
3. Second browser/tab → join same call
4. Confirm audio/video
5. Speak → **live captions** in sidebar (agent + Whisper)

### 10.3 Checklist

- [ ] `curl -I https://YOUR_HOSTNAME` returns HTTPS
- [ ] `docker compose ps` — redis, livekit, caddy up
- [ ] `systemctl status onework-livekit-agent` — active
- [ ] Agent logs show room join on call start
- [ ] Vercel env uses `wss://` URL (not `ws://` IP)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| ICE failed | Hetzner firewall: UDP **50000–50100**, UDP **3478**, TCP **7880/7881** |
| Caddy/cert errors | Port 80 open; hostname resolves (`dig +short YOUR_HOSTNAME`) |
| **HTTPS 502** but `curl 127.0.0.1:7880` works | Caddy must proxy `host.docker.internal:7880` (not `localhost`) — see `Caddyfile` + `extra_hosts` in compose |
| **HTTPS 502** and :7880 fails | Run `prepare-prod-config.sh`; check `docker compose logs livekit`; ensure `certs/turn.crt` exists |
| `curl https://…` fails **on the VPS** | Normal on some hosts — use `curl http://127.0.0.1:7880` locally; test HTTPS from your Mac |
| Agent not joining | Redis up; `LIVEKIT_AGENT_NAME` matches Vercel; check `journalctl -u onework-livekit-agent` |
| Captions stuck on Listening | Agent not running; Whisper still downloading — run `download_whisper_model.py` |
| Token 500 | Wrong `LIVEKIT_API_KEY` / `SECRET` on Vercel |
| LLM sidebar errors | `GEMINI_API_KEY` on Vercel (separate from Whisper) |

---

## Operations

```bash
# Restart SFU stack
cd /opt/onework/livekit && docker compose -f docker-compose.prod.yml restart

# Agent logs
journalctl -u onework-livekit-agent -f

# LiveKit logs
docker compose -f docker-compose.prod.yml logs -f livekit
```

---

## Related docs

| Doc | Topic |
|-----|--------|
| [livekit-sfu-hosting-comparison.md](./livekit-sfu-hosting-comparison.md) | VPS sizing, costs |
| [livekit-stt-llm-pipeline.md](./livekit-stt-llm-pipeline.md) | Whisper vs Gemini |
| [livekit-prod-setup.md](./livekit-prod-setup.md) | Oracle variant (same stack) |
