"use client";

import React, { useState } from "react";
import { api } from "@/lib/api";
import {
  formatTaskViewDigestResponse,
  taskViewDigestSkippedCount,
} from "@/lib/tasks/taskAiDigestFormat";
import { useUIContext } from "@/context/UIContext";
import {
  parseQuickCreate,
  type QuickTaskDraft,
} from "@/lib/tasks/parseQuickCreate";
import { AiGradientButton, AiHeading, AiPanel } from "@/components/ai/AiUi";
import type { Task } from "@/types";

const MAX_VIEW_TASKS = 40;

type QuickDraft = QuickTaskDraft;

interface TasksPageAiDrawerProps {
  filteredTasks: Task[];
  onOpenNewTaskWithDraft: (draft: QuickDraft) => void;
}

export function TasksPageAiDrawer({
  filteredTasks,
  onOpenNewTaskWithDraft,
}: TasksPageAiDrawerProps) {
  const { addToast } = useUIContext();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<"quick" | "digest" | null>(null);
  const [digestText, setDigestText] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<QuickDraft | null>(null);

  const runQuickCreate = async () => {
    const h = hint.trim();
    if (!h) {
      addToast("Describe the task in a sentence or two.", "warning");
      return;
    }
    setBusy("quick");
    setDraftPreview(null);
    try {
      const data = await api.tasks.runAi({ kind: "quick_create", hint: h });
      const draft = parseQuickCreate(data);
      if (!draft) {
        addToast("Could not parse AI draft.", "error");
        return;
      }
      setDraftPreview(draft);
      addToast("Draft ready — review below or open in New task.", "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "AI request failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const runViewDigest = async () => {
    const slice = filteredTasks.slice(0, MAX_VIEW_TASKS).map((t) => ({
      id: t.id,
      title: t.title || "(Untitled)",
      status: t.status,
      priority: t.priority,
    }));
    if (slice.length === 0) {
      addToast("No tasks in the current view to summarize.", "warning");
      return;
    }
    setBusy("digest");
    setDigestText(null);
    try {
      const data = await api.tasks.runAi({ kind: "view_digest", tasks: slice });
      const skipped = taskViewDigestSkippedCount(data);
      if (skipped > 0) {
        addToast(
          `${skipped} task${skipped === 1 ? "" : "s"} could not be included (no access).`,
          "info",
        );
      }
      setDigestText(formatTaskViewDigestResponse(data));
    } catch (e) {
      addToast(e instanceof Error ? e.message : "AI request failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const applyDraftToNewTask = () => {
    if (!draftPreview) return;
    onOpenNewTaskWithDraft(draftPreview);
    setDraftPreview(null);
    setHint("");
    setOpen(false);
  };

  return (
    <div className="border-t border-border-dark/60 bg-background-dark/40 shrink-0 px-6 py-3">
      <AiPanel
        open={open}
        onToggle={() => setOpen((o) => !o)}
        header={
          <AiHeading
            title="Task assistant"
            subtitle="Draft tasks or summarize the board"
            className="flex-1"
          />
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 -mt-1">
          <div className="rounded-xl border border-border-dark/70 bg-surface-dark/30 p-4 space-y-3">
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Draft from hint
            </p>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              rows={3}
              placeholder="e.g. Add OAuth refresh telemetry to the mail sync job with dashboards"
              className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-main placeholder:text-text-secondary/50 focus:ring-2 focus:ring-primary/30 focus:outline-none resize-y min-h-[4.5rem]"
            />
            <div className="flex flex-wrap gap-2">
              <AiGradientButton
                busy={busy === "quick"}
                disabled={busy !== null}
                icon="bolt"
                onClick={() => void runQuickCreate()}
            >
                Generate draft
              </AiGradientButton>
              {draftPreview ? (
                <button
                  type="button"
                  onClick={applyDraftToNewTask}
                  className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-xs font-bold text-main hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    open_in_new
                  </span>
                  Open in New task
                </button>
              ) : null}
            </div>
            {draftPreview ? (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs space-y-1.5">
                <p className="font-bold text-main">{draftPreview.title}</p>
                <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">
                  {draftPreview.description || "—"}
                </p>
                <p className="text-text-secondary">
                  <span className="font-semibold text-main">Priority:</span>{" "}
                  {draftPreview.priority}
                  {draftPreview.tags.length ? (
                    <>
                      {" "}
                      <span className="font-semibold text-main">
                        Tags:
                      </span>{" "}
                      {draftPreview.tags.join(", ")}
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border-dark/70 bg-surface-dark/30 p-4 space-y-3">
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Summarize visible tasks
            </p>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              Uses up to {MAX_VIEW_TASKS} tasks in the current filters (
              {Math.min(filteredTasks.length, MAX_VIEW_TASKS)} loaded).
            </p>
            <AiGradientButton
              busy={busy === "digest"}
              disabled={busy !== null || filteredTasks.length === 0}
              icon="summarize"
              onClick={() => void runViewDigest()}
            >
              Summarize view
            </AiGradientButton>
            {digestText ? (
              <pre className="text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar rounded-lg border border-border-dark/60 bg-background-dark/50 p-3">
                {digestText}
              </pre>
            ) : null}
          </div>
        </div>
      </AiPanel>
    </div>
  );
}
