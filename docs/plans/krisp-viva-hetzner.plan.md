# Krisp VIVA on Hetzner VPS (self-hosted)

Related: [revamp-noise-cancellation-and-dev-stt.plan.md](./revamp-noise-cancellation-and-dev-stt.plan.md)

---

## Critical: two different “Krisp” products

| Product | Where it runs | Self-hosted VPS? | What it improves |
|---------|---------------|------------------|------------------|
| `@livekit/krisp-noise-filter` | **Browser** (participant device) | **No** — needs LiveKit Cloud auth (404 on sslip.io) | Audio **other humans** hear |
| **Krisp VIVA Server SDK** + `livekit-plugins-krisp` | **Linux agent** on VPS | **Yes** — on-prem with license + `.kef` models | Audio **agent/STT** hears (captions, VAD) |

**You cannot “install” the browser Krisp package on Hetzner.** The VPS already runs LiveKit SFU + Whisper agent; Krisp on VPS only applies to the **Python agent audio input path**.

To improve what **remote participants** hear under loud music, you still need either:
- LiveKit Cloud + browser Krisp, or
- Keep **RNNoise in the browser** (current), or
- Krisp **RTC SDK** embedded in your web client (separate Krisp developer contract — not `@livekit/krisp-noise-filter`)

---

## What Krisp VIVA on VPS gives you

```
Participant mic (raw, may include music)
    → LiveKit SFU (Hetzner)
    → Agent subscribes audio
    → [Krisp VIVA FrameProcessor]  ← runs on VPS
    → Whisper STT → captions
```

Benefits: cleaner captions, fewer false VAD triggers, better STT under noise.

Does **not** automatically denoise audio for other human participants (they still get the published track from the speaker’s browser).

---

## Prerequisites

1. **Krisp developer account**: https://krisp.ai/developers/
2. **License key**: `KRISP_VIVA_SDK_LICENSE_KEY` (or `KRISP_VIVA_API_KEY` per SDK version)
3. **Model file**: e.g. `krisp-viva-tel-v2.kef` → `KRISP_VIVA_FILTER_MODEL_PATH`
4. **`krisp-audio` wheel** — proprietary, **not on PyPI**; download from Krisp portal and `pip install ./krisp_audio-*.whl` on VPS
5. **VPS resources**: Your 2 GB Hetzner already runs Whisper at ~1.4 GB RAM; Krisp adds CPU + memory — consider **4 GB+** or smaller Whisper model if enabling both

---

## Hetzner deployment steps (manual)

**Do not commit credentials.** Use SSH keys, not root password in chat.

```bash
# On VPS (as root or deploy user)
ssh root@5.78.232.172

# 1. Install Krisp wheel (from portal download, scp to server)
pip install /opt/krisp/krisp_audio-*.whl

# 2. In agent venv on VPS or same machine as agent worker
cd /path/to/onework/services/livekit-agent
source .venv/bin/activate
pip install livekit-plugins-krisp>=0.1.16

# 3. Place model
mkdir -p /opt/krisp/models
# upload krisp-viva-tel-v2.kef to /opt/krisp/models/

# 4. Agent .env
KRISP_VIVA_ENABLED=true
KRISP_VIVA_SDK_LICENSE_KEY=...
KRISP_VIVA_FILTER_MODEL_PATH=/opt/krisp/models/krisp-viva-tel-v2.kef
KRISP_VIVA_NOISE_SUPPRESSION_LEVEL=100
LIVEKIT_URL=wss://5-78-232-172.sslip.io
# ... existing LIVEKIT_API_KEY, WHISPER_*, etc.

# 5. Restart agent
python agent.py start
```

---

## OneWork code integration

`services/livekit-agent/agent.py` supports optional Krisp when `KRISP_VIVA_ENABLED=true` and SDK is installed; otherwise falls back to Silero-only input (current behavior).

Env reference: `services/livekit-agent/.env.example`

---

## Testing matrix

| # | Setup | Pass |
|---|-------|------|
| K1 | Agent logs `krisp viva enabled` on join | Processor loads |
| K2 | Music + speak | Captions more accurate vs K3 |
| K3 | `KRISP_VIVA_ENABLED=false` | Same as today (Silero + Whisper) |
| K4 | Two human tabs | Remote audio unchanged (expected — client path) |

---

## Alternatives without Krisp license

| Option | Cost | Remote hears clean audio? | STT under noise? |
|--------|------|---------------------------|------------------|
| RNNoise (current browser) | Free | Moderate | Moderate |
| `livekit-plugins-dtln` on agent | Free OSS | No | Good |
| LiveKit Cloud + browser Krisp | Paid | **Best** | N/A |
| Krisp VIVA on agent | Krisp license | No | **Best** |

---

## Security note

Never paste VPS passwords in chat or commit them. Rotate credentials if exposed. Use Tailscale/SSH keys for server access.
