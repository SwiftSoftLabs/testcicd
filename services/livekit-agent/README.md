# OneWork LiveKit Python Agent

Self-hosted meeting assistant for Option B (no LiveKit Cloud billing).

| Capability | Implementation |
|------------|----------------|
| STT / live captions | faster-whisper `distil-large-v3` (local, tunable) |
| LLM (optional) | Gemini via `POST /api/calls/{id}/ai/llm` when `CALL_AI_VOICE_ASSISTANT=true` |
| TTS | Piper HTTP (optional; wire `PIPER_BASE_URL` when deployed) |
| VAD | Silero (livekit-plugins-silero) |

## Prerequisites

- LiveKit server running (`livekit-server --dev` locally or VM compose in prod)
- Redis required in production for agent dispatch at scale
- `CALL_AI_LLM_WEBHOOK_SECRET` set on Vercel **and** in agent env

## Local development

```bash
cd services/livekit-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — match LIVEKIT_* with services/livekit/README.md dev keys

python agent.py dev
```

In another terminal:

```bash
livekit-server --dev
```

Start a call with AI enabled in OneWork; the first join dispatches this agent.

**Captions not appearing?** All three must be running:

1. `livekit-server --dev`
2. `pnpm dev` (OneWork app)
3. `python agent.py dev` (this agent)

Check the agent terminal for `onework agent joining room=…` and `caption [en]: …` after you speak.
The sidebar shows a warning until the agent participant joins the room.

### STT accuracy

Default model is **`distil-large-v3`** (much more accurate than `base.en`). Weights are cached under
`services/livekit-agent/.cache/whisper/` (gitignored).

Pre-download before your first call (optional — `agent.py` also downloads on first STT load):

```bash
cd services/livekit-agent
source .venv/bin/activate
python download_whisper_model.py
```

Override model or cache path via `.env` (`WHISPER_MODEL_SIZE`, `WHISPER_DOWNLOAD_ROOT`).

For maximum accuracy on a powerful machine (or CUDA GPU):

```bash
WHISPER_MODEL_SIZE=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
WHISPER_BEAM_SIZE=8
```

Restart `python agent.py dev` after changing `.env`. Larger models are slower but more precise.

## Production

Deploy on the same VPS as `services/livekit/docker-compose.prod.yml`.

```bash
cp onework-livekit-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now onework-livekit-agent
```

| Runbook | When |
|---------|------|
| [livekit-hetzner-setup.md](../../docs/internal/migration/livekit-hetzner-setup.md) | Hetzner (steps 8–10) |
| [livekit-prod-setup.md](../../docs/internal/migration/livekit-prod-setup.md) | Oracle VM |

STT vs LLM: [livekit-stt-llm-pipeline.md](../../docs/internal/migration/livekit-stt-llm-pipeline.md).

## Agent name

Must match `LIVEKIT_AGENT_NAME` in Vercel (default `onework-meeting-assistant`).
