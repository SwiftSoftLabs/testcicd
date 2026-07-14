"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useUIContext } from "@/context/UIContext";
import type { Task, Status } from "@/types";
import type {
  CallLivePayload,
  CallSessionStatus,
  LiveSttCaption,
  MeetingTaskReviewRow,
  TranscriptSegment,
} from "@/types/calls";
import type { LocalCallSession, LocalPendingTask } from "@/lib/calls/localCallSession";

type TabId = "transcript" | "notes" | "tasks";

export type TasksPipelineStage =
  | "idle"
  | "hearing"
  | "compiling"
  | "creating"
  | "ready";

interface CallAiSidebarProps {
  callId: string;
  aiEnabled: boolean;
  /** Interim line; updates on each Agora stream-message. */
  liveSttCaption?: LiveSttCaption | null;
  /** Local-first session (transcript, notes, draft tasks) during the call. */
  localSession?: LocalCallSession | null;
  /** Parent owns live payload (no sidebar polling). */
  liveDataControlled?: boolean;
  /** When provided, live data is owned by CallRoom (single poller + realtime). */
  live?: CallLivePayload | null;
  liveLoaded?: boolean;
  loadError?: string | null;
  liveAiError?: string | null;
  onRefreshLive?: () => Promise<void>;
  realtimeConnected?: boolean;
  /** When live, tasks are extracted after the call ends. */
  callStatus?: CallSessionStatus;
  /** Start collapsed so the video stage gets maximum space. */
  defaultCollapsed?: boolean;
  /** LiveKit STT agent participant is connected to the room. */
  agentInRoom?: boolean;
}

function shouldShowLiveCaption(
  segments: TranscriptSegment[],
  live: LiveSttCaption | null | undefined,
): live is LiveSttCaption {
  if (!live?.text.trim()) return false;
  const last = segments[segments.length - 1];
  if (!last) return true;
  if (live.sentenceId != null && last.sentence_id === live.sentenceId) {
    return last.text !== live.text || !live.isFinal;
  }
  return last.text !== live.text;
}

