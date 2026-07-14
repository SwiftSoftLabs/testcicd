# Background blur revamp plan (Google Meet–style)

Related: [fix-live-call-video-scenarios.plan.md](./fix-live-call-video-scenarios.plan.md)

---

## Reported bugs (blur-specific)

| ID | Symptom | Root cause (code evidence) | Fix status |
|----|---------|---------------------------|------------|
| **B1** | Join with blur → remote sees no camera | Canvas `captureStream()` publishes before first frame painted; possible black RTP | **Fixed:** `waitForFirstFrame()` before `publishTrack` |
| **B2** | Toggle cam → remote loses blur, local keeps blur | Blur track published as `Track.Source.Unknown`; `setCameraEnabled(true)` creates **new raw** camera via `createTracks()` | **Fixed:** publish with `{ source: Camera }`; toggle uses `mute/unmute` on blur publication |
| **B3** | Pre-join blur ≠ in-call blur | Two separate processors; pre-join destroyed on join | **Planned:** shared pipeline / transfer processor |
| **B4** | Blur “buggy” vs Meet | Custom main-thread canvas + MediaPipe vs integrated processor pipeline | **Planned:** revamp architecture (below) |

### LiveKit `setCameraEnabled` behavior (why B2 happened)

From `livekit-client` `LocalParticipant.setTrackEnabled`:

- If a **Camera** publication exists → mute/unmute it.
- If **no** Camera publication → `createTracks({ video: true })` and publish **new** getUserMedia track.

Our blur track was published with default `source = Unknown`, so toggling camera created a **second, raw** track for remotes while local preview still attached to the blur `LocalVideoTrack`.

---

## How Google Meet differs (target architecture)

| Aspect | Google Meet (typical) | OneWork today |
|--------|----------------------|---------------|
| **Pipeline** | Single track: camera → ML segmentation → composite → **encoder** | Raw camera + separate canvas `captureStream` → `LocalVideoTrack` |
| **Processing location** | GPU / dedicated worker / insertable streams | Main thread rAF + MediaPipe WASM |
| **Track identity** | One published track for entire session | Risk of duplicate tracks on toggle (fixed for Camera source) |
| **Warm-up** | Model + first frame before “join” | Segmenter async; publish could beat first paint (fixed) |
| **Mute** | Stops/signals at processor; same track | Must not call `setCameraEnabled` when custom processor active |
| **Preview vs send** | Same processed frames | Pre-join processor discarded; in-call creates new processor |

Meet’s smoothness comes from **one consistent processed track** end-to-end, warm-up before visible/published, and **never swapping** raw vs processed on the wire.

---

## Phased revamp

### Phase 1 — Correctness (this iteration)

- [x] Publish blur as `Track.Source.Camera` with explicit `publishOptions.source`
- [x] `waitForFirstFrame()` before publish
- [x] Blur toggle via publication `mute` / `unmute` + `reconnectSource`
- [x] Instrumentation `B1`–`B4` in logs
- [ ] Verify with two-tab test matrix

### Phase 2 — Pipeline unification

1. **`CallBlurPipeline` class** (single owner)
   - Holds: raw MST, processor, published `LocalVideoTrack`, blur enabled flag
   - Methods: `warmUp()`, `publish(room)`, `mute()`, `unmute()`, `reconnectRaw()`, `dispose()`
2. **Pre-join → in-call handoff**
   - Option A: Move processor from PreJoin to room (don’t destroy on join)
   - Option B: Shared segmenter singleton + reattach source only
3. **Stop double init** of MediaPipe on join when pre-join already warmed WASM

### Phase 3 — Meet-grade processing (optional, larger)

1. Evaluate `@livekit/track-processors` `BackgroundBlur` (same MediaPipe, LiveKit-maintained attach)
2. Or **Insertable Streams** / `MediaStreamTrackProcessor` in Worker (OffscreenCanvas + WebGL)
3. WebGPU segmentation tier when available (Meet v2 direction)
4. Stronger temporal mask smoothing (ring buffer 3–5 frames — partial today via EMA)

### Phase 4 — Product polish

- In-call blur toggle (not only pre-join)
- Degrade gracefully: blur fails → sharp camera, toast, no black video
- Mobile Safari testing matrix

---

## Blur test matrix

| # | Steps | Pass | Logs |
|---|-------|------|------|
| B1 | Join with blur ON; remote should see blurred video within 3s | Remote video visible + blurred | `blur_warmup` warmed:true, `video_published` publishedSource:camera |
| B2 | Toggle cam OFF then ON (blur user) | Remote stays blurred | `toggle_cam_blur_unmute`, same `pubTrackId` |
| B3 | Pre-join blur ON → join | No black flash; blur continuous | `blur_first_frame` before `video_published` |
| B4 | 5 min call with blur | No drift local vs remote | No second `video_published`; `pubCount` stays 1 |

---

## Debug log cheat sheet

| message | scenario | Meaning |
|---------|----------|---------|
| `blur_first_frame` | B1 | Compositor drew first frame |
| `blur_warmup` | B1 | Join waited for warm-up |
| `video_published` | B1 | Track sent to LiveKit |
| `toggle_cam_start` | B2 | Shows pubSource, pubTrackId, pubCount |
| `toggle_cam_blur_unmute` | B2 | Blur path used (not setCameraEnabled) |

Log file: `.cursor/debug-b87613.log` · Two tabs on **same machine** as dev server.
