"use client";

import {
  fullTextFromSegments,
  upsertTranscriptSegment,
} from "@/lib/calls/transcriptSegments";
import type {
  CallLivePayload,
  LiveNote,
  TranscriptSegment,
} from "@/types/calls";
import type { DraftTaskInput } from "@/lib/ai/meetingTools";

export const LOCAL_CALL_SESSION_VERSION = 1 as const;

export type LocalTasksPipelineStage =
  | "idle"
  | "hearing"
  | "compiling"
  | "creating"
  | "ready";

export interface LocalPendingTask extends DraftTaskInput {
  localId: string;
}

export interface LocalCallSession {
  v: typeof LOCAL_CALL_SESSION_VERSION;
  segments: TranscriptSegment[];
  summary: string | null;
  keyDecisions: string[];
  liveNotes: LiveNote[];
  pendingTasks: LocalPendingTask[];
  lastAiAt: number | null;
  lastAiCharCount: number;
  dirty: boolean;
  aiRunning: boolean;
}

export interface LiveAiDeltaResponse {
  summary: string;
  keyDecisions: string[];
  liveNotes: LiveNote[];
  actionItems: DraftTaskInput[];
  tasksPipelineStage: LocalTasksPipelineStage;
  geminiConfigured: boolean;
}

/** Minimum transcript length before calling live meeting AI. */
export const LIVE_AI_MIN_CHARS = 12;

/** Minimum new chars since last notes pass before re-running (unless interval elapsed). */
export const LIVE_NOTES_MIN_NEW_CHARS = 80;

/** Minimum ms between live notes model gateway calls (~60s cadence). */
export const LIVE_NOTES_MIN_INTERVAL_MS = 55_000;

function storageKey(callId: string): string {
  return `ow-call-live:${callId}`;
}

export function emptyLocalCallSession(): LocalCallSession {
  return {
    v: LOCAL_CALL_SESSION_VERSION,
    segments: [],
    summary: null,
    keyDecisions: [],
    liveNotes: [],
    pendingTasks: [],
    lastAiAt: null,
    lastAiCharCount: 0,
    dirty: false,
    aiRunning: false,
  };
}

export function loadLocalCallSession(callId: string): LocalCallSession {
  if (typeof window === "undefined") return emptyLocalCallSession();
  try {
    const raw = sessionStorage.getItem(storageKey(callId));
    if (!raw) return emptyLocalCallSession();
    const parsed = JSON.parse(raw) as Partial<LocalCallSession>;
    if (parsed.v !== LOCAL_CALL_SESSION_VERSION) return emptyLocalCallSession();
    return {
      ...emptyLocalCallSession(),
      ...parsed,
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      keyDecisions: Array.isArray(parsed.keyDecisions)
        ? parsed.keyDecisions
        : [],
      liveNotes: Array.isArray(parsed.liveNotes) ? parsed.liveNotes : [],
      pendingTasks: Array.isArray(parsed.pendingTasks)
        ? parsed.pendingTasks
        : [],
    };
  } catch {
    return emptyLocalCallSession();
  }
}

export function saveLocalCallSession(
  callId: string,
  session: LocalCallSession,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(callId), JSON.stringify(session));
  } catch {
    /* quota */
  }
}

export function clearLocalCallSession(callId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(storageKey(callId));
}

export function appendLocalSegment(
  callId: string,
  session: LocalCallSession,
  segment: TranscriptSegment,
): LocalCallSession {
  const segments = upsertTranscriptSegment(session.segments, segment);
  const next: LocalCallSession = {
    ...session,
    segments,
    dirty: true,
  };
  saveLocalCallSession(callId, next);
  return next;
}

