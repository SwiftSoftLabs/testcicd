import { callExitPendingFloorPercent } from "@/lib/calls/callExitPending";
import { readProcessingProgress, readProcessingStepLabel } from "@/lib/calls/processingProgress";
import type { CallSessionDetail } from "@/types/calls";

export type ProcessingPhase = "uploading" | "analyzing" | "summarizing";

export function serverProcessingPhase(
  call: CallSessionDetail,
): ProcessingPhase | null {
  const phase = (call.metadata as { processing_phase?: string } | undefined)
    ?.processing_phase;
  if (phase === "waiting_upload" || phase === "ending") return "uploading";
  if (phase === "analyzing_recording") return "analyzing";
  if (phase === "summarizing") return "summarizing";
  return null;
}

export function hasLiveTranscript(call: CallSessionDetail): boolean {
  const text = call.transcript?.full_text?.trim() ?? "";
  if (text.length > 0) return true;
  const segs = call.transcript?.segments ?? [];
  return segs.some((s) => s.text?.trim());
}

export function getProcessingPhase(call: CallSessionDetail): ProcessingPhase {
  const fromServer = serverProcessingPhase(call);
  if (fromServer) return fromServer;
  if (call.recording_enabled && call.recording?.status === "recording") {
    return "uploading";
  }
  if (
    call.recording_enabled &&
    call.recording?.status === "uploaded" &&
    call.status === "processing"
  ) {
    return "analyzing";
  }
  return "summarizing";
}

const PHASE_CEILING: Record<ProcessingPhase, number> = {
  uploading: 45,
  analyzing: 75,
  summarizing: 92,
};

export function processingStatusMessage(
  phase: ProcessingPhase,
  hasLive: boolean,
): string {
  switch (phase) {
    case "uploading":
      return hasLive
        ? "Your meeting summary is ready from the live transcript. The recording is still uploading in the background."
        : "Uploading the call recording from your browser. Summary will finish once upload completes or live notes are available.";
    case "analyzing":
      return hasLive
        ? "Refining the summary from your recording. Live notes are already on this page."
        : "Transcribing the recording with Whisper and preparing the summary. This usually takes 1–3 minutes.";
    default:
      return "Finishing the meeting summary and action items.";
  }
}

export function stepLabelForCall(call: CallSessionDetail): string {
  const fromMeta = readProcessingStepLabel(
    call.metadata as Record<string, unknown>,
  );
  if (fromMeta) return fromMeta;
  switch (getProcessingPhase(call)) {
    case "uploading":
      return "Uploading recording";
    case "analyzing":
      return "Analyzing recording";
    default:
      return "Writing summary";
  }
}

/**
 * Displayed percent: server truth + exit-pending floor + soft creep between polls.
 */
export function computeDisplayedProgress(
  call: CallSessionDetail,
  callId: string,
  phaseStartedAt: number | null,
): number {
  const server = readProcessingProgress(call.metadata as Record<string, unknown>);
  const floor = callExitPendingFloorPercent(callId);
  let display = Math.max(server, floor);

  if (call.status === "processing" && phaseStartedAt != null) {
    const elapsed = Date.now() - phaseStartedAt;
    const phase = getProcessingPhase(call);
    const ceiling = PHASE_CEILING[phase];
    const creepRate = 0.015;
    const creep = Math.min(
      ceiling - display,
      (elapsed / 1000) * creepRate,
    );
    display = Math.min(ceiling, display + Math.max(0, creep));
  }

  return Math.min(99, Math.round(display));
}
