import { query, SCHEMA } from "@/lib/db";
import type { CallProcessingPhase } from "@/lib/calls/callGeminiPostProcess";

export const PROCESSING_MILESTONES = {
  ending: 8,
  savingTranscript: 15,
  uploadBandMin: 15,
  uploadBandMax: 45,
  uploadReceived: 40,
  finalAiStart: 48,
  finalAiDone: 55,
  analyzingRecording: 70,
  summarizing: 88,
  completing: 95,
  done: 100,
  failed: 0,
} as const;

export type CoarseProcessingPhase =
  | "ending"
  | CallProcessingPhase;

export interface SetProcessingProgressOpts {
  phase?: CoarseProcessingPhase;
  stepLabel?: string;
}

/** Maps upload bytes 0–1 into the 15–45% band. */
export function uploadProgressPercent(ratio: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  const { uploadBandMin, uploadBandMax } = PROCESSING_MILESTONES;
  return Math.round(uploadBandMin + r * (uploadBandMax - uploadBandMin));
}

/**
 * Monotonic processing progress in call_sessions.metadata.
 * Never decreases processing_progress.
 */
export async function setCallProcessingProgress(
  callId: string,
  percent: number,
  opts?: SetProcessingProgressOpts,
): Promise<void> {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const patch: Record<string, unknown> = {
    processing_progress: clamped,
  };
  if (opts?.phase) patch.processing_phase = opts.phase;
  if (opts?.stepLabel) patch.processing_step_label = opts.stepLabel;

  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET metadata = metadata
         || $2::jsonb
         || jsonb_build_object(
           'processing_progress',
           GREATEST(COALESCE((metadata->>'processing_progress')::int, 0), $3::int)
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [callId, JSON.stringify(patch), clamped],
  );
}

export function readProcessingProgress(
  metadata: Record<string, unknown> | null | undefined,
): number {
  const raw = metadata?.processing_progress;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.min(100, Math.max(0, n));
  }
  return 0;
}

export function readProcessingStepLabel(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const label = metadata?.processing_step_label;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}
