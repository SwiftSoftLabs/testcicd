# Agora → LiveKit Migration Research (OneWork Calls Module)

**Status:** Research only — no implementation in this document  
**Date:** 2026-06-09  
**Scope:** Replace Agora RTC + Agora Conversational AI + Agora Real-Time STT with a **fully self-hosted** LiveKit stack (no LiveKit Cloud billing, no paid inference gateway).  
**Schema:** `app_onework` (InsForge / SwiftSoftLabs shared cluster)

---

## 1. Executive summary

OneWork’s calls module today depends on **Agora** for:

1. **WebRTC media** — multi-party video/audio, screen share, device switching (`agora-rtc-sdk-ng`)
2. **Access tokens** — server-signed RTC tokens (`agora-token`)
3. **Conversational AI agent** — Agora Agent Studio REST API joins a bot UID into the channel; LLM is our custom Gemini webhook
4. **Real-time STT** — separate Agora STT bot publishes protobuf captions over Agora `stream-message`
5. **Cloud recording** — Agora REST recording API (partially wired; primary recording path is **browser-side** composite via `MeetingCompositeRecorder`)

LiveKit is an **Apache 2.0** open-source WebRTC SFU plus an **Agents** framework (Python/Node.js) that can replace all Agora-specific services when self-hosted. LiveKit Cloud and **LiveKit Inference** are optional paid layers; they are **not required** for this migration.

**Recommended target architecture:**

