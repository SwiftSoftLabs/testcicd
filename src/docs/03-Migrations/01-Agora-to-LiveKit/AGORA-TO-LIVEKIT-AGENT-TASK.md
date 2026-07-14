# Agora → LiveKit: Cursor Agent Implementation Tasks

**Feature:** Migrate OneWork calls module from Agora to self-hosted LiveKit  
**Schema:** `app_onework`  
**Research:** [agora-to-livekit.md](./agora-to-livekit.md)  
**Branch prefix:** `feature/livekit-*` or `fix/livekit-*`  
**Package manager:** `pnpm` only  

---

## How to use this document

1. Work **one task at a time** in task-ID order unless dependencies allow parallel work.
2. Create a **new branch** per task (or per phase if tasks are small).
3. Run `pnpm build` before asking to commit.
4. Do **not** commit unless the user explicitly requests it.
5. Mark tasks complete in the **Progress** section at the bottom when finished.
6. Reference this file in chat: `@docs/internal/migration/AGORA-TO-LIVEKIT-AGENT-TASK.md`

---

## Locked decisions (do not re-debate)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent runtime | **Python** (`livekit/agents`) | Best self-hosted STT/TTS plugin support (Piper, faster-whisper) |
| Agent topology | **Single combined agent** | Voice assistant + live captions in one worker |
| Participant identity | **`user.id` UUID string** | Direct DB join; no numeric UID hashing |
| Room naming | Keep `ow_<callIdHex>` | Reuse `channelNameForCall` logic; rename to `roomNameForCall` |
| LLM | **Gemini** via existing logic | Port from `/api/calls/[id]/ai/llm`; keep route during transition |
| TTS | **Piper** (self-hosted) | No LiveKit Inference / no paid TTS |
| STT | **faster-whisper** (local) | No Agora STT / no paid Deepgram for captions |
| Transport cutover | **`CALL_TRANSPORT` env flag** | `livekit` \| `agora`; default `agora` until Phase 5 |
| Server-side recording | **Phase 4 (optional)** | Keep browser `MeetingCompositeRecorder` for Phases 1–3 |
| Recording primary path | Browser upload unchanged in Phases 1–3 | Minimize scope |

---

## Prerequisites (human / infra — before TASK-101)

These are **not** app-code tasks. A human or infra agent must complete them before backend/frontend LiveKit integration.

