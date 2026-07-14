export const CALL_RECORDINGS_BUCKET = "call-recordings";

export const CALL_MAX_PARTICIPANTS = parseInt(
  process.env.CALL_MAX_PARTICIPANTS ?? "50",
  10,
);

export const CALL_MAX_DURATION_MINUTES = parseInt(
  process.env.CALL_MAX_DURATION_MINUTES ?? "120",
  10,
);

export const CALL_AI_RATE_LIMIT_PER_DAY = 10;

export const CALL_IDLE_GRACE_MS = 5_000;

/** Participants still marked active long after max call duration are treated as disconnected. */
export const CALL_STALE_PARTICIPANT_MS =
  (CALL_MAX_DURATION_MINUTES + 15) * 60 * 1000;

/** Abandoned lobby calls (never joined) are cancelled after this. */
export const CALL_STALE_LOBBY_MS = 24 * 60 * 60 * 1000;

export const RECORDING_UPLOAD_FALLBACK_MS = 90_000;

export const CALL_TOKEN_EXPIRE_SECONDS = 86_400;

export function isCallRecordingEnabled(): boolean {
  return process.env.CALL_RECORDING_ENABLED !== "false";
}

export function isCallAiEnabled(): boolean {
  return process.env.CALL_AI_ENABLED !== "false";
}

/** Dev-only: homelab STT captions without Gemini live notes/tasks. */
export function isCallDevSttOnly(): boolean {
  return process.env.NEXT_PUBLIC_CALL_DEV_STT_ONLY === "true";
}

export function isCallDevSttOnlyServer(): boolean {
  return process.env.CALL_DEV_STT_ONLY === "true";
}

/** LiveKit room name (`ow_<callIdHex>`). */
export function roomNameForCall(_workspaceId: string, callId: string): string {
  return `ow_${callId.replace(/-/g, "")}`;
}
