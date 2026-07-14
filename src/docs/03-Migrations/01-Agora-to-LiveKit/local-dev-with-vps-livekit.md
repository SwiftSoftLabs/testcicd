# Local OneWork + VPS LiveKit (dev against prod media)

Run **`pnpm dev` on your Mac** while **video and live captions** use the **Hetzner VPS** (LiveKit SFU + Python agent). No local `livekit-server` or local `agent.py` required.

## Architecture

```
Mac (pnpm dev)          VPS (5.78.232.172)
─────────────          ──────────────────
Browser ──wss────────► LiveKit + Caddy
/api/calls/.../token   (same keys)
/api/calls/.../join    Redis + agent (systemd)
InsForge DB            Whisper small.en
Gemini (sidebar)       (registered worker)
```

## 1. VPS — keep running (no SSH session needed)

```bash
docker compose -f /opt/onework/livekit/docker-compose.prod.yml ps   # livekit, redis, caddy up
systemctl status onework-livekit-agent                              # active
```

Do **not** run `agent.py start` manually if systemd is active (port 8081 conflict).

## 2. Mac — `.env.local`

Copy keys from `/opt/onework/livekit/.env` on the VPS (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).

```bash
# App URL — match your dev port (3000 or 3001)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# VPS LiveKit (sslip.io hostname)
NEXT_PUBLIC_LIVEKIT_URL=wss://5-78-232-172.sslip.io
LIVEKIT_URL=https://5-78-232-172.sslip.io
LIVEKIT_API_KEY=<same as VPS>
LIVEKIT_API_SECRET=<same as VPS>
LIVEKIT_AGENT_NAME=onework-meeting-assistant

# Calls
CALL_AI_ENABLED=true
CALL_RECORDING_ENABLED=true

# Optional: match VPS agent .env if you test voice LLM webhook later
CALL_AI_LLM_WEBHOOK_SECRET=<same as VPS agent .env>

# Still required for calls DB / auth
NEXT_PUBLIC_INSFORGE_URL=...
NEXT_PUBLIC_INSFORGE_ANON_KEY=...
NEXT_PUBLIC_DB_SCHEMA=app_onework

# AI sidebar (not Whisper captions — Gemini on your Mac)
GEMINI_API_KEY=...
```

**Do not** point `NEXT_PUBLIC_LIVEKIT_URL` at `127.0.0.1:7880` when using the VPS.

## 3. Mac — start app only

```bash
pnpm dev
```

Open `http://localhost:3000` (or your port). **No** third terminal for LiveKit or agent.

## 4. Test

1. Log in, open a workspace, start a **call with AI enabled**.
2. Second browser tab (or incognito) → join same call.
3. Confirm video/audio.
4. Speak → live captions in sidebar (VPS agent + `small.en`).
5. VPS logs: `journalctl -u onework-livekit-agent -f` → `onework agent joining room=...`

## 5. Troubleshooting

| Symptom | Check |
|---------|--------|
| Token / join 500 | `LIVEKIT_API_KEY` / `SECRET` in `.env.local` match VPS |
| ICE / no video | VPS firewall UDP 50000–50100, 3478 |
| Listening… forever | `systemctl status onework-livekit-agent`; `registered worker` in logs |
| AI sidebar empty | `GEMINI_API_KEY` in `.env.local` (separate from Whisper) |
| Agent not joining | `CALL_AI_ENABLED=true`; join with AI on; `LIVEKIT_AGENT_NAME` matches |
| “Waiting for caption agent” (dispatch ok) | VPS agent down, Whisper OOM, or process init timeout — see **§6** |

## 6. “Waiting for caption agent” (dispatch created, agent not in room)

The sidebar means **your Mac created a LiveKit dispatch**, but **no agent participant joined** the room.

On the **VPS** during a call:

```bash
systemctl status onework-livekit-agent
journalctl -u onework-livekit-agent -n 50 --no-pager
```

**Healthy:** `registered worker` when idle; on join `prewarm: STT ready` then `onework agent joining room=…`.

**Common on 2 GB:**

| Log / symptom | Fix |
|---------------|-----|
| `Killed` | OOM — agent `.env`: `WHISPER_MODEL_SIZE=small.en`, `WHISPER_COMPUTE_TYPE=int8`; restart agent |
| `initialize process timed out` | Pull latest `agent.py` (sets `initialize_process_timeout=180`); `systemctl restart onework-livekit-agent` |
| No `joining room` after dispatch | Keys/`LIVEKIT_URL` in agent `.env` must match `/opt/onework/livekit/.env` |

Re-deploy agent code from Mac:

```bash
rsync -avz --exclude '.venv' --exclude '.cache' --exclude '__pycache__' \
  services/livekit-agent/ root@5.78.232.172:/opt/onework/livekit-agent/
ssh root@5.78.232.172 'systemctl restart onework-livekit-agent && journalctl -u onework-livekit-agent -n 15 --no-pager'
```

Never rsync `.venv` from your Mac — it breaks Linux systemd (`status=203/EXEC`).

Agent `.env` on VPS (2 GB):

```bash
WHISPER_MODEL_SIZE=small.en
WHISPER_COMPUTE_TYPE=int8
```

### systemd `status=203/EXEC` — `.venv/bin/python: No such file or directory`

Usually caused by **rsync copying a Mac `.venv`** to the VPS (symlink points at Homebrew Python). On the VPS:

```bash
cd /opt/onework/livekit-agent
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional: python download_whisper_model.py
systemctl restart onework-livekit-agent
journalctl -u onework-livekit-agent -n 10 --no-pager
```

Expect `registered worker`. Future rsync must use `--exclude '.venv'` (see above).

## Switch back to fully local dev

```bash
NEXT_PUBLIC_LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_URL=http://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Plus local `livekit-server --dev` and `python agent.py dev`.

## Related

- [livekit-hetzner-setup.md](./livekit-hetzner-setup.md) — VPS steps
- [livekit-stt-llm-pipeline.md](./livekit-stt-llm-pipeline.md) — Whisper vs Gemini
