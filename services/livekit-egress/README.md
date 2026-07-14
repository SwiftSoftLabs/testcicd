# LiveKit Egress (optional)

OneWork uses **browser composite recording → InsForge `call-recordings`** as the primary path. LiveKit Egress is **not required** for the LiveKit migration MVP.

Use this only if you need server-side MP4 when browser upload fails.

## Requirements

- Redis (same instance as LiveKit server)
- `livekit/egress` Docker image
- InsForge S3-compatible credentials for upload destination

## Outline

1. Add `egress` service to `services/livekit/docker-compose.prod.yml` pointing at Redis + LiveKit URL.
2. Set `LIVEKIT_EGRESS_ENABLED=true` on Vercel when `src/lib/livekit/egress.ts` integration is enabled.
3. Store `livekit_egress_id` on `call_recordings` rows.

Egress API integration in the Next.js app is optional (TASK-402). Browser upload remains the default.