| Step | Action |
|------|--------|
| P-1 | Provision host with UDP `50000–60000`, TCP `7880`, TURN `3478/443` |
| P-2 | Deploy LiveKit server with TLS + embedded TURN |
| P-3 | Deploy Redis (required for agents at scale; required for Egress in Phase 4) |
| P-4 | Create `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`; add to staging secrets |
| P-5 | Confirm `NEXT_PUBLIC_LIVEKIT_URL` (WSS) reachable from dev machines |
| P-6 | Smoke test: connect [example.livekit.io](https://example.livekit.io) custom URL to staging server |

**Gate:** TASK-101+ assumes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `NEXT_PUBLIC_LIVEKIT_URL` exist in `.env.local` for development.

---

## Phase 0 — Project setup & feature doc

### TASK-001 — Feature doc & branch scaffold

**Branch:** `feature/livekit-migration-setup`  
**Depends on:** —  
**Files:**
- `docs/internal/current-feature.md` (create)
- `docs/internal/migration/README.md` (update link)

**Steps:**
1. Create `docs/internal/current-feature.md` summarizing scope, locked decisions, and active phase.
2. Link to research + this task doc from `docs/internal/migration/README.md`.
3. Document acceptance criteria for the full migration (see below).

**Acceptance criteria:**
- [ ] `current-feature.md` exists with status `in_progress` and phase pointer.
- [ ] README links to research + agent task doc.

---

### TASK-002 — Database migration (LiveKit columns)

**Branch:** `feature/livekit-db-migration`  
**Depends on:** TASK-001  
**Files:**
- `migrations/YYYYMMDD_livekit_calls_columns.sql` (new)
- `sql/calls_migration.sql` (comment only: superseded by migrations/)

**SQL (minimum):**
```sql
ALTER TABLE app_onework.call_sessions
  ADD COLUMN IF NOT EXISTS livekit_room_name TEXT,
  ADD COLUMN IF NOT EXISTS livekit_agent_dispatch_id TEXT;

ALTER TABLE app_onework.call_participants
  ADD COLUMN IF NOT EXISTS livekit_identity TEXT;

ALTER TABLE app_onework.call_recordings
  ADD COLUMN IF NOT EXISTS livekit_egress_id TEXT;
```

**Steps:**
1. Add migration file under `migrations/` using schema `app_onework`.
2. Include backfill: `livekit_room_name = agora_channel_name` where present.
3. Do **not** drop Agora columns yet.

**Acceptance criteria:**
- [ ] Migration is idempotent (`IF NOT EXISTS`).
- [ ] Document in `current-feature.md` that SQL must be run manually in InsForge dashboard (per existing `calls_migration.sql` pattern).

---

### TASK-003 — Environment template & transport flag

**Branch:** `feature/livekit-env-flags`  
**Depends on:** TASK-001  
**Files:**
- `.env.example`
- `src/lib/calls/constants.ts`
- `src/types/calls.ts`

**Steps:**
1. Add to `.env.example`:
   - `CALL_TRANSPORT=agora` (default)
   - `NEXT_PUBLIC_LIVEKIT_URL=`
   - `LIVEKIT_URL=`
   - `LIVEKIT_API_KEY=`
   - `LIVEKIT_API_SECRET=`
   - `LIVEKIT_AGENT_NAME=onework-meeting-assistant`
   - `CALL_AI_LLM_WEBHOOK_SECRET=` (document as replacement for `AGORA_LLM_WEBHOOK_SECRET`)
2. Add `isLiveKitTransport()`, `roomNameForCall()` (alias or rename from `channelNameForCall`).
3. Extend `CallSessionRow` / API types with optional `livekit_room_name`, `livekit_agent_dispatch_id`, `livekit_identity`.
4. Add `TranscriptSegment.participant_identity?: string | null` (keep `agora_uid` for transition).

**Acceptance criteria:**
- [ ] `CALL_TRANSPORT=livekit` can be set without breaking Agora default path.
- [ ] `pnpm build` passes.

---

## Phase 1 — LiveKit media (MVP)

### TASK-101 — LiveKit server SDK & token builder

**Branch:** `feature/livekit-token-api`  
**Depends on:** TASK-003, Prerequisites P-1–P-6  
**Files:**
- `package.json` — add `livekit-server-sdk`
- `src/lib/livekit/token.ts` (new)
- `src/lib/livekit/config.ts` (new) — env helpers
- `src/app/api/calls/[id]/token/route.ts`

**Steps:**
1. `pnpm add livekit-server-sdk`
2. Implement `buildLiveKitToken({ roomName, identity, name, metadata? })` using `AccessToken` + `VideoGrants`.
3. Update token route:
   - If `CALL_TRANSPORT=livekit`: return `{ token, url, room, identity }`.
   - Else: keep existing Agora response unchanged.
4. On token issue, set `livekit_room_name` and `call_participants.livekit_identity` in DB (mirror Agora channel/uid update).

**Acceptance criteria:**
- [ ] `POST /api/calls/:id/token` returns LiveKit JWT when `CALL_TRANSPORT=livekit`.
- [ ] Room name uses `ow_<callIdHex>` format.
- [ ] Identity equals `user.id`.
- [ ] Agora path still works when `CALL_TRANSPORT=agora`.
- [ ] `pnpm build` passes.

---

### TASK-102 — API client: LiveKit token shape

**Branch:** `feature/livekit-api-client`  
**Depends on:** TASK-101  
**Files:**
- `src/lib/api.ts` (calls.token response type)

**Steps:**
1. Extend `api.calls.token()` return type to include optional `url` and `identity` for LiveKit.
2. Ensure callers handle both Agora and LiveKit shapes.

**Acceptance criteria:**
- [ ] TypeScript discriminates or uses optional fields without `any`.
- [ ] `pnpm build` passes.

---

### TASK-103 — LiveKit dependencies & room shell

**Branch:** `feature/livekit-call-room-shell`  
**Depends on:** TASK-102  
**Files:**
- `package.json` — add `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`
- `src/components/calls/LiveKitCallRoom.tsx` (new)
- `src/components/calls/CallTransport.tsx` (new) — picks Agora vs LiveKit by `CALL_TRANSPORT`

**Steps:**
1. Install frontend LiveKit packages.
2. Create `LiveKitCallRoom` minimal shell:
   - `LiveKitRoom` with `serverUrl`, `token`, `connect`
   - Connect on mount; disconnect on unmount
   - Publish mic + camera from `joinConfig`
   - Render local + remote video tiles (basic grid)
   - Leave call → existing leave API
3. Create `CallTransport` wrapper used by `ActiveCallShell` / room page.

**Acceptance criteria:**
- [ ] Two users can join same call with `CALL_TRANSPORT=livekit` and see/hear each other.
- [ ] Leave disconnects cleanly.
- [ ] Agora `CallRoom` still used when `CALL_TRANSPORT=agora`.
- [ ] `pnpm build` passes.

---

### TASK-104 — Screen share (LiveKit)

**Branch:** `feature/livekit-screen-share`  
**Depends on:** TASK-103  
**Files:**
- `src/components/calls/LiveKitCallRoom.tsx`

**Steps:**
1. Add screen share toggle using `localParticipant.setScreenShareEnabled`.
2. Pin or focus screen share track in layout (match existing Agora presenter behavior at minimum).

**Acceptance criteria:**
- [ ] Host can share screen; remote participant sees screen track.
- [ ] Stopping share restores camera grid.

---

### TASK-105 — Device switching & mute (LiveKit)

**Branch:** `feature/livekit-media-controls`  
**Depends on:** TASK-103  
**Files:**
- `src/components/calls/LiveKitCallRoom.tsx`
- `src/lib/calls/microphoneAudioConfig.ts` (decouple from Agora-only APIs where needed)

**Steps:**
1. Wire mic/camera mute to LiveKit `localParticipant` track APIs.
2. Support device change (mic/camera) via `livekit-client` device APIs.
3. Use standard `getUserMedia` constraints for noise suppression (drop Agora AINS requirement on LiveKit path).

**Acceptance criteria:**
- [ ] Mute/unmute mic and camera work.
- [ ] Device switch works without full room reconnect.

---

### TASK-106 — Background blur (LiveKit path)

**Branch:** `feature/livekit-background-blur`  
**Depends on:** TASK-103  
**Files:**
- `src/lib/calls/backgroundBlur/createBackgroundBlurProcessor.ts`
- `src/components/calls/LiveKitCallRoom.tsx`

**Steps:**
1. Replace Agora `ICameraVideoTrack` types with a transport-agnostic interface (`MediaStreamTrack` or thin wrapper).
2. Apply blur processor output as custom `LocalVideoTrack` or processor pipeline compatible with LiveKit publish.

**Acceptance criteria:**
- [ ] Background blur works on LiveKit path when enabled in pre-join.
- [ ] Agora path still works.

---

### TASK-107 — Reconnection & rtc holder (LiveKit)

**Branch:** `feature/livekit-reconnect`  
**Depends on:** TASK-103  
**Files:**
- `src/lib/calls/rtcHolder.ts`
- `src/components/calls/LiveKitCallRoom.tsx`

**Steps:**
1. Add LiveKit branch in `rtcHolder` (room name, token refresh strategy).
2. Handle `RoomEvent.Reconnecting` / `Reconnected` / `Disconnected`.
3. Integrate with existing minimize/expand shell (`ActiveCallShell`).

**Acceptance criteria:**
- [ ] Brief network drop recovers without full page reload.
- [ ] Minimize/expand preserves session where possible.

---

### TASK-108 — Browser recording on LiveKit path

**Branch:** `feature/livekit-local-recording`  
**Depends on:** TASK-104, TASK-105  
**Files:**
- `src/lib/calls/localRecording.ts`
- `src/components/calls/LiveKitCallRoom.tsx`

**Steps:**
1. Feed `MeetingCompositeRecorder` from LiveKit `MediaStreamTrack` instances (local + remotes).
2. Keep upload flow via `/api/calls/[id]/recording/upload` unchanged.
3. Host-only recording start/stop parity with Agora path.

**Acceptance criteria:**
- [ ] Host with recording enabled produces uploadable WebM after leave.
- [ ] Post-call processing still triggers.

---

### TASK-109 — Parity pass: CallRoom features checklist

**Branch:** `feature/livekit-callroom-parity`  
**Depends on:** TASK-104–108  
**Files:**
- `src/components/calls/LiveKitCallRoom.tsx`
- `src/components/calls/CallAiSidebar.tsx` (read-only integration stubs if needed)
- `src/app/(dashboard)/calls/[id]/room/page.tsx`

**Steps:**
1. Compare Agora `CallRoom` features vs LiveKit implementation.
2. Port remaining UX: participant count, host controls, layout modes (`full` / minimized), fullscreen.
3. Document intentional gaps in `current-feature.md`.

**Acceptance criteria:**
- [ ] Group call UX is usable for internal dogfood on staging.
- [ ] Feature gap list documented.
- [ ] `pnpm build` passes.

---

## Phase 2 — Live transcription

### TASK-201 — Python agent service scaffold

**Branch:** `feature/livekit-agent-service`  
**Depends on:** Prerequisites, TASK-003  
**Files:**
- `services/livekit-agent/` (new directory)
  - `pyproject.toml` or `requirements.txt`
  - `agent.py` — entrypoint
  - `Dockerfile`
  - `README.md`
  - `.env.example`

**Steps:**
1. Create Python project with `livekit-agents`, `livekit-plugins-silero`, `faster-whisper` (or `local-livekit-plugins`).
2. `agent_name = "onework-meeting-assistant"`.
3. Entrypoint: `cli.run_app` with dev/start modes.
4. Document env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GEMINI_API_KEY`, `PIPER_MODEL_PATH`.
5. Dockerfile for deployment on same host as LiveKit.

**Acceptance criteria:**
- [ ] `python agent.py dev` connects to staging LiveKit and registers worker.
- [ ] README has run/deploy instructions.

---

### TASK-202 — STT-only pipeline in agent (captions)

**Branch:** `feature/livekit-agent-stt`  
**Depends on:** TASK-201  
**Files:**
- `services/livekit-agent/agent.py`
- `services/livekit-agent/transcription.py` (new)

**Steps:**
1. Implement agent job handler that joins room and runs **faster-whisper** STT on participant audio.
2. Publish transcriptions to room via LiveKit transcription APIs (`lk.transcription` stream).
3. Do not enable TTS/LLM yet — STT validation only.

**Acceptance criteria:**
- [ ] Dispatched agent joins room and publishes transcription segments.
- [ ] Segments include `participant_identity` mapping to human participants.

---

### TASK-203 — Agent dispatch from Next.js

**Branch:** `feature/livekit-agent-dispatch`  
**Depends on:** TASK-101, TASK-202  
**Files:**
- `src/lib/livekit/agentDispatch.ts` (new)
- `src/lib/calls/lifecycle.ts`
- `src/app/api/calls/[id]/join/route.ts`

**Steps:**
1. Implement `startLiveKitAgent(call)` using `AgentDispatchClient.createDispatch(room, agentName, metadata)`.
2. Store `livekit_agent_dispatch_id` in `call_sessions` + metadata.
3. When `CALL_TRANSPORT=livekit` and `call.ai_enabled`: call LiveKit dispatch instead of `maybeStartAgent` / `maybeStartStt`.
4. On call end: delete/stop dispatch (best-effort).

**Acceptance criteria:**
- [ ] First join to live call dispatches agent once.
- [ ] `agora_agent_id` path untouched when `CALL_TRANSPORT=agora`.

---

### TASK-204 — Frontend: subscribe to `lk.transcription`

**Branch:** `feature/livekit-live-captions`  
**Depends on:** TASK-203, TASK-103  
**Files:**
- `src/components/calls/LiveKitCallRoom.tsx`
- `src/lib/calls/transcriptSegments.ts`
- `src/lib/calls/localCallSession.ts` (if needed)
- Remove usage of `decodeSttStreamMessage` on LiveKit path

**Steps:**
1. Register text stream handler for topic `lk.transcription`.
2. Map `participantIdentity` → `user_id` for segment storage.
3. Feed existing live transcript pipeline (`appendLocalSegment`, `/live` poll, InsForge realtime).
4. Update `TranscriptSegment` to set `participant_identity`; stop writing `agora_uid` on LiveKit path.

**Acceptance criteria:**
- [ ] Host sees live captions in `CallAiSidebar` on LiveKit path.
- [ ] Final segments persist to DB on flush/end.
- [ ] Agora `stream-message` path still works when `CALL_TRANSPORT=agora`.

---

### TASK-205 — Remove Agora STT from LiveKit path

**Branch:** `feature/livekit-drop-agora-stt`  
**Depends on:** TASK-204  
**Files:**
- `src/lib/calls/lifecycle.ts`
- `src/lib/agora/realtimeStt.ts` (guard or deprecate)

**Steps:**
1. Skip `maybeStartStt` entirely when `CALL_TRANSPORT=livekit`.
2. Update `CallLivePayload` / processing to use LiveKit metadata keys.
3. Do not delete `realtimeStt.ts` until Phase 5.

**Acceptance criteria:**
- [ ] No Agora STT API calls when `CALL_TRANSPORT=livekit`.
- [ ] Live captions still work via agent.

---

## Phase 3 — Voice meeting assistant

### TASK-301 — Gemini LLM in Python agent

**Branch:** `feature/livekit-agent-llm`  
**Depends on:** TASK-202  
**Files:**
- `services/livekit-agent/llm.py` (new)
- `services/livekit-agent/agent.py`
- Optional: `src/app/api/calls/[id]/ai/llm/route.ts` (shared secret rename)

**Steps:**
1. Port meeting assistant system prompt from `src/lib/agora/agentConfig.ts`.
2. Call Gemini with workspace context:
   - **Preferred:** HTTP call to existing Next.js route with `CALL_AI_LLM_WEBHOOK_SECRET` (faster to ship).
   - **Or:** Direct `google-genai` in agent with duplicated context loader (more work).
3. Support tool/action-item format expected by sidebar (`ACTION_ITEM:` lines).

**Acceptance criteria:**
- [ ] Agent responds with voice-appropriate concise answers.
- [ ] Workspace context included (same quality as Agora webhook path).

---

### TASK-302 — Piper TTS in agent

**Branch:** `feature/livekit-agent-tts`  
**Depends on:** TASK-301  
**Files:**
- `services/livekit-agent/tts.py` or use `livekit-plugins-piper-tts`
- `services/livekit-agent/Dockerfile` — include Piper model download or volume mount

**Steps:**
1. Integrate Piper via `livekit-plugins-piper-tts` (HTTP) or `local-livekit-plugins` (in-process).
2. Default voice: `en_US-lessac-medium` or similar high-quality English model.
3. Make model path configurable via `PIPER_MODEL_PATH` / `PIPER_BASE_URL`.

**Acceptance criteria:**
- [ ] Agent speaks responses in room as audio track.
- [ ] No paid TTS API keys required.

---

### TASK-303 — Full AgentSession pipeline

**Branch:** `feature/livekit-agent-voice-pipeline`  
**Depends on:** TASK-302, TASK-203  
**Files:**
- `services/livekit-agent/agent.py`

**Steps:**
1. Wire `AgentSession(stt=..., llm=..., tts=..., vad=silero.VAD.load())`.
2. Enable turn detection (Silero VAD minimum; optional multilingual turn detector).
3. Greeting message aligned with Agora `greeting_message` in `agentConfig.ts`.
4. Combine STT captions + voice responses in one agent (retire STT-only mode from TASK-202).

**Acceptance criteria:**
- [ ] Participants can speak to assistant and hear spoken reply.
- [ ] Live captions continue during assistant operation.
- [ ] Agent hidden from main video grid (filter `ParticipantKind.AGENT` or metadata).

---

### TASK-304 — Frontend: AI assistant UX on LiveKit path

**Branch:** `feature/livekit-ai-assistant-ux`  
**Depends on:** TASK-303, TASK-109  
**Files:**
- `src/components/calls/LiveKitCallRoom.tsx`
- `src/components/calls/CallAiSidebar.tsx`

**Steps:**
1. Show “AI assistant joined” when agent participant connects.
2. Exclude agent from participant tiles and count.
3. Wire assistant speaking indicator if available from agent state / audio track.

**Acceptance criteria:**
- [ ] UX parity with Agora assistant badge/indicators.
- [ ] `CallAiSidebar` tasks pipeline stages still update.

---

### TASK-305 — Stop Agora conversational AI on LiveKit path

**Branch:** `feature/livekit-drop-agora-agent`  
**Depends on:** TASK-303  
**Files:**
- `src/lib/calls/lifecycle.ts`
- `src/lib/agora/conversationalAi.ts` (guard only)

**Steps:**
1. Skip `startConversationalAgent` / `stopConversationalAgent` when `CALL_TRANSPORT=livekit`.
2. Use `stopLiveKitAgent` on call processing end.

**Acceptance criteria:**
- [ ] No Agora Agent Studio API calls on LiveKit path.
- [ ] Agent stops when call ends.

---

## Phase 4 — Server-side recording (optional)

### TASK-401 — LiveKit Egress deployment docs

**Branch:** `feature/livekit-egress-docs`  
**Depends on:** Prerequisites Redis  
**Files:**
- `services/livekit-egress/README.md` (new)
- `docs/internal/migration/agora-to-livekit.md` (link only)

**Steps:**
1. Document Docker compose for `livekit/egress` + Redis + storage upload to InsForge.
2. Add `LIVEKIT_EGRESS_ENABLED` flag behavior.

**Acceptance criteria:**
- [ ] Operator can deploy Egress from README.
- [ ] Not required for `CALL_TRANSPORT=livekit` MVP.

---

### TASK-402 — Egress API integration

**Branch:** `feature/livekit-egress-api`  
**Depends on:** TASK-401, TASK-108  
**Files:**
- `src/lib/livekit/egress.ts` (new)
- `src/app/api/calls/[id]/recording/start/route.ts`
- `src/app/api/calls/[id]/recording/stop/route.ts`

**Steps:**
1. Start RoomComposite egress on recording start (host only) when `LIVEKIT_EGRESS_ENABLED=true`.
2. Store `livekit_egress_id` on `call_recordings`.
3. Webhook or poll for completion → upload to `call-recordings` bucket.
4. Fallback: browser upload remains default.

**Acceptance criteria:**
- [ ] Server-side MP4 available when Egress enabled and browser upload fails.
- [ ] Browser recording still works when Egress disabled.

---

## Phase 5 — Cleanup & cutover

### TASK-501 — Default transport to LiveKit (staging)

**Branch:** `feature/livekit-default-staging`  
**Depends on:** TASK-305, TASK-109  
**Files:**
- `.env.example`
- Deployment env (document only)

**Steps:**
1. Set staging `CALL_TRANSPORT=livekit`.
2. Run full dogfood test script (manual checklist in `current-feature.md`).

**Acceptance criteria:**
- [ ] Staging calls use LiveKit end-to-end.
- [ ] No Agora API calls on staging.

---

### TASK-502 — Remove Agora code & dependencies

**Branch:** `feature/livekit-remove-agora`  
**Depends on:** TASK-501 (production cutover approval)  
**Files:**
- Delete `src/lib/agora/*`
- `src/components/calls/CallRoom.tsx` — delete or archive
- `src/components/calls/CallTransport.tsx` — LiveKit only
- `package.json` — remove `agora-rtc-sdk-ng`, `agora-token`, `protobufjs` (if unused)
- `src/app/api/webhooks/agora/recording/route.ts` — delete
- `.env.example` — remove `AGORA_*`

**Steps:**
1. Remove Agora branches and `CALL_TRANSPORT` flag (LiveKit only).
2. Rename remaining symbols: `channelNameForCall` → `roomNameForCall` everywhere.
3. Remove `agora_uid` writes; keep column nullable for historical rows.

**Acceptance criteria:**
- [ ] `pnpm build` passes with zero Agora imports.
- [ ] Grep for `agora` in `src/` returns no runtime code (docs/sql history OK).

---

### TASK-503 — Database: drop Agora columns

**Branch:** `feature/livekit-drop-agora-columns`  
**Depends on:** TASK-502  
**Files:**
- `migrations/YYYYMMDD_drop_agora_columns.sql`

**Steps:**
1. Drop `agora_channel_name`, `agora_agent_id`, `agora_uid`, `agora_resource_id`, `agora_sid` after backup window.
2. Update types in `src/types/calls.ts`.

**Acceptance criteria:**
- [ ] Migration documented and idempotent.
- [ ] App no longer references dropped columns.

---

### TASK-504 — Update research & close feature

**Branch:** `feature/livekit-migration-complete`  
**Depends on:** TASK-503  
**Files:**
- `docs/internal/current-feature.md`
- `docs/internal/migration/agora-to-livekit.md` (status → implemented)
- `docs/internal/migration/README.md`

**Steps:**
1. Mark feature `completed` with date and deviations.
2. Add history section to `current-feature.md`.

**Acceptance criteria:**
- [ ] Documentation reflects final architecture.
- [ ] Known limitations listed.

---

## Testing checklist (run per phase)

### Phase 1 — Media
- [ ] 2 participants join; audio + video work
- [ ] Screen share visible
- [ ] Mute/camera off/device switch
- [ ] Background blur (if enabled)
- [ ] Leave call → participant count → processing pipeline
- [ ] Browser recording upload (host)

### Phase 2 — Transcription
- [ ] Live captions appear < 3s latency (staging hardware)
- [ ] Speaker attribution correct
- [ ] Transcript flush after call

### Phase 3 — Assistant
- [ ] Agent joins when `ai_enabled`
- [ ] Spoken greeting
- [ ] Ask question → spoken + captioned reply
- [ ] Action items surface in sidebar
- [ ] Agent leaves on call end

### Phase 5 — Cutover
- [ ] `pnpm build` clean
- [ ] No Agora env vars required
- [ ] 5+ participant call smoke test

---

## Out of scope (do not implement unless asked)

- LiveKit Cloud / LiveKit Inference billing setup
- Paid STT/TTS vendors (Deepgram, ElevenLabs, Azure Speech) as defaults
- SIP / telephony integration
- Mobile native SDKs (iOS/Android)
- Replacing Gemini with another LLM
- Dropping browser recording without explicit approval
- Commits or deploys without user request

---

## Progress tracker

| Task | Status | Branch | Notes |
|------|--------|--------|-------|
| TASK-001 | pending | | |
| TASK-002 | pending | | |
| TASK-003 | pending | | |
| TASK-101 | pending | | |
| TASK-102 | pending | | |
| TASK-103 | pending | | |
| TASK-104 | pending | | |
| TASK-105 | pending | | |
| TASK-106 | pending | | |
| TASK-107 | pending | | |
| TASK-108 | pending | | |
| TASK-109 | pending | | |
| TASK-201 | pending | | |
| TASK-202 | pending | | |
| TASK-203 | pending | | |
| TASK-204 | pending | | |
| TASK-205 | pending | | |
| TASK-301 | pending | | |
| TASK-302 | pending | | |
| TASK-303 | pending | | |
| TASK-304 | pending | | |
| TASK-305 | pending | | |
| TASK-401 | pending | | optional |
| TASK-402 | pending | | optional |
| TASK-501 | pending | | |
| TASK-502 | pending | | |
| TASK-503 | pending | | |
| TASK-504 | pending | | |

**Last updated:** 2026-06-09