| Layer | Self-hosted component | Notes |
|-------|----------------------|-------|
| Media SFU | [livekit/livekit](https://github.com/livekit/livekit) | Rooms, participants, tracks |
| TURN | Embedded in LiveKit server or external coturn | Required for corporate NAT |
| Coordination | Redis | Required for Egress + distributed agents |
| Recording (server) | [livekit/egress](https://github.com/livekit/egress) | Optional; browser recording can remain |
| Voice AI agent | [livekit/agents](https://github.com/livekit/agents) (Python recommended) | STT → LLM → TTS pipeline |
| STT (live captions) | Same agent or dedicated transcription agent | `lk.transcription` text stream |
| TTS | **Piper** (self-hosted) via community plugin | No per-minute vendor fees |
| LLM | Existing **Gemini** (`GEMINI_API_KEY`) | Already used in `/api/calls/[id]/ai/llm` |
| Frontend | `@livekit/components-react` + `livekit-client` | Replace `CallRoom.tsx` Agora client |
| Token API | `livekit-server-sdk` in Next.js | Replace `/api/calls/[id]/token` |

**Key insight:** Agora splits media, STT, and conversational AI across three REST products with numeric UIDs and protobuf side channels. LiveKit unifies these as **room participants** (humans + agents) on one WebRTC transport, with transcriptions on the `lk.transcription` topic and agent audio as a normal published track.

---

## 2. Current OneWork Agora architecture

### 2.1 Dependency graph

```
Browser (CallRoom.tsx)
  └─ agora-rtc-sdk-ng
       ├─ join(channel, token, uid)
       ├─ publish mic/camera/screen
       ├─ subscribe remote users
       └─ stream-message → decodeSttStreamMessage (protobuf)

Next.js API
  ├─ POST /api/calls/[id]/token        → buildRtcToken (agora-token)
  ├─ POST /api/calls/[id]/join         → maybeStartAgent, maybeStartStt
  ├─ POST /api/calls/[id]/agent/start  → maybeStartAgent
  ├─ POST /api/calls/[id]/ai/llm       → Gemini (Agora agent webhook)
  └─ recording/*                       → DB rows only (browser uploads)

src/lib/agora/*
  ├─ token.ts              RTC token builder
  ├─ conversationalAi.ts   Agora Agent Studio join/leave
  ├─ realtimeStt.ts        Agora STT join/leave
  ├─ agentConfig.ts        Pipeline: custom LLM URL, MS TTS, Deepgram ASR
  ├─ sttMessage.ts         Protobuf decoder for STT captions
  ├─ recording.ts          Agora cloud recording REST (largely unused in UI path)
  └─ restAuth.ts           Basic auth for Agora REST

src/lib/calls/lifecycle.ts
  └─ orchestrates agent/STT start/stop on join and post-call processing
```

### 2.2 Environment variables (today)

From `.env.example`:

| Variable | Purpose |
|----------|---------|
| `AGORA_APP_ID` | RTC app id (also STT project id) |
| `AGORA_APP_CERTIFICATE` | RTC token signing |
| `AGORA_CUSTOMER_ID` / `AGORA_CUSTOMER_SECRET` | REST APIs (agent, STT, recording) |
| `AGORA_CONVERSATIONAL_AI_ENABLED` | Feature flag |
| `AGORA_AGENT_PIPELINE_ID` | Optional Agent Studio pipeline |
| `AGORA_AGENT_RTC_UID` | Bot UID (default `10001`) |
| `AGORA_LLM_WEBHOOK_SECRET` | Auth for `/api/calls/.../ai/llm` |
| `AGORA_STT_*` | Separate STT bot UIDs + language |

### 2.3 Database columns tied to Agora

`sql/calls_migration.sql`:

| Table | Agora-specific columns |
|-------|------------------------|
| `call_sessions` | `agora_channel_name`, `agora_agent_id` |
| `call_participants` | `agora_uid` |
| `call_recordings` | `agora_resource_id`, `agora_sid` |

Metadata JSON also stores `stt_agent_id`, `stt_pub_bot_uid`, `agent_status`, etc.

`TranscriptSegment` type includes `agora_uid` for speaker attribution.

### 2.4 Feature inventory

| Feature | Agora mechanism | OneWork implementation |
|---------|-----------------|------------------------|
| Pre-join device test | Agora `createMicrophoneAndCameraTracks` | `PreJoinModal` + `CallRoom` |
| Multi-party video grid | RTC client `user-published` | `CallRoom.tsx` (~2.4k LOC) |
| Screen share | `createScreenVideoTrack` | `CallRoom.tsx` |
| Background blur | Custom processor on `ICameraVideoTrack` | `createBackgroundBlurProcessor.ts` (Agora types only) |
| Noise cancellation | Agora `AINS` extension config | `microphoneAudioConfig.ts` |
| AI voice assistant | Conversational AI agent UID `10001` | Hidden from tile grid; speaks via Agora |
| Live transcript | STT pub bot UID + `stream-message` | Host sidebar + `/live` poll + InsForge realtime |
| Custom LLM | Agora → webhook → Gemini | `/api/calls/[id]/ai/llm` |
| Post-call AI | Gemini on recording/transcript | `callGeminiPostProcess.ts`, `liveMeetingAi.ts` |
| Recording | Browser `MeetingCompositeRecorder` + optional Agora cloud | Upload to InsForge storage |
| Reconnection | `rtcHolder.ts` persists Agora client state | sessionStorage |
| Max participants | `CALL_MAX_PARTICIPANTS` (50) | App constant |

### 2.5 Agora costs / coupling we want to remove

- Agora Console project + per-minute RTC billing
- Agora Conversational AI / Agent Studio (TTS via Microsoft, ASR via Deepgram in `agentConfig.ts`)
- Agora Real-Time STT (separate service + protobuf parsing)
- Agora REST credentials (`CUSTOMER_ID` / `CUSTOMER_SECRET`)
- Numeric UID mapping (`agoraUidFromUserId`) and reserved bot UIDs

---

## 3. LiveKit platform overview

LiveKit ([github.com/livekit/livekit](https://github.com/livekit/livekit)) is an open-source **Selective Forwarding Unit (SFU)** for WebRTC. Related OSS projects:

| Project | Role |
|---------|------|
| [livekit/livekit](https://github.com/livekit/livekit) | Core server (Go) |
| [livekit/agents](https://github.com/livekit/agents) | Voice/video AI agent framework (Python primary, Node.js port) |
| [livekit/egress](https://github.com/livekit/egress) | Server-side recording / RTMP / HLS |
| [livekit/ingress](https://github.com/livekit/ingress) | RTMP/WHIP ingest |
| [livekit/components-js](https://github.com/livekit/components-js) | React UI primitives |
| [livekit/node-sdks](https://github.com/livekit/node-sdks) | Server SDK (tokens, room API, agent dispatch) |
| [livekit/client-sdk-js](https://github.com/livekit/client-sdk-js) | Browser SDK |

### 3.1 Cloud vs self-hosted (what we skip)

Per [LiveKit self-hosting docs](https://docs.livekit.io/transport/self-hosting/):

| Capability | Self-hosted | LiveKit Cloud only |
|------------|-------------|-------------------|
| RTC rooms / tracks | ✅ | ✅ |
| Agents framework | ✅ | ✅ (+ managed hosting) |
| Egress / Ingress / SIP | ✅ | ✅ |
| Agent Builder | ❌ | ✅ |
| **LiveKit Inference** (bundled STT/LLM/TTS API keys) | ❌ | ✅ |

**Our constraint:** No payment → self-host server + agents + TTS/STT models; keep **Gemini** for LLM (already paid/configured separately).

### 3.2 Core concepts mapping

| Agora | LiveKit |
|-------|---------|
| Channel (`ow_<callId>`) | **Room** (name = `ow_<callId>` — reuse existing naming) |
| Numeric UID | **Participant identity** (string, e.g. user UUID) |
| RTC token (appId + certificate) | **JWT access token** (API key + secret + grants) |
| `user-published` / `subscribe` | `TrackPublished` / `RoomEvent` + `setSubscribed` |
| `stream-message` (STT) | **Text stream** topic `lk.transcription` |
| Agent as RTC user UID 10001 | Agent as **room participant** with audio track |
| Agora REST agent join | **AgentDispatchService** or token `RoomConfiguration` |
| Cloud recording REST | **Egress API** or keep browser recording |

---

## 4. Self-hosted infrastructure design

### 4.1 Minimum production topology

Deploy on SwiftSoftLabs infrastructure (VM or k8s on the same cluster region as InsForge app):

```
                    ┌─────────────────────────────────────┐
                    │  OneWork Next.js (Vercel / InsForge) │
                    │  - Issue LiveKit JWTs                │
                    │  - AgentDispatch API calls           │
                    │  - Existing Gemini LLM routes        │
                    └──────────────┬──────────────────────┘
                                   │ HTTPS / WSS
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│ LiveKit Server  │    │ Redis                │    │ LiveKit Agents  │
│ (SFU + TURN)    │◄──►│ (egress + agents)    │◄──►│ (Python worker) │
│ :7880 WS        │    │ :6379                │    │ STT/LLM/TTS     │
└────────┬────────┘    └──────────────────────┘    └────────┬────────┘
         │                                                  │
         │ optional                                         │
         ▼                                                  ▼
┌─────────────────┐                              ┌─────────────────┐
│ LiveKit Egress  │                              │ Piper TTS       │
│ (recording)     │                              │ (HTTP or local) │
└─────────────────┘                              └─────────────────┘
         │
         ▼
┌─────────────────┐
│ InsForge Storage│  ← recording files (existing bucket)
└─────────────────┘
```

### 4.2 LiveKit server configuration essentials

Reference: [Deploying LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/), [config-sample.yaml](https://github.com/livekit/livekit/blob/master/config-sample.yaml).

**Sample `livekit.yaml` (starting point):**

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  onework: <GENERATE_STRONG_SECRET>
turn:
  enabled: true
  domain: turn.calls.onework.example.com
  cert_file: /etc/livekit/turn.crt
  key_file: /etc/livekit/turn.key
  udp_port: 3478
  tls_port: 443
```

**Critical networking notes:**

- WebRTC needs **UDP port ranges** (default 50000–60000) open on the SFU host.
- **TURN** is mandatory for many enterprise/cellular networks. Embedded TURN requires TLS certs even for UDP in recent versions.
- For Docker, `network_mode: host` is often simpler than NAT port mapping.
- Production multi-node requires **Redis** for room state fan-out.

**Firewall checklist:**

| Port | Protocol | Service |
|------|----------|---------|
| 7880 | TCP | LiveKit API / WebSocket signal |
| 7881 | TCP | ICE/TCP fallback |
| 3478 | UDP | TURN |
| 443 | TCP | TURN/TLS (recommended) |
| 50000–60000 | UDP | WebRTC media |

### 4.3 Redis

Required when running:

- **Egress** (recording service uses Redis message queue)
- **Multiple LiveKit server instances**
- **Agent worker pool** at scale

Single-node dev can start without Egress; production with server-side recording needs Redis.

### 4.4 LiveKit Egress (optional replacement for Agora cloud recording)

[livekit/egress](https://github.com/livekit/egress) supports:

- **RoomComposite** — grid/layout recording (Chrome-based compositor)
- **TrackComposite** — single participant
- **Track egress** — raw track export

**Resource expectation:** ~2–6 CPUs per RoomComposite job. Docker requires `--cap-add=SYS_ADMIN` (Chrome sandbox) since v1.7.6.

**OneWork note:** We already record client-side with `MeetingCompositeRecorder` and upload via `/api/calls/[id]/recording/upload`. Egress is **optional** for Phase 1; consider it for reliable server-side recording without depending on the host’s browser.

### 4.5 Hosting location relative to InsForge

- LiveKit SFU should be in a **low-latency region** to users (UDP-sensitive).
- Agents worker can co-locate with SFU or run on a separate CPU-heavy node (STT/TTS inference).
- Piper TTS is lightweight (~300 ms for short phrases on CPU); can share the agent host.

---

## 5. Self-hosted voice AI (STT + LLM + TTS)

### 5.1 Agora pipeline today

`src/lib/agora/agentConfig.ts` configures:

- **LLM:** `vendor: custom` → `POST /api/calls/{id}/ai/llm` (Gemini)
- **TTS:** `vendor: microsoft` (Agora-managed)
- **ASR:** `vendor: deepgram` (Agora-managed)

STT for live captions is a **second** Agora service (`realtimeStt.ts`) with separate bot UIDs.

### 5.2 LiveKit Agents pipeline (replacement)

LiveKit Agents run an **AgentSession** with pluggable:

- **STT** — speech-to-text
- **LLM** — language model
- **TTS** — text-to-speech
- **VAD** — Silero (local, no API)
- **Turn detector** — optional multilingual model (local weights)

Docs: [Agents introduction](https://docs.livekit.io/agents/), [voice pipeline](https://docs.livekit.io/agents/models/).

**Dispatch model (maps to `maybeStartAgent`):**

1. **Explicit dispatch** — backend calls `AgentDispatchService.createDispatch(room, agentName, metadata)` when first participant joins (mirrors Agora `conversational-ai-agent/v2/.../join`).
2. **Token-embedded dispatch** — include `RoomConfiguration.agents` in JWT when issuing participant token (agent starts when user connects).

Use explicit dispatch to preserve current behavior (agent starts once when call goes live, not per participant).

### 5.3 LLM — keep Gemini (already integrated)

**Option A (recommended):** Port logic from `/api/calls/[id]/ai/llm` into the Python agent using `google-genai` or an OpenAI-compatible adapter.

**Option B:** HTTP tool / custom LLM node that calls the existing Next.js route (preserves rate limits and workspace context helper `getWorkspaceContextText`). Adds HTTP hop latency.

Existing route already:

- Verifies `AGORA_LLM_WEBHOOK_SECRET`
- Loads workspace context for participants
- Calls Gemini with action-item extraction prompt

Rename secret to `CALL_AI_LLM_WEBHOOK_SECRET` (vendor-neutral).

### 5.4 STT — self-hosted options

| Option | Pros | Cons |
|--------|------|------|
| **faster-whisper** (local) | Free, good quality, [community plugin](https://github.com/CoreWorxLab/local-livekit-plugins) | CPU/GPU cost; tune model size |
| **Whisper via OpenAI plugin + StreamAdapter** | Documented pattern | Still needs local Whisper server |
| **Deepgram / etc.** | Easy plugin | Paid API — avoid per user request |
| **Dedicated transcription agent** | Decouples captions from voice agent | Extra worker process |

**Live captions delivery:** Subscribe to text stream topic `lk.transcription` in the browser ([Live captions pattern](https://openvidu.io/latest/docs/ai/live-captions/)). Segments include `final` flag and `lk.transcription_final` attribute — replaces Agora protobuf `decodeSttStreamMessage`.

**Backend forwarding:** Agent publishes transcriptions via `publish_transcription`; map `participant_identity` → `user_id` instead of `agora_uid`.

**Unification win:** A single agent can produce both voice responses **and** participant transcriptions, potentially **eliminating** the separate STT bot (`maybeStartStt`) entirely.

### 5.5 TTS — self-hosted Piper (required: no paid LiveKit Inference)

LiveKit’s **managed inference** includes Cartesia/ElevenLabs-class TTS — that is a **Cloud billing** product. For self-hosted TTS:

#### Recommended: Piper

Piper ([OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl)) is fast, CPU-friendly, Apache/GPL licensed.

**Integration paths:**

| Path | Package | How |
|------|---------|-----|
| HTTP server | [livekit-plugins-piper-tts](https://pypi.org/project/livekit-plugins-piper-tts/) | Run Piper web server; `piper_tts.TTS("http://localhost:5000/")` |
| In-process | [local-livekit-plugins](https://github.com/CoreWorxLab/local-livekit-plugins) | `PiperTTS(model_path="en_US-ryan-high.onnx")` |
| Custom plugin | Extend `livekit.agents.tts.TTS` | Implement `synthesize()` → `ChunkedStream` |

Example AgentSession (self-hosted stack):

```python
from livekit.agents import AgentSession, Agent
from livekit.plugins import silero
from local_livekit_plugins import FasterWhisperSTT, PiperTTS
# or: from livekit.plugins import piper_tts

session = AgentSession(
    stt=FasterWhisperSTT(model_size="base.en"),
    llm=...,  # Gemini
    tts=PiperTTS(model_path="/models/en_US-lessac-medium.onnx"),
    vad=silero.VAD.load(),
)
```

**Voice quality trade-off:** Piper is good for meeting assistant use (concise, professional) but not ElevenLabs-class expressiveness. Acceptable for OneWork’s “capture action items” assistant per `agentConfig.ts` system prompt.

**Other OSS TTS (future):** Coqui XTTS, Kokoro, KittenTTS — all need custom `TTS` plugin implementations ([GitHub #1724](https://github.com/livekit/agents/issues/1724)).

### 5.6 Agent worker deployment

Run as a **separate service** (not inside Next.js):

```bash
# Environment
LIVEKIT_URL=wss://livekit.calls.example.com
LIVEKIT_API_KEY=onework
LIVEKIT_API_SECRET=<secret>
GEMINI_API_KEY=<existing>

# Development
python agent.py dev

# Production
python agent.py start
```

Dockerfile templates: [agents starter repos](https://github.com/livekit/agents).

**Agent naming:**

```python
# WorkerOptions
agent_name = "onework-meeting-assistant"
```

Backend stores dispatch id in `call_sessions.metadata.livekit_agent_dispatch_id` (replace `agora_agent_id`).

### 5.7 Transcription-only agent (if splitting concerns)

If voice agent and captioning should scale independently:

| Agent | `agent_name` | Pipeline |
|-------|--------------|----------|
| Meeting assistant | `onework-meeting-assistant` | STT + Gemini + Piper TTS |
| Captioner | `onework-transcriber` | STT only → `lk.transcription` |

For OneWork’s current feature set, **one combined agent** is simpler.

---

## 6. Frontend migration (`CallRoom.tsx`)

### 6.1 Packages to add / remove

| Remove | Add |
|--------|-----|
| `agora-rtc-sdk-ng` | `livekit-client` |
| `agora-token` | `@livekit/components-react` |
| `protobufjs` (if only used for STT) | `@livekit/components-styles` (optional) |

### 6.2 Structural approach

`CallRoom.tsx` is ~2,455 lines tightly coupled to Agora events. Recommended strategies (in order of pragmatism):

1. **Incremental:** New `LiveKitCallRoom.tsx` behind feature flag; share sidebar/AI chrome.
2. **Hooks extraction:** `useCallMedia`, `useCallTranscript`, `useCallRecording` with swappable transport.
3. **Prefab baseline:** Start from `LiveKitRoom` + custom layout (do **not** use stock `VideoConference` wholesale — OneWork has custom AI sidebar, minimization, tasks pipeline).

### 6.3 Event mapping

| Agora event | LiveKit equivalent |
|-------------|-------------------|
| `user-published` (video) | `RoomEvent.TrackSubscribed` (video) |
| `user-published` (audio) | `RoomEvent.TrackSubscribed` (audio) |
| `user-unpublished` | `TrackUnsubscribed` / `TrackMuted` |
| `user-left` | `ParticipantDisconnected` |
| `user-info-updated` (mute) | `TrackMuted` / `ParticipantPermissionsChanged` |
| `stream-message` (STT) | `Room.registerTextStreamHandler('lk.transcription', ...)` |
| `join(channel, token, uid)` | `room.connect(url, token)` |
| `createMicrophoneAndCameraTracks` | `createLocalTracks` / `localParticipant.enableCameraAndMicrophone` |
| `createScreenVideoTrack` | `localParticipant.setScreenShareEnabled(true)` |
| `client.leave()` | `room.disconnect()` |

### 6.4 Identity model change

**Today:** `agoraUidFromUserId(userId)` → numeric UID stored in `call_participants.agora_uid`.

**Target:** `identity = userId` (UUID string) in LiveKit token. Store `livekit_identity` column or reuse `user_id` directly (identity can equal user id).

Remove reserved UID filtering (`DEFAULT_AGENT_RTC_UID`, `getSttPubBotUid`). Agent is identified by `participant.kind === ParticipantKind.AGENT` or metadata attribute `role=assistant`.

### 6.5 Background blur

`createBackgroundBlurProcessor.ts` imports Agora `ICameraVideoTrack` but operates on `MediaStreamTrack`. Migration:

- Replace Agora track wrapper with LiveKit `LocalVideoTrack` or raw `MediaStreamTrack` from `createLocalVideoTrack`.
- Use `videoTrack.setProcessor()` if LiveKit processor API fits, or keep canvas/WebGL compositor feeding a custom `LocalVideoTrack` via `MediaStreamTrackGenerator`.

No Agora-specific blur extension required.

### 6.6 Noise cancellation

`microphoneAudioConfig.ts` references Agora AINS. LiveKit options:

- Browser built-in `echoCancellation` / `noiseSuppression` constraints (already partially used)
- [@livekit/krisp-noise-filter](https://www.npmjs.com/package/@livekit/krisp-noise-filter) (check license for commercial use)
- RNNoise WASM (custom worklet)

Phase 1: standard `getUserMedia` constraints; Phase 2: evaluate Krisp or WASM.

### 6.7 Local recording

`MeetingCompositeRecorder` composites canvas + remote audio — **transport-agnostic**. Update track acquisition to use LiveKit `RemoteTrack` / `MediaStreamTrack` instead of Agora `IRemoteVideoTrack.play(element)`.

### 6.8 Reconnection

`rtcHolder.ts` persists Agora client — replace with LiveKit `Room` reconnect pattern (`RoomEvent.Reconnecting`, `Reconnected`). LiveKit SDK handles ICE restarts more robustly than manual Agora rejoin.

---

## 7. Backend API migration

### 7.1 Token route

**File:** `src/app/api/calls/[id]/token/route.ts`

Replace Agora token with LiveKit JWT:

```typescript
import { AccessToken } from "livekit-server-sdk";

const at = new AccessToken(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
  { identity: user.id, name: displayName },
);
at.addGrant({
  roomJoin: true,
  room: roomNameForCall(call.workspace_id, call.id),
  canPublish: true,
  canSubscribe: true,
});
return { token: await at.toJwt(), url: process.env.NEXT_PUBLIC_LIVEKIT_URL };
```

Rename `channelNameForCall` → `roomNameForCall` (same `ow_<hex>` format works — LiveKit room names allow this).

### 7.2 Agent start

**Replace:** `src/lib/agora/conversationalAi.ts`  
**With:** `src/lib/livekit/agentDispatch.ts`

```typescript
import { AgentDispatchClient } from "livekit-server-sdk";

const client = new AgentDispatchClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
const dispatch = await client.createDispatch(roomName, "onework-meeting-assistant", {
  metadata: JSON.stringify({ call_id: call.id, workspace_id: call.workspace_id }),
});
```

### 7.3 STT start

**Remove** `maybeStartStt` + `realtimeStt.ts` if transcription is handled inside the meeting assistant agent.

If keeping separate transcriber: second `createDispatch` for `onework-transcriber`.

### 7.4 LLM route

Keep `/api/calls/[id]/ai/llm` during transition; agent can call it. Long-term: move Gemini logic into agent worker to reduce latency.

### 7.5 Webhooks

LiveKit supports [webhooks](https://docs.livekit.io/home/server/webhooks/) for `room_finished`, `participant_left`, etc. Can replace some polling for empty-room detection alongside existing `scheduleProcessingIfEmpty`.

---

## 8. Database migration plan

Add columns / deprecate Agora names (migration SQL in `migrations/`):

```sql
-- Phase 1: add LiveKit columns (nullable)
ALTER TABLE app_onework.call_sessions
  ADD COLUMN IF NOT EXISTS livekit_room_name TEXT,
  ADD COLUMN IF NOT EXISTS livekit_agent_dispatch_id TEXT;

ALTER TABLE app_onework.call_participants
  ADD COLUMN IF NOT EXISTS livekit_identity TEXT;

ALTER TABLE app_onework.call_recordings
  ADD COLUMN IF NOT EXISTS livekit_egress_id TEXT;

-- Phase 2: backfill livekit_room_name from agora_channel_name
UPDATE app_onework.call_sessions
SET livekit_room_name = agora_channel_name
WHERE livekit_room_name IS NULL AND agora_channel_name IS NOT NULL;

-- Phase 3 (later): drop agora_* columns after cutover
```

**Types:** `TranscriptSegment.agora_uid` → add `participant_identity` or `livekit_identity`; keep `agora_uid` nullable during transition.

**Metadata keys:** `stt_agent_id` → `livekit_transcription_agent_dispatch_id` or remove if unified.

---

## 9. Environment variables (target)

```bash
# LiveKit (self-hosted)
NEXT_PUBLIC_LIVEKIT_URL=wss://livekit.calls.example.com
LIVEKIT_URL=https://livekit.calls.example.com   # server SDK (HTTPS base)
LIVEKIT_API_KEY=onework
LIVEKIT_API_SECRET=

# Agent dispatch
LIVEKIT_AGENT_NAME=onework-meeting-assistant
CALL_AI_LLM_WEBHOOK_SECRET=          # rename from AGORA_LLM_WEBHOOK_SECRET

# Feature flags (keep existing)
CALL_RECORDING_ENABLED=true
CALL_AI_ENABLED=true

# Gemini (unchanged)
GEMINI_API_KEY=

# Optional Egress
LIVEKIT_EGRESS_ENABLED=false

# Agent worker (separate deployment — not in Next.js)
# PIPER_MODEL_PATH=/models/en_US-lessac-medium.onnx
# WHISPER_MODEL_SIZE=base.en
```

Remove after cutover: all `AGORA_*` variables.

---

## 10. Phased migration roadmap

### Phase 0 — Infrastructure (no app code)

- [ ] Provision VM/k8s node with UDP firewall rules
- [ ] Deploy LiveKit server + TLS + TURN
- [ ] Deploy Redis (if Egress or multi-node)
- [ ] Generate API key/secret; store in InsForge secrets
- [ ] Smoke test with [LiveKit example app](https://example.livekit.io) pointed at self-hosted URL

### Phase 1 — Media only (MVP)

- [ ] Add `livekit-server-sdk` token route (parallel to Agora)
- [ ] Build `LiveKitCallRoom` with join/leave, mic/cam, screen share
- [ ] Feature flag `CALL_TRANSPORT=livekit|agora`
- [ ] DB: `livekit_room_name`, `livekit_identity`
- [ ] Keep browser recording + post-call Gemini unchanged

### Phase 2 — Live transcription

- [ ] Deploy transcription agent (faster-whisper) OR combined assistant
- [ ] Replace `stream-message` handler with `lk.transcription` subscription
- [ ] Map speaker identity → `user_id` in transcript segments
- [ ] Remove Agora STT REST + `sttMessage.ts` + `protobufjs`

### Phase 3 — Voice meeting assistant

- [ ] Deploy meeting assistant agent (Gemini + Piper TTS)
- [ ] Wire `AgentDispatch` in `lifecycle.ts`
- [ ] Hide agent from main grid via participant metadata
- [ ] Port system prompt from `agentConfig.ts`
- [ ] Remove Agora conversational AI REST

### Phase 4 — Recording hardening (optional)

- [ ] Deploy Egress; upload MP4 to `call-recordings` bucket
- [ ] Fallback when browser upload fails
- [ ] Remove Agora cloud recording code

### Phase 5 — Cleanup

- [ ] Remove `agora-rtc-sdk-ng`, `agora-token`, `src/lib/agora/*`
- [ ] Drop `agora_*` DB columns
- [ ] Update `.env.example`, internal docs
- [ ] Load test at `CALL_MAX_PARTICIPANTS` (50)

---

## 11. Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| UDP/TURN misconfiguration | High | Staged rollout; test from restrictive networks; monitor `ICE failed` metrics |
| Piper voice quality | Medium | Pick high-quality voice model; allow model swap without code change |
| Whisper latency on CPU | Medium | Use `base` or `small` model; GPU node if needed; partial transcripts |
| `CallRoom` rewrite scope | High | Feature flag; parallel component; don’t big-bang |
| Agent worker availability | Medium | Health checks; restart policy; dispatch retry on failure |
| Egress CPU cost | Medium | Keep browser recording as primary; Egress for hosts-only |
| Gemini still paid | Low | Acceptable — user asked to avoid LiveKit/Agora fees, not LLM |
| Krisp/license for NC | Low | Defer; use browser constraints first |

---

## 12. Cost comparison (qualitative)

| | Agora (current) | LiveKit self-hosted |
|--|-----------------|---------------------|
| RTC minutes | Agora billing | **VM bandwidth + compute** (fixed) |
| STT | Agora STT / Deepgram via Agora | **CPU/GPU** (faster-whisper) |
| TTS | Microsoft via Agora | **CPU** (Piper) |
| Voice agent orchestration | Agora Agent Studio | **Agent worker** container |
| LLM | Gemini API | Gemini API (unchanged) |
| Platform fee | Agora Console | **$0** LiveKit OSS license |

Break-even favors self-hosting at sustained meeting volume; upfront cost is DevOps time and a always-on media node.

---

## 13. File-level change checklist

| Path | Action |
|------|--------|
| `src/components/calls/CallRoom.tsx` | Rewrite or replace with LiveKit |
| `src/lib/agora/*` | Delete after Phase 5 |
| `src/lib/calls/constants.ts` | Rename channel helpers; remove UID helpers |
| `src/lib/calls/lifecycle.ts` | Swap agent/STT start/stop |
| `src/lib/calls/rtcHolder.ts` | LiveKit room persistence |
| `src/lib/calls/backgroundBlur/*` | Remove Agora type imports |
| `src/lib/calls/releaseMediaTracks.ts` | LiveKit track cleanup |
| `src/lib/agora/sttMessage.ts` | Delete (transcription stream) |
| `src/app/api/calls/[id]/token/route.ts` | LiveKit JWT |
| `src/app/api/webhooks/agora/recording/route.ts` | Delete or LiveKit webhook |
| `src/types/calls.ts` | New LiveKit fields |
| `sql/calls_migration.sql` | Reference only; new migration file |
| `.env.example` | LiveKit vars |
| `package.json` | Swap dependencies |
| **New:** `services/livekit-agent/` | Python agent worker + Dockerfile |
| **New:** `src/lib/livekit/token.ts` | Token builder |
| **New:** `src/lib/livekit/agentDispatch.ts` | Dispatch client |

---

## 14. Open decisions (for implementation phase)

1. **Python vs Node.js agent?** Python has richer plugin ecosystem (Piper, faster-whisper, Silero). Node.js aligns with monorepo but TTS/STT self-host plugins are sparser.
2. **Single agent vs split transcriber?** Single is simpler; split helps if captioning must run without voice assistant.
3. **Server-side Egress vs browser-only recording?** Browser-only is faster to ship; Egress improves reliability.
4. **Room auto-create vs explicit `RoomService.createRoom`?** LiveKit auto-creates on first join — likely sufficient.
5. **Identity in JWT:** Use raw `user.id` vs hashed — prefer raw UUID for straightforward DB joins.
6. **Hosting provider:** Same SwiftSoftLabs VM as other services vs dedicated media node.

---

## 15. References

### LiveKit official

- [LiveKit server (GitHub)](https://github.com/livekit/livekit)
- [Agents framework (GitHub)](https://github.com/livekit/agents)
- [Self-hosting overview](https://docs.livekit.io/transport/self-hosting/)
- [Deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/)
- [Agents introduction](https://docs.livekit.io/agents/)
- [Agent dispatch](https://docs.livekit.io/agents/server/agent-dispatch/)
- [Agent dispatch API](https://docs.livekit.io/reference/agents/agent-dispatch-service-api/)
- [Text & transcriptions](https://docs.livekit.io/agents/multimodality/text/)
- [Egress self-hosting](https://docs.livekit.io/transport/self-hosting/egress/)
- [Custom token generation](https://docs.livekit.io/home/get-started/authentication/)
- [React components](https://github.com/livekit/components-js/tree/main/packages/react)

### Self-hosted TTS/STT

- [Piper (piper1-gpl)](https://github.com/OHF-Voice/piper1-gpl)
- [livekit-plugins-piper-tts](https://pypi.org/project/livekit-plugins-piper-tts/)
- [local-livekit-plugins (FasterWhisper + Piper)](https://github.com/CoreWorxLab/local-livekit-plugins)
- [Custom TTS integration discussion](https://github.com/livekit/agents/issues/1724)

### OneWork codebase (current Agora touchpoints)

- `src/components/calls/CallRoom.tsx` — main RTC client
- `src/lib/agora/` — token, agent, STT, recording
- `src/lib/calls/lifecycle.ts` — agent/STT orchestration
- `src/app/api/calls/[id]/token/route.ts` — credentials endpoint
- `src/app/api/calls/[id]/ai/llm/route.ts` — Gemini webhook for Agora agent
- `sql/calls_migration.sql` — schema reference

---

## 16. Next step (when moving beyond research)

1. Record decisions in `context/current-feature.md` (or `docs/internal/current-feature.md`).
2. Create branch `feature/livekit-migration-phase-0`.
3. Stand up self-hosted LiveKit on staging infrastructure.
4. Implement Phase 1 behind `CALL_TRANSPORT` flag.

This document is the research baseline only; no application code has been changed.
