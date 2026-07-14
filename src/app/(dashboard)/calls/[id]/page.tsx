"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { format } from "date-fns";
import { api, isInsforgeRateLimited } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { MeetingReviewQueue } from "@/components/calls/MeetingReviewQueue";
import type { CallSessionDetail, MeetingTaskReviewRow } from "@/types/calls";
import {
  buildRecurrenceDescriptionNote,
  type RecurrenceFrequency,
} from "@/lib/calls/recurrence";
import { callRoomHref } from "@/lib/calls/joinSession";
const POLL_INTERVAL_MS = 4_000;

const STATUS_LABEL: Record<string, string> = {
  lobby: "Waiting for participants",
  scheduled: "Scheduled",
  live: "Live",
  processing: "Processing…",
  completed: "Completed",
  failed: "Processing failed",
  cancelled: "Cancelled",
};

export default function CallDetailPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6 text-text-secondary text-sm">Loading call…</p>
      }
    >
      <CallDetailContent />
    </Suspense>
  );
}

function CallDetailContent() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const detailFrom =
    pathname +
    (searchParams.toString() ? `?${searchParams.toString()}` : "");
  const { currentUser } = useAppContext();
  const [call, setCall] = useState<CallSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState(false);
  const [deleteRecordingModalOpen, setDeleteRecordingModalOpen] =
    useState(false);
  const [deleteCallModalOpen, setDeleteCallModalOpen] = useState(false);
  const [deletingCall, setDeletingCall] = useState(false);
  const [storageLimitModalOpen, setStorageLimitModalOpen] = useState(false);
  const [exportingSummary, setExportingSummary] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [callReviews, setCallReviews] = useState<MeetingTaskReviewRow[]>([]);
  const load = useCallback(async () => {
    try {
      const data = await api.calls.get(id);
      setCall(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (call?.status === "processing") {
      router.replace(`/calls/${id}/processing`);
    }
  }, [call?.status, id, router]);

  useEffect(() => {
    if (searchParams.get("billing") === "storage") {
      setStorageLimitModalOpen(true);
      router.replace(`/calls/${id}`, { scroll: false });
    }
  }, [searchParams, router, id]);

  useEffect(() => {
    if (!call) return;
    if (["lobby", "live", "scheduled"].includes(call.status)) {
      setCallReviews([]);
      return;
    }
    void api.calls
      .reviewsForCall(id, 50)
      .then(setCallReviews)
      .catch(() => setCallReviews([]));
  }, [call?.status, call?.pending_review_count, id]);

  useEffect(() => {
    if (!call) return;
    const waitingForRecording =
      call.recording_enabled &&
      call.recording?.status === "recording" &&
      !["live", "lobby"].includes(call.status);
    const TRANSIENT = ["lobby", "live"];
    if (!TRANSIENT.includes(call.status) && !waitingForRecording) return;
    const intervalMs = waitingForRecording ? 2_000 : POLL_INTERVAL_MS;
    const timer = setInterval(() => {
      if (isInsforgeRateLimited()) return;
      void load();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [call, load]);

  const confirmDeleteRecording = async () => {
    setDeletingRecording(true);
    setDeleteRecordingModalOpen(false);
    try {
      await api.calls.deleteRecording(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete recording");
    } finally {
      setDeletingRecording(false);
    }
  };

  const confirmDeleteCall = async () => {
    setDeletingCall(true);
    setDeleteCallModalOpen(false);
    try {
      await api.calls.deleteCall(id);
      router.push("/calls?tab=history");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete call");
    } finally {
      setDeletingCall(false);
    }
  };

  const handleRetryAi = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.calls.resumeProcessing(id, true);
      await load();
    } catch (e: unknown) {
      setRetryError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const handleExportSummary = async () => {
    setExportingSummary(true);
    setExportMessage(null);
    try {
      const r = await api.calls.exportSummaryMarkdown(id);
      setExportMessage(`Saved as “${r.file_name}” in Files → Meeting-Summary.`);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setExportMessage(msg);
    } finally {
      setExportingSummary(false);
    }
  };

  if (error) return <p className="p-6 text-red-400">{error}</p>;
  if (!call) return <p className="p-6 text-text-secondary">Loading…</p>;

  const isHost = currentUser?.id === call.created_by;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  const storageSkipped =
    typeof meta.post_call_skipped_reason === "string" &&
    meta.post_call_skipped_reason === "storage_limit";
  const meetingDescriptionRaw = meta.meeting_description;
  const meetingDescription =
    typeof meetingDescriptionRaw === "string"
      ? meetingDescriptionRaw.trim()
      : "";

  const whenLabel = (() => {
    if (call.status === "scheduled" && call.scheduled_start_at) {
      return call.scheduled_start_at;
    }
    if (call.ended_at) return call.ended_at;
    if (call.started_at) return call.started_at;
    return call.created_at;
  })();

  const recurrenceFrequency =
    typeof meta.recurrence_frequency === "string"
      ? (meta.recurrence_frequency as RecurrenceFrequency)
      : null;
  const recurrenceUntil =
    typeof meta.recurrence_until === "string" ? meta.recurrence_until : null;
  const recurrenceIndex =
    typeof meta.recurrence_index === "number" ? meta.recurrence_index : undefined;
  const recurrenceTotal =
    typeof meta.recurrence_total === "number" ? meta.recurrence_total : undefined;
  const recurrenceType =
    typeof meta.recurrence_type === "string" ? meta.recurrence_type : null;

  const recurrenceLabel =
    recurrenceType === "recurring" && recurrenceFrequency
      ? buildRecurrenceDescriptionNote(
          recurrenceFrequency,
          recurrenceUntil,
          recurrenceIndex,
          recurrenceTotal,
        )
      : recurrenceType === "one_time"
        ? "One-time meeting"
        : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 sm:p-6 max-w-3xl">
      <Link
        href="/calls?tab=history"
        className="text-sm text-text-secondary hover:text-white mb-4"
      >
        ← Back to Calls
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h1 className="text-2xl font-bold text-white">{call.title}</h1>
        {isHost &&
          ["completed", "failed", "processing"].includes(call.status) && (
            <button
              type="button"
              disabled={deletingCall}
              onClick={() => setDeleteCallModalOpen(true)}
              className="cursor-pointer text-xs font-bold text-red-400 hover:text-red-300 border border-red-500/40 rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              Delete history
            </button>
          )}
      </div>
      {whenLabel && (
        <div className="mb-4 space-y-1">
          <p className="text-xs text-text-secondary">
            {call.status === "scheduled"
              ? "Scheduled for"
              : call.ended_at
                ? "Ended"
                : call.started_at
                  ? "Started"
                  : "Created"}{" "}
            {format(new Date(whenLabel), "MMM d, yyyy · h:mm a")}
          </p>
          {call.status === "scheduled" && call.scheduled_end_at && (
            <p className="text-xs text-text-secondary">
              Until {format(new Date(call.scheduled_end_at), "MMM d, yyyy · h:mm a")}
            </p>
          )}
        </div>
      )}

      {meetingDescription ? (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">
            Description
          </h2>
          <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
            {meetingDescription}
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            call.status === "live"
              ? "bg-green-500/20 text-green-300"
              : call.status === "processing"
                ? "bg-blue-500/20 text-blue-300"
                : call.status === "failed"
                  ? "bg-red-500/20 text-red-300"
                  : "bg-white/10 text-text-secondary"
          }`}
        >
          {STATUS_LABEL[call.status] ?? call.status}
        </span>
        {recurrenceLabel && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-500/25">
            {recurrenceLabel}
          </span>
        )}
      </div>

      {storageSkipped && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-100 space-y-3">
          <p>
            The recording could not be saved because this workspace reached its
            file storage limit. No AI summary was generated. Free space or
            upgrade your plan, then try again on a future call.
          </p>
          <Link
            href="/settings/billing"
            className="inline-block px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold"
          >
            Billing &amp; upgrade
          </Link>
        </div>
      )}

      {(call.status === "live" ||
        call.status === "lobby" ||
        call.status === "scheduled") && (
        <Link
          href={callRoomHref(id, detailFrom)}
          className="inline-flex mb-6 px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl w-fit"
        >
          {call.status === "scheduled" ? "Join or start call" : "Join call"}
        </Link>
      )}

      {(call.status === "failed" || call.ai_artifact?.status === "failed") && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200 space-y-3">
          <p>
            AI summary could not be generated for this call.
            {call.ai_artifact?.summary ? ` ${call.ai_artifact.summary}` : ""}
          </p>
          {retryError && <p className="text-red-400 text-xs">{retryError}</p>}
          <button
            type="button"
            onClick={() => void handleRetryAi()}
            disabled={retrying}
            className="cursor-pointer px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
          >
            {retrying && (
              <span className="size-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {retrying ? "Retrying…" : "Retry AI processing"}
          </button>
        </div>
      )}

      {(call.pending_review_count ?? 0) > 0 || callReviews.length > 0 ? (
        <div className="mb-6 space-y-3">
          {(call.pending_review_count ?? 0) > 0 ? (
            <Link
              href="/calls?tab=review"
              className="block p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm hover:bg-amber-500/15"
            >
              Review {call.pending_review_count} meeting task
              {call.pending_review_count === 1 ? "" : "s"} from this call
            </Link>
          ) : null}
          {callReviews.length > 0 ? (
            <section>
              <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">
                Tasks to review
              </h2>
              <MeetingReviewQueue
                workspaceId={call.workspace_id}
                initialReviews={callReviews}
                onUpdated={() => void load()}
              />
            </section>
          ) : null}
        </div>
      ) : null}

      {call.ai_artifact?.summary &&
        !["lobby", "live", "scheduled"].includes(call.status) && (
          <section className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider">
                AI Summary
              </h2>
              {(call.ai_artifact.status === "ready" ||
                call.ai_artifact.status === "skipped") && (
                <button
                  type="button"
                  disabled={exportingSummary}
                  onClick={() => void handleExportSummary()}
                  className="cursor-pointer text-xs font-bold bg-white/10 text-white px-3 py-1 rounded-lg hover:bg-white/15 disabled:opacity-50"
                >
                  {exportingSummary ? "Saving…" : "Save as Markdown"}
                </button>
              )}
            </div>
            {exportMessage && (
              <p className="text-xs text-text-secondary mb-2">{exportMessage}</p>
            )}
            <p className="text-white text-sm leading-relaxed">
              {call.ai_artifact.summary}
            </p>
            {(call.ai_artifact as { key_decisions?: string[] }).key_decisions
              ?.length ? (
              <ul className="mt-3 space-y-1 list-disc pl-5 text-sm text-text-secondary">
                {(
                  call.ai_artifact as { key_decisions?: string[] }
                ).key_decisions!.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </section>
        )}

      {(() => {
        const liveNotes = (
          call.ai_artifact as { live_notes?: { at_ms: number; text: string }[] }
        )?.live_notes;
        if (!liveNotes?.length || ["lobby", "live", "scheduled"].includes(call.status)) {
          return null;
        }
        return (
          <section className="mb-6">
            <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">
              Meeting notes
            </h2>
            <ul className="space-y-2 text-sm text-text-secondary">
              {liveNotes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-white/90">{n.text}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {call.transcript?.full_text && (
        <section className="mb-6">
          <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider mb-2">
            Transcript
          </h2>
          <pre className="text-sm text-text-secondary whitespace-pre-wrap bg-surface-dark p-4 rounded-xl border border-border-dark max-h-64 overflow-y-auto">
            {call.transcript.full_text}
          </pre>
        </section>
      )}

      {call.recording_enabled && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider">
              Recording
            </h2>
            {(() => {
              const r = (call.metadata as Record<string, string> | undefined)
                ?.recording_retention;
              const label =
                r === "7_days"
                  ? "Deleted in 7 days"
                  : r === "30_days"
                    ? "Deleted in 30 days"
                    : r === "sprint_end"
                      ? "Deleted when sprint ends"
                      : "Kept forever";
              return (
                <span className="text-xs text-text-secondary bg-white/5 border border-border-dark px-2 py-0.5 rounded-full">
                  {label}
                </span>
              );
            })()}
          </div>

          {call.recording?.status === "uploaded" ? (
            <div className="space-y-2">
              <video
                controls
                playsInline
                preload="metadata"
                src={`/api/calls/${id}/recording/playback`}
                className="w-full rounded-xl bg-black"
              />
              {isHost && (
                <button
                  type="button"
                  onClick={() => setDeleteRecordingModalOpen(true)}
                  disabled={deletingRecording}
                  className="cursor-pointer text-xs text-red-400 hover:text-red-300 disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    delete
                  </span>
                  {deletingRecording ? "Deleting…" : "Delete recording"}
                </button>
              )}
            </div>
          ) : call.recording?.status === "recording" &&
            ["live", "lobby"].includes(call.status) ? (
            <div className="p-4 rounded-xl bg-surface-dark border border-border-dark text-sm text-text-secondary flex items-center gap-2">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              Recording in progress…
            </div>
          ) : call.recording?.status === "recording" ? (
            <div className="p-4 rounded-xl bg-surface-dark border border-border-dark text-sm text-text-secondary flex items-center gap-2">
              <span className="size-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
              Uploading recording…
            </div>
          ) : call.status === "completed" || call.status === "processing" ? (
            <div className="p-4 rounded-xl bg-surface-dark border border-border-dark text-sm text-text-secondary">
              No recording available for this call.
            </div>
          ) : null}
        </section>
      )}

      {deleteRecordingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-dark border border-border-dark rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Delete recording?</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              This removes the video from this call and deletes the file from the
              workspace Files module (Meeting-Recording folder) if it exists
              there. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="cursor-pointer px-3 py-1.5 text-sm text-text-secondary"
                onClick={() => setDeleteRecordingModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cursor-pointer px-3 py-1.5 text-sm font-bold bg-red-600 text-white rounded-lg"
                onClick={() => void confirmDeleteRecording()}
              >
                Delete recording
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteCallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-dark border border-border-dark rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Delete call history?</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              This permanently deletes this meeting history and:
            </p>
            <ul className="text-xs text-text-secondary list-disc pl-5 space-y-1">
              <li>AI summary and transcript stored for this call</li>
              <li>AI-suggested tasks still in the review queue for this call</li>
              <li>
                The meeting recording and its copy in Files (Meeting-Recording),
                if present
              </li>
            </ul>
            <p className="text-xs text-amber-200/90">
              Markdown summaries you already saved to Meeting-Summary in Files
              are not deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="cursor-pointer px-3 py-1.5 text-sm text-text-secondary"
                onClick={() => setDeleteCallModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingCall}
                className="cursor-pointer px-3 py-1.5 text-sm font-bold bg-red-600 text-white rounded-lg disabled:opacity-50"
                onClick={() => void confirmDeleteCall()}
              >
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}

      {storageLimitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-dark border border-border-dark rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Storage limit</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Your workspace file storage is full, so the call recording could not
              be uploaded and no AI summary was generated. Free space or upgrade
              your membership to continue using recordings and summaries.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="cursor-pointer px-3 py-1.5 text-sm text-text-secondary"
                onClick={() => setStorageLimitModalOpen(false)}
              >
                Close
              </button>
              <Link
                href="/settings/billing"
                className="cursor-pointer px-3 py-1.5 text-sm font-bold bg-primary text-white rounded-lg"
                onClick={() => setStorageLimitModalOpen(false)}
              >
                Billing
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
