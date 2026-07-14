"use client";

import React, { useEffect, useRef } from "react";
import type { CallSessionDetail } from "@/types/calls";
import {
  computeDisplayedProgress,
  getProcessingPhase,
  hasLiveTranscript,
  processingStatusMessage,
  stepLabelForCall,
  type ProcessingPhase,
} from "@/lib/calls/processingDisplay";
import { readProcessingProgress } from "@/lib/calls/processingProgress";
import { callExitPendingFloorPercent } from "@/lib/calls/callExitPending";
import type { CallSessionRow } from "@/types/calls";

const UPLOAD_STUCK_MS = 120_000;
const GEMINI_STUCK_MS = 240_000;

function stuckThresholdForPhase(phase: ProcessingPhase): number {
  if (phase === "uploading") return UPLOAD_STUCK_MS;
  if (phase === "analyzing") return GEMINI_STUCK_MS;
  return 180_000;
}

function ProcessingProgressFill({
  percent,
  className,
}: {
  percent: number;
  className: string;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fillRef.current?.style.setProperty("--progress-pct", `${percent}%`);
  }, [percent]);
  return (
    <div
      ref={fillRef}
      className={`h-full w-[var(--progress-pct,0%)] rounded-full ${className}`}
    />
  );
}

export interface CallProcessingProgressProps {
  call: CallSessionDetail;
  callId: string;
  phaseStartedAt: number | null;
  isStuck: boolean;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
}

export function CallProcessingProgress({
  call,
  callId,
  phaseStartedAt,
  isStuck,
  retrying,
  retryError,
  onRetry,
}: CallProcessingProgressProps) {
  const phase = getProcessingPhase(call);
  const percent = computeDisplayedProgress(call, callId, phaseStartedAt);
  const stepLabel = stepLabelForCall(call);
  const live = hasLiveTranscript(call);

  return (
    <div className="w-full p-5 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{stepLabel}</p>
        <span className="text-sm font-bold tabular-nums text-blue-200">
          {percent}%
        </span>
      </div>

      <div
        className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Post-call processing progress"
      >
        <ProcessingProgressFill
          percent={percent}
          className="bg-blue-500 transition-[width] duration-500 ease-out"
        />
      </div>

      <p className="text-sm text-blue-200/90 leading-relaxed">
        {processingStatusMessage(phase, live)}
      </p>

      {isStuck && (
        <div className="space-y-2 pt-1">
          <p className="text-amber-300 text-xs">
            This step is taking longer than usual (over{" "}
            {Math.round(stuckThresholdForPhase(phase) / 60_000)} min). You can
            wait or retry processing — your recording is kept if upload already
            finished.
          </p>
          {retryError && (
            <p className="text-red-400 text-xs">{retryError}</p>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Retry AI processing"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Thin bar for calls history list rows. */
export function CallProcessingProgressMiniRow({ call }: { call: CallSessionRow }) {
  const percent = Math.min(
    99,
    Math.max(
      readProcessingProgress(call.metadata as Record<string, unknown>),
      callExitPendingFloorPercent(call.id),
    ),
  );
  return (
    <div className="mt-2 space-y-1 max-w-xs">
      <div className="flex justify-between text-[10px] text-text-secondary">
        <span>Processing</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
        <ProcessingProgressFill
          percent={percent}
          className="bg-blue-500/80 transition-[width] duration-500"
        />
      </div>
    </div>
  );
}
