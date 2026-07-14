# OneWork LiveKit (Option B — self-hosted)

Self-hosted [LiveKit](https://livekit.io) SFU for OneWork video calls. No LiveKit Cloud billing.

## Local development (no Docker)

```bash
brew install livekit
livekit-server --dev
```

Built-in dev credentials: API key `devkey`, secret `secret`, WebSocket `ws://127.0.0.1:7880`.

`.env.local`:

```bash
NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_URL=http://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_AGENT_NAME=onework-meeting-assistant
```

Terminal 2 — Next.js:

```bash
pnpm dev
```

Terminal 3 — **Python agent (required for live captions)**:

```bash
cd services/livekit-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set CALL_AI_LLM_WEBHOOK_SECRET to match .env.local
python agent.py dev
```

Without the agent running, the sidebar stays on “Listening…” — dispatch is created but no worker transcribes audio.

### Local app + VPS media (no local LiveKit/agent)

Point `.env.local` at your VPS (`wss://YOUR-IP-DASHES.sslip.io`) and run only `pnpm dev`. See [local-dev-with-vps-livekit.md](../../docs/internal/migration/local-dev-with-vps-livekit.md).

## Smoke test

1. Open [example.livekit.io](https://example.livekit.io).
2. Use custom URL `ws://127.0.0.1:7880` with `devkey` / `secret`.
3. Join a call from OneWork (two browser tabs).

## Production

| Runbook | When |
|---------|------|
| [livekit-hetzner-setup.md](../../docs/internal/migration/livekit-hetzner-setup.md) | **Hetzner VPS** (steps 7C–10, sslip.io / DuckDNS) |
| [livekit-prod-setup.md](../../docs/internal/migration/livekit-prod-setup.md) | Oracle Always Free VM |

Copy `services/livekit/.env.example` → `.env` on the VPS. TURN certs: `sudo ./scripts/setup-turn-certs.sh YOUR_HOSTNAME you@email.com`.

## Generate production API keys

On the VM (or one-off container):

```bash
docker run --rm livekit/livekit-server generate-keys
```

Store `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in InsForge secrets and Vercel — never commit them.