function reviewTaskToTask(review: MeetingTaskReviewRow): Task | null {
  if (!review.task) return null;
  const status = review.task.status as Status;
  return {
    id: review.task.id,
    title: review.task.title,
    description: review.task.description ?? undefined,
    status:
      status === "backlog" ||
      status === "todo" ||
      status === "in-progress" ||
      status === "review" ||
      status === "done"
        ? status
        : "backlog",
    priority: "medium",
    assigneeId: review.task.assignee_id ?? "",
    tags: review.task.tags ?? [],
    commentsCount: 0,
    sourceCallId: review.call_session_id,
  };
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function TasksPipeline({ stage }: { stage: TasksPipelineStage }) {
  const steps: { key: TasksPipelineStage; label: string }[] = [
    { key: "hearing", label: "Hearing…" },
    { key: "compiling", label: "Compiling…" },
    { key: "creating", label: "Creating…" },
  ];
  const order: TasksPipelineStage[] = ["hearing", "compiling", "creating"];
  const activeIndex = order.indexOf(
    stage === "ready" ? "creating" : stage,
  );

  return (
    <div className="space-y-2 py-2">
      {steps.map((step, i) => {
        const done = activeIndex > i;
        const active = activeIndex === i;
        return (
          <div
            key={step.key}
            className={`flex items-center gap-2 text-xs ${
              active
                ? "text-primary"
                : done
                  ? "text-emerald-300/80"
                  : "text-text-secondary/60"
            }`}
          >
            <span
              className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                active
                  ? "border-primary bg-primary/20"
                  : done
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-white/10"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span>{step.label}</span>
            {active ? (
              <span className="size-3 border-2 border-primary border-t-transparent rounded-full animate-spin ml-auto" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function isRemoteLiveKitUrl(): boolean {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() ?? "";
  return (
    url.length > 0 &&
    !url.includes("127.0.0.1") &&
    !url.includes("localhost")
  );
}

function TranscriptPlaceholder({
  live,
  loading,
  agentInRoom,
}: {
  live: CallLivePayload | null;
  loading: boolean;
  agentInRoom: boolean;
}) {
  if (loading || !live) {
    return (
      <p className="text-xs text-text-secondary animate-pulse">
        Connecting live captions…
      </p>
    );
  }
  if (live.stt_status?.error) {
    return (
      <p className="text-xs text-amber-300">
        Live captions are unavailable right now. {live.stt_status.error}
      </p>
    );
  }
  if (live.stt_status?.envEnabled === false) {
    return (
      <p className="text-xs text-text-secondary">
        Live captions are not enabled for this workspace. Ask an admin to turn on
        meeting transcription in project settings.
      </p>
    );
  }
  if (!live.stt_status?.aiEnabled) {
    return (
      <p className="text-xs text-text-secondary">
        AI is turned off for this call. Enable it under Settings → Video calls for
        future meetings.
      </p>
    );
  }
  if (!live.stt_status?.agentDispatchId) {
    return (
      <p className="text-xs text-text-secondary">
        Starting live captions…
      </p>
    );
  }
  if (!agentInRoom) {
    if (isRemoteLiveKitUrl()) {
      return (
        <p className="text-xs text-amber-300">
          Waiting for the caption agent on your LiveKit server. On the VPS run{" "}
          <code className="text-[10px]">systemctl status onework-livekit-agent</code>{" "}
          and{" "}
          <code className="text-[10px]">journalctl -u onework-livekit-agent -f</code>
          — expect{" "}
          <code className="text-[10px]">onework agent joining room=…</code>. On a
          2 GB VPS the first join can take 1–2 minutes while Whisper loads; speak
          after the sidebar shows Listening.
        </p>
      );
    }
    return (
      <p className="text-xs text-amber-300">
        Waiting for the caption agent. Start{" "}
        <code className="text-[10px]">python agent.py dev</code> in{" "}
        <code className="text-[10px]">services/livekit-agent</code> (and{" "}
        <code className="text-[10px]">livekit-server --dev</code>) if this
        persists.
      </p>
    );
  }
  return (
    <p className="text-xs text-text-secondary">
      Listening. Speak clearly and your words will appear here. First phrase may
      take a few seconds while the speech model runs.
    </p>
  );
}

export function CallAiSidebar({
  callId,
  aiEnabled,
  agentInRoom = false,
  liveSttCaption = null,
  localSession = null,
  liveDataControlled = false,
  live: liveProp,
  liveLoaded: liveLoadedProp = false,
  loadError: loadErrorProp = null,
  liveAiError = null,
  onRefreshLive,
  realtimeConnected = true,
  callStatus = "live",
  defaultCollapsed = false,
}: CallAiSidebarProps) {
  const { openModal } = useUIContext();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [tab, setTab] = useState<TabId>("transcript");
  const [liveInternal, setLiveInternal] = useState<CallLivePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadErrorInternal, setLoadErrorInternal] = useState<string | null>(null);
  const [liveLoadedInternal, setLiveLoadedInternal] = useState(false);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const controlled = liveDataControlled || onRefreshLive != null;
  const live = controlled ? (liveProp ?? null) : liveInternal;
  const liveLoaded = controlled ? liveLoadedProp : liveLoadedInternal;
  const loadError = controlled ? loadErrorProp : loadErrorInternal;

  const refresh = useCallback(async () => {
    if (onRefreshLive) {
      await onRefreshLive();
      return;
    }
    try {
      const data = await api.calls.live(callId, { lite: true });
      setLiveInternal(data);
      setLiveLoadedInternal(true);
      setLoadErrorInternal(null);
    } catch (e: unknown) {
      setLiveLoadedInternal(true);
      setLoadErrorInternal(
        e instanceof Error ? e.message : "Could not load AI data",
      );
    }
  }, [callId, onRefreshLive]);

  useEffect(() => {
    if (controlled) return;
    setLiveLoadedInternal(false);
  }, [callId, controlled]);

  useEffect(() => {
    if (!aiEnabled || controlled) return;
    void refresh();
    const baseMs = 3000;
    const id = setInterval(() => void refresh(), baseMs);
    return () => clearInterval(id);
  }, [aiEnabled, refresh, controlled]);

  useEffect(() => {
    if (!stickToBottomRef.current || tab !== "transcript") return;
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [live?.transcript?.segments, liveSttCaption?.text, tab]);

  const onTranscriptScroll = () => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = nearBottom;
  };

  const approve = async (reviewId: string) => {
    setBusy(reviewId);
    try {
      await api.calls.approveReview(reviewId, false, true);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const reject = async (reviewId: string) => {
    setBusy(reviewId);
    try {
      await api.calls.rejectReview(reviewId);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!aiEnabled) return null;

  const localSegments = localSession?.segments ?? [];
  const localPending = localSession?.pendingTasks ?? [];
  const pendingCount =
    (live?.reviews.length ?? 0) + localPending.length;
  const polled = live?.transcript?.segments ?? [];
  const segments =
    localSegments.length >= polled.length ? localSegments : polled;
  const showLiveCaption = shouldShowLiveCaption(segments, liveSttCaption);
  const notes =
    localSession?.liveNotes?.length
      ? localSession.liveNotes
      : (live?.artifact?.live_notes ?? []);
  const summary = localSession?.summary ?? live?.artifact?.summary;
  const decisions =
    localSession?.keyDecisions?.length
      ? localSession.keyDecisions
      : (live?.artifact?.key_decisions ?? []);
  const hasTranscript =
    segments.length > 0 ||
    !!live?.transcript?.full_text?.trim() ||
    localSegments.length > 0;

  const isLiveCall = callStatus === "live";

  const serverStage: TasksPipelineStage =
    live?.ai_status?.tasksPipelineStage ?? "idle";
  let pipelineStage: TasksPipelineStage =
    localPending.length > 0
      ? "ready"
      : isLiveCall && hasTranscript && pendingCount === 0
        ? "hearing"
        : serverStage;
  if (
    !isLiveCall &&
    pipelineStage === "idle" &&
    hasTranscript &&
    pendingCount === 0
  ) {
    pipelineStage = "hearing";
  }
  const showPipeline =
    hasTranscript &&
    pendingCount === 0 &&
    (isLiveCall
      ? pipelineStage === "hearing"
      : ["hearing", "compiling", "creating"].includes(pipelineStage));

  const tasksEmptyMessage = (): string => {
    if (!liveLoaded) return "Loading suggested tasks…";
    if (live?.ai_status?.geminiConfigured === false) {
      return "Task suggestions are not available — meeting AI is not configured on the server.";
    }
    if (pendingCount > 0) return "";
    if (showPipeline && isLiveCall) return "";
    if (isLiveCall && hasTranscript) {
      return "Action items will be suggested after the call ends.";
    }
    if (showPipeline) return "";
    if (hasTranscript && (live?.ai_status?.lastAiRunAt || localSession?.lastAiAt)) {
      return "No action items detected yet. Mention clear tasks, owners, or deadlines and we will suggest them here.";
    }
    return "Suggested action items will appear once there is enough conversation to analyze.";
  };

  if (collapsed) {
    return (
      <aside className="flex flex-col shrink-0 w-12 border-l border-border-dark bg-surface-dark/80 items-center py-3 gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="size-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center"
          title="Open AI panel"
        >
          <span className="material-symbols-outlined text-[20px]">
            side_navigation
          </span>
        </button>
        {pendingCount > 0 ? (
          <span className="text-[10px] bg-amber-500/30 text-amber-200 px-1.5 py-0.5 rounded-full">
            {pendingCount}
          </span>
        ) : null}
        <span className="material-symbols-outlined text-text-secondary text-[20px]">
          graphic_eq
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col shrink-0 w-72 sm:w-80 xl:w-96 h-full max-h-full border-l border-border-dark bg-surface-dark/90 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-dark shrink-0">
        <span className="text-sm font-semibold text-white">AI notetaker</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="size-8 rounded-lg hover:bg-white/10 text-text-secondary flex items-center justify-center"
          title="Collapse"
        >
          <span className="material-symbols-outlined text-[18px]">
            chevron_right
          </span>
        </button>
      </div>

      <div className="flex border-b border-border-dark shrink-0">
        {(
          [
            ["transcript", "Transcript"],
            ["notes", "Notes"],
            ["tasks", pendingCount ? `Tasks (${pendingCount})` : "Tasks"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 text-xs py-2 px-1 font-medium ${
              tab === id
                ? "text-primary border-b-2 border-primary"
                : "text-text-secondary hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-3">
        {loadError ? (
          <p className="text-xs text-red-300">{loadError}</p>
        ) : null}
        {liveAiError ? (
          <p className="text-xs text-amber-300">{liveAiError}</p>
        ) : null}

        {tab === "transcript" && (
          <div
            ref={transcriptScrollRef}
            onScroll={onTranscriptScroll}
            className="flex-1 overflow-y-auto space-y-2 text-sm"
          >
            {segments.length === 0 && !showLiveCaption ? (
              <TranscriptPlaceholder
                live={live}
                loading={!liveLoaded}
                agentInRoom={agentInRoom}
              />
            ) : (
              <>
                {segments.map((seg: TranscriptSegment, i: number) => (
                  <div
                    key={`${seg.sentence_id ?? "n"}-${seg.start_ms}-${seg.end_ms}-${i}`}
                    className="text-text-secondary"
                  >
                    <span className="text-[10px] text-text-secondary/70 mr-2">
                      {formatMs(seg.start_ms)}
                    </span>
                    <span
                      className={
                        seg.is_final ? "text-white/90" : "text-white/70 italic"
                      }
                    >
                      {seg.text}
                    </span>
                  </div>
                ))}
                {showLiveCaption ? (
                  <div className="text-text-secondary">
                    <span className="text-[10px] text-text-secondary/70 mr-2">
                      {formatMs(liveSttCaption.startMs)}
                    </span>
                    <span
                      className={
                        liveSttCaption.isFinal
                          ? "text-white/90"
                          : "text-white/70 italic"
                      }
                    >
                      {liveSttCaption.text}
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="flex-1 overflow-y-auto space-y-3 text-sm">
            {summary ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-text-secondary mb-1">
                  Summary
                </p>
                <p className="text-white/90 text-xs leading-relaxed">{summary}</p>
              </div>
            ) : null}
            {decisions.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-text-secondary mb-1">
                  Decisions
                </p>
                <ul className="list-disc list-inside text-xs text-white/80 space-y-1">
                  {decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notes.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-text-secondary mb-1">
                  Live notes
                </p>
                <ul className="space-y-2">
                  {notes.map((n, i) => (
                    <li key={i} className="text-xs text-white/80 flex gap-2">
                      <span className="text-text-secondary shrink-0">
                        {formatMs(n.at_ms)}
                      </span>
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !summary && (
                <p className="text-xs text-text-secondary">
                  {liveLoaded
                    ? "Notes appear here as the meeting progresses."
                    : "Loading meeting notes…"}
                </p>
              )
            )}
          </div>
        )}

        {tab === "tasks" && (
          <div className="flex-1 overflow-y-auto space-y-2">
            {showPipeline ? (
              <>
                <TasksPipeline stage={pipelineStage} />
                {isLiveCall && hasTranscript && pendingCount === 0 ? (
                  <p className="text-xs text-text-secondary px-1">
                    Action items will be suggested after the call ends.
                  </p>
                ) : null}
              </>
            ) : null}
            {localPending.length > 0 ? (
              localPending.map((task: LocalPendingTask) => (
                <div
                  key={task.localId}
                  className="p-2 rounded-lg bg-white/5 border border-dashed border-amber-500/30 space-y-1"
                >
                  <p className="text-sm text-white font-medium line-clamp-2">
                    {task.title}
                  </p>
                  {task.description ? (
                    <p className="text-xs text-text-secondary line-clamp-3">
                      {task.description}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-amber-200/80">
                    Draft — saved when you leave the call
                  </p>
                </div>
              ))
            ) : null}
            {(live?.reviews ?? []).length === 0 && localPending.length === 0 ? (
              <p className="text-xs text-text-secondary">
                {tasksEmptyMessage()}
              </p>
            ) : (
              live?.reviews.map((review) => (
                <div
                  key={review.id}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-2"
                >
                  <p className="text-sm text-white font-medium line-clamp-2">
                    {review.task?.title ?? "Task"}
                  </p>
                  {review.review_status === "acknowledged" ? (
                    <p className="text-[10px] text-emerald-300/90">
                      Queued — add to backlog from Calls → Review after the
                      meeting.
                    </p>
                  ) : null}
                  <div className="flex gap-1.5">
                    {review.review_status === "pending" ? (
                      <button
                        type="button"
                        disabled={busy === review.id}
                        onClick={() => void approve(review.id)}
                        className="flex-1 text-xs py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    ) : (
                      <span className="flex-1 text-xs py-1 text-center text-emerald-300/80">
                        Approved in call
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy === review.id}
                      onClick={() => void reject(review.id)}
                      className="flex-1 text-xs py-1 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const task = reviewTaskToTask(review);
                        if (task) openModal("task-detail", { task });
                      }}
                      className="px-2 text-xs rounded bg-white/10 text-text-secondary"
                    >
                      View
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
