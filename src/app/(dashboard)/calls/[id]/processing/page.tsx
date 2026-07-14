"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { api, isInsforgeRateLimited } from "@/lib/api";
import { clearCallExitPending } from "@/lib/calls/callExitPending";
import { getProcessingPhase } from "@/lib/calls/processingDisplay";
import { CallProcessingProgress } from "@/components/calls/CallProcessingProgress";
import type { CallSessionDetail } from "@/types/calls";

function stuckThreshold(phase: ReturnType<typeof getProcessingPhase>): number {
  if (phase === "uploading") return 120_000;
  if (phase === "analyzing") return 240_000;
  return 180_000;
}

function CallProcessingContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [call, setCall] = useState<CallSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const processingStartRef = useRef<number | null>(null);
  const processingPhaseRef = useRef<ReturnType<typeof getProcessingPhase> | null>(
    null,
  );
  const resumeKickoffRef = useRef(false);
  const liveStuckSinceRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.calls.get(id);
      setCall(data);

      if (data.status === "completed") {
        clearCallExitPending(id);
        router.replace(`/calls/${id}`);
        return;
      }

      if (data.status === "processing") {
        const phase = getProcessingPhase(data);
        if (processingPhaseRef.current !== phase) {
          processingPhaseRef.current = phase;
          processingStartRef.current = Date.now();
        }
        const elapsed =
          Date.now() - (processingStartRef.current ?? Date.now());
        setIsStuck(elapsed > stuckThreshold(phase));
      } else {
        processingStartRef.current = null;
        processingPhaseRef.current = null;
        setIsStuck(false);
      }

      if (["live", "lobby"].includes(data.status)) {
        if (liveStuckSinceRef.current == null) {
          liveStuckSinceRef.current = Date.now();
        } else if (Date.now() - liveStuckSinceRef.current > 30_000) {
          setIsStuck(true);
        }
      } else {
        liveStuckSinceRef.current = null;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!call || call.status !== "processing" || resumeKickoffRef.current) return;
    resumeKickoffRef.current = true;
    void api.calls.resumeProcessing(id).catch(() => undefined);
  }, [call?.status, id]);

  useEffect(() => {
    if (!call) return;
    const waitingForRecording =
      call.recording_enabled &&
      call.recording?.status === "recording" &&
      !["live", "lobby"].includes(call.status);
    const TRANSIENT = ["live", "lobby", "processing"];
    if (!TRANSIENT.includes(call.status) && !waitingForRecording) {
      if (call.status === "failed" || call.status === "cancelled") {
        router.replace(`/calls/${id}`);
      }
      return;
    }
    const intervalMs = waitingForRecording
      ? 2_000
      : call.status === "processing"
        ? 4_000
        : 4_000;
    const timer = setInterval(() => {
      if (isInsforgeRateLimited()) return;
      void load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [call, load, id, router]);

  const handleRetryAi = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.calls.resumeProcessing(id, true);
      processingStartRef.current = Date.now();
      await load();
    } catch (e: unknown) {
      setRetryError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const handleRetryEnd = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.calls.endCall(id);
      await load();
    } catch (e: unknown) {
      setRetryError(e instanceof Error ? e.message : "Could not end call");
    } finally {
      setRetrying(false);
    }
  };

  const whenLabel = call?.ended_at ?? call?.started_at ?? call?.created_at;

  return (
    <div className="flex flex-1 min-h-0 h-full w-full items-center justify-center overflow-y-auto p-4 sm:p-6">
      <div className="w-full max-w-lg flex flex-col items-center text-center">
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : !call ? (
          <p className="text-text-secondary text-sm">Loading…</p>
        ) : (
          <>
            <Link
              href="/calls?tab=history"
              className="text-sm text-text-secondary hover:text-white mb-6 self-start"
            >
              ← Back to Calls
            </Link>

            <h1 className="text-2xl font-bold text-white mb-1 w-full">
              {call.title}
            </h1>
            {whenLabel && (
              <p className="text-xs text-text-secondary mb-6 w-full">
                Ended {format(new Date(whenLabel), "MMM d, yyyy · h:mm a")}
              </p>
            )}

            <p className="text-sm text-text-secondary mb-6 w-full">
              You can use other parts of OneWork while we finish this call.
              Return here anytime to watch progress.
            </p>

            <div className="w-full">
              {call.status === "failed" ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200 space-y-3 text-left">
                  <p>Processing failed for this call.</p>
                  <Link
                    href={`/calls/${id}`}
                    className="inline-block text-xs font-bold text-red-300 hover:text-red-200"
                  >
                    View call details →
                  </Link>
                </div>
              ) : null}

              {["live", "lobby"].includes(call.status) ? (
                <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-100 space-y-3 text-left">
                  <p>Still wrapping up the call on the server…</p>
                  <CallProcessingProgress
                    call={{
                      ...call,
                      status: "processing",
                      metadata: {
                        ...call.metadata,
                        processing_progress: 5,
                        processing_step_label: "Wrapping up",
                      },
                    }}
                    callId={id}
                    phaseStartedAt={processingStartRef.current}
                    isStuck={isStuck}
                    retrying={retrying}
                    retryError={retryError}
                    onRetry={() => void handleRetryEnd()}
                  />
                </div>
              ) : call.status === "processing" ? (
                <CallProcessingProgress
                  call={call}
                  callId={id}
                  phaseStartedAt={processingStartRef.current}
                  isStuck={isStuck}
                  retrying={retrying}
                  retryError={retryError}
                  onRetry={() => void handleRetryAi()}
                />
              ) : (
                <p className="text-sm text-text-secondary">Redirecting…</p>
              )}
            </div>

            <Link
              href={`/calls/${id}`}
              className="mt-6 text-sm text-text-secondary hover:text-white"
            >
              View call details (partial results may appear)
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function CallProcessingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 min-h-0 h-full w-full items-center justify-center p-6">
          <p className="text-text-secondary text-sm">Loading…</p>
        </div>
      }
    >
      <CallProcessingContent />
    </Suspense>
  );
}
