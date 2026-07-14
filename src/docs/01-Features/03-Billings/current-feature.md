# Current feature: Agora → LiveKit migration (Option B)

**Status:** `completed`  
**Phase:** 5 — Cutover complete  
**Task doc:** [migration/AGORA-TO-LIVEKIT-AGENT-TASK.md](./migration/AGORA-TO-LIVEKIT-AGENT-TASK.md)  
**Prod runbook:** [migration/livekit-prod-setup.md](./migration/livekit-prod-setup.md) (Oracle) · [migration/livekit-hetzner-setup.md](./migration/livekit-hetzner-setup.md) (Hetzner 7C–10)  
**SFU hosting comparison:** [migration/livekit-sfu-hosting-comparison.md](./migration/livekit-sfu-hosting-comparison.md)  
**STT / LLM pipeline:** [migration/livekit-stt-llm-pipeline.md](./migration/livekit-stt-llm-pipeline.md)

## Architecture (Option B — full self-host)

| Layer | Host |
| ----- | ---- |
| Next.js app | Vercel |
| DB, recordings, Gemini secrets | InsForge (`app_onework`) |
| LiveKit SFU + Redis + Python agent | Oracle Always Free VM (prod) / `livekit-server --dev` (local) |
| STT / TTS | faster-whisper + Piper (local, $0) |
| LLM | Gemini via Vercel `/api/calls/[id]/ai/llm` |

## Locked decisions

- Media: self-hosted LiveKit OSS (no LiveKit Cloud billing)
- STT: faster-whisper in Python agent
- TTS: Piper (self-hosted, optional HTTP)
- Participant identity: `user.id` UUID
- Room naming: `ow_<callIdHex>` via `roomNameForCall()`
- Recording: browser upload → InsForge `call-recordings`
- Transport: LiveKit only (Agora removed)

## Acceptance criteria (full migration)

- [x] Two users join LiveKit call with audio + video (`LiveKitCallRoom`)
- [x] Screen share, mute, device switch, background blur
- [x] Live captions via `RoomEvent.TranscriptionReceived` + agent STT
- [x] Voice assistant with Gemini webhook + Python agent
- [x] Browser recording uploads to InsForge
- [x] `pnpm build` passes with zero Agora runtime imports
- [x] Prod runbook at `migration/livekit-prod-setup.md`

## Production operations

Follow [livekit-prod-setup.md](./migration/livekit-prod-setup.md) before pointing Vercel prod at the Oracle VM.

Apply migrations in order:

1. `migrations/20260609120000_app-onework-livekit-columns.sql`
2. After backup window: `migrations/20260609120100_app-onework-drop-agora-columns.sql`

## History

| Date | Note |
| ---- | ---- |
| 2026-06-09 | Option B selected; implementation started |
| 2026-06-09 | LiveKit media + agent + Agora removal; feature complete in codebase |