export function mergeLocalAiDelta(
  callId: string,
  session: LocalCallSession,
  delta: LiveAiDeltaResponse,
  opts?: { elapsedMs?: number },
): LocalCallSession {
  const nowMs = opts?.elapsedMs ?? Date.now();
  const newNotes: LiveNote[] = (delta.liveNotes ?? []).map((n) => ({
    at_ms: typeof n === "object" && n != null && "at_ms" in n ? n.at_ms : nowMs,
    text: (typeof n === "string" ? n : String(n.text ?? "")).trim().slice(0, 500),
  }));

  const mergedNotes = [...session.liveNotes, ...newNotes].slice(-80);
  const text = fullTextFromSegments(session.segments) ?? "";
  const charCount = text.length;

  const next: LocalCallSession = {
    ...session,
    summary: delta.summary || session.summary,
    keyDecisions: delta.keyDecisions?.length
      ? delta.keyDecisions
      : session.keyDecisions,
    liveNotes: mergedNotes,
    lastAiAt: Date.now(),
    lastAiCharCount: charCount,
    dirty: true,
    aiRunning: false,
  };
  saveLocalCallSession(callId, next);
  return next;
}

export function localTranscriptText(session: LocalCallSession): string {
  return fullTextFromSegments(session.segments) ?? "";
}

export function shouldRunLocalLiveNotes(session: LocalCallSession): boolean {
  if (session.aiRunning) return false;
  const text = localTranscriptText(session);
  if (!text.trim()) return false;
  const charCount = text.length;
  if (charCount < LIVE_AI_MIN_CHARS) return false;
  if (!session.lastAiAt) return true;
  const elapsed = Date.now() - session.lastAiAt;
  const newChars = charCount - session.lastAiCharCount;
  if (elapsed >= LIVE_NOTES_MIN_INTERVAL_MS) return true;
  if (newChars >= LIVE_NOTES_MIN_NEW_CHARS && elapsed >= LIVE_NOTES_MIN_INTERVAL_MS / 2) {
    return true;
  }
  return false;
}

/** @deprecated Use shouldRunLocalLiveNotes — live tasks are extracted at call end only. */
export function shouldRunLocalLiveAi(
  session: LocalCallSession,
  opts?: { force?: boolean },
): boolean {
  if (opts?.force) return shouldRunLocalLiveNotes(session);
  return shouldRunLocalLiveNotes(session);
}

/** Merge local session into a live payload skeleton (stt_status from initial server load). */
export function buildLivePayloadFromLocal(
  session: LocalCallSession,
  base: CallLivePayload | null,
  opts?: {
    pipelineStage?: LocalTasksPipelineStage;
    aiRunning?: boolean;
  },
): CallLivePayload {
  const segments = session.segments;
  const fullText = fullTextFromSegments(segments);
  const baseTr = base?.transcript;
  const baseArt = base?.artifact;

  let pipelineStage: LocalTasksPipelineStage =
    opts?.pipelineStage ??
    (session.pendingTasks.length > 0
      ? "ready"
      : segments.length > 0
        ? "hearing"
        : "idle");

  return {
    transcript: {
      id: baseTr?.id ?? "local",
      full_text: fullText || null,
      segments,
      status: baseTr?.status ?? "processing",
    },
    artifact: {
      id: baseArt?.id ?? "local",
      summary: session.summary,
      key_decisions: session.keyDecisions,
      live_notes: session.liveNotes,
      status: baseArt?.status ?? "processing",
    },
    reviews: base?.reviews ?? [],
    stt_status: base?.stt_status,
    ai_status: {
      geminiConfigured: base?.ai_status?.geminiConfigured ?? true,
      artifactStatus: baseArt?.status ?? null,
      pendingTaskCount:
        session.pendingTasks.length + (base?.reviews?.length ?? 0),
      lastAiRunAt: session.lastAiAt
        ? new Date(session.lastAiAt).toISOString()
        : null,
      liveAiRunning: opts?.aiRunning ?? session.aiRunning,
      tasksPipelineStage: pipelineStage,
    },
  };
}

export function localSessionToFlushBody(session: LocalCallSession) {
  return {
    segments: session.segments,
    summary: session.summary,
    keyDecisions: session.keyDecisions,
    liveNotes: session.liveNotes,
    pendingTasks: session.pendingTasks.map(
      ({ localId: _localId, ...task }) => task,
    ),
  };
}
