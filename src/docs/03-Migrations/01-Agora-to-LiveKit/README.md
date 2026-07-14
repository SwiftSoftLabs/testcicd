# Calls module migrations

Internal research and runbooks for changing the OneWork video calls stack.

| Document | Description |
|----------|-------------|
| [agora-to-livekit.md](./agora-to-livekit.md) | Deep research: migrate Agora RTC, STT, and conversational AI to a self-hosted LiveKit stack (including self-hosted Piper TTS). |
| [AGORA-TO-LIVEKIT-AGENT-TASK.md](./AGORA-TO-LIVEKIT-AGENT-TASK.md) | Cursor agent implementation tasks: phased checklist with acceptance criteria, file paths, and branch names. |
| [livekit-prod-setup.md](./livekit-prod-setup.md) | Step-by-step production prep: Oracle VM, TLS, env vars, smoke tests, cutover. |
| [livekit-hetzner-setup.md](./livekit-hetzner-setup.md) | Hetzner VPS steps 7C–10: Redis fix, certs, agent, Vercel env, smoke tests (sslip.io / no company DNS). |
| [local-dev-with-vps-livekit.md](./local-dev-with-vps-livekit.md) | `pnpm dev` on Mac + LiveKit/agent on VPS (test before Vercel). |
| [livekit-sfu-hosting-comparison.md](./livekit-sfu-hosting-comparison.md) | What an SFU is, VPS sizing vs LiveKit Cloud Build, and scaling cost comparison. |
| [livekit-stt-llm-pipeline.md](./livekit-stt-llm-pipeline.md) | Whisper `distil-large-v3` (local → prod), STT vs Gemini LLM, and how they connect. |
| [../current-feature.md](../current-feature.md) | Active feature status and locked decisions. |

**App context:** OneWork (`app_onework`), InsForge shared cluster per `SWIFT_LABS_MANIFEST.md`.
