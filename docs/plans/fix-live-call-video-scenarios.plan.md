# Live call video — targeted fix plan (scenario-driven)

Debug session: `b87613` · Log file: `.cursor/debug-b87613.log`

Each scenario has instrumentation tagged `S1`–`S7`. Run the test matrix, then read NDJSON logs to confirm which hypothesis applies before applying the matching fix.

---

## S1 — Periodic / all-tile blinking (no user action)

**Symptoms:** Remote tiles flash black every few seconds; all participants affected.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S1-A | Mass-sync effect re-runs without track change | `mass_sync` with same `identityCount`, followed by `attach_dom_replace` not `attach_skip` | Narrow mass-sync deps: only run full grid sync when `remoteIdentities` length/order changes; presenter-only sync when only `remotePresenterIdentity` changes |
| S1-B | Idempotent attach bypassed (track swapped) | `attach_dom_replace` + `swappedTrack: true` during idle call | Fix upstream: stop clearing containers before re-attach; ensure same track object in `remoteTracksRef` |
| S1-C | Sync polling re-render triggers ref remount | `mass_sync` correlated with `sync polled` timestamps | Debounce mass-sync; ensure `RemoteVideoTile` ref stable (already is — verify no key changes on grid) |

**Pass criteria:** 5+ min two-user call → zero `attach_dom_replace` unless track actually changes.

---

## S2 — Blink when someone starts/stops screen share

**Symptoms:** Layout switches to presenter mode; all tiles flash once or repeatedly.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S2-A | Expected layout switch mass-sync | `presenter_change` + `mass_sync` once at share start/end | Accept one flash; ensure all subsequent attaches are `attach_skip` |
| S2-B | Presenter identity flaps | Multiple `presenter_change` within 2s | Guard `setRemotePresenterIdentity`: ignore camera-only updates while `screenShare` slot exists |
| S2-C | Camera slot cleared on unrelated unsub | `track_unsubscribed` slot `camera` while `hasScreenShare: true` + `clear` on presenter | Skip camera tile clear when presenter still has active screen share |

**Pass criteria:** Share 2 min → at most one `mass_sync` burst at start/end; no repeated `presenter_change` loop.

---

## S3 — Tile black / blink when tab loses focus

**Symptoms:** User tabs away; their tile or everyone’s tiles go black; blink on return.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S3-A | LiveKit adaptiveStream unsubscribes remote tracks | `track_unsubscribed` while `document.hidden` or shortly after `tab_visible` | Debounce unsubscribe cleanup (300–500ms); re-subscribe without `replaceChildren` if same track returns |
| S3-B | Tab return mass-sync | `tab_visible` → `mass_sync` + many `attach_dom_replace` | On visibility: sync only local preview + tiles with missing video element |
| S3-C | Blur draw loop stalled | `blur_visibility_restart` without following `local_preview_sync` | Already restarts draw loop; extend `recoverLocalMediaPreview` on visibility (verify via logs) |

**Pass criteria:** Tab away 30s → remote users see freeze (acceptable); no all-tile blink on return.

---

## S4 — Local camera black after screen share ends

**Symptoms:** Presenter stops sharing; local preview stays black until camera toggle.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S4-A | `LocalTrackUnpublished` not firing | `screen_share_stop` without `recover_local` | Call `recoverLocalMediaPreview()` explicitly in `stopScreenShare` after `setScreenShareEnabled(false)` |
| S4-B | Recovery runs but wrong track | `recover_local` + `local_preview_sync` with `source: screenShare` or `track: null` | Fix `syncLocalPreview` to prefer camera publication after share ends |
| S4-C | Blur reconnect fails silently | `recover_local` + `blurReconnect: false` | On failure, fall back to raw track or `setCameraEnabled(true)` |

**Pass criteria:** Stop share → `recover_local` + `local_preview_sync` with `source: camera` within 1s; no toggle needed.

---

## S5 — Camera track dead (`readyState: ended`)

**Symptoms:** After share or long call, camera toggle is only recovery path.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S5-A | Raw MST ended | `recover_local` with `rawReadyState: ended` | Auto `createLocalVideoTrack` + republish or `setCameraEnabled(true)` |
| S5-B | Published blur track ended | `publishedReadyState: ended` while raw live | Recreate blur processor from fresh raw track |
| S5-C | UI `camOn` out of sync | `TrackMuted` without matching `camOn` update | Sync `camOn` from publication state after recovery |

**Pass criteria:** No `rawReadyState: ended` after normal share stop; if present, auto-recovery succeeds without user toggle.

---

## S6 — Captions / STT causing grid flicker

**Symptoms:** With AI enabled, tiles blink as captions update.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S6-A | Parent re-render triggers mass-sync | `stt_segment` followed by `mass_sync` within 100ms | Remove `call.participants` from `handleTranscriptionSegment` deps; use ref for speaker lookup |
| S6-B | `setLocalSession` causes layout remount | `stt_segment` + `attach_dom_replace` on remotes | Move transcript append to ref-only path; batch UI updates |
| S6-C | Host `pushLocalLivePayload` triggers child updates | Correlation only on host | Already isolated sidebar; verify no grid impact |

**Pass criteria:** Active captions 2 min → zero `mass_sync` correlated with `stt_segment`.

---

## S7 — Pip ↔ full minimize blink loop

**Symptoms:** Minimizing or expanding call causes repeated blinking.

| ID | Hypothesis | Log signal | Fix (apply if CONFIRMED) |
|----|------------|------------|---------------------------|
| S7-A | Layout remount without RTC restore | `pip_persist` without matching `pip_restore` | Fix remount detection in cleanup effect |
| S7-B | Restore re-subscribes all tracks | `pip_restore` + N × `track_subscribed` + N × `attach_dom_replace` | After restore, idempotent attach should skip; if not, persist `remoteTracksRef` in rtcHolder |
| S7-C | Duplicate `setupRoomListeners` | Double events after restore | Ensure teardown before setup on restore (already named handlers) |

**Pass criteria:** Pip toggle 3× → single attach burst per toggle; no loop.

---

## Test matrix (run in order)

Use **two tabs on the same machine** so logs reach `127.0.0.1:7562`.

| # | Scenario | Steps | Primary logs |
|---|----------|-------|--------------|
| 1 | S1 idle | 2 users, 5 min, no interaction | `mass_sync`, `attach_*` |
| 2 | S2 share | User A shares screen 2 min, stops | `presenter_change`, `track_subscribed/unsubscribed` |
| 3 | S3 tab | User A background tab 30s, return | `tab_hidden/visible`, `track_unsubscribed` |
| 4 | S4 share cam | A shares, stops; check A local preview | `screen_share_*`, `recover_local`, `local_preview_sync` |
| 5 | S5 blur | Repeat #4 with blur enabled | `rawReadyState`, `blurReconnect` |
| 6 | S6 STT | AI call, speak 2 min | `stt_segment` vs `mass_sync` timing |
| 7 | S7 pip | Minimize/expand call 3× | `pip_persist`, `pip_restore` |

---

## Implementation order (after log review)

1. **S4-A** — explicit recovery in `stopScreenShare` (low risk, common report)
2. **S5-A** — dead track auto-republish (if logs show `ended`)
3. **S3-A** — debounced unsubscribe cleanup (if adaptiveStream churn)
4. **S1-A / S2-B** — narrow mass-sync / presenter guards (if idle blinking)
5. **S6-A** — transcription dep cleanup (if STT correlation)
6. **S7-B** — persist track map across pip (if restore re-attaches all)

Do **not** remove instrumentation until all failed scenarios pass verification runs.
