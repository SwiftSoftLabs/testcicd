"use client";

import React, { useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { Task } from "@/types";
import { api } from "@/lib/api";
import {
  hasImproveSuggestions,
  normalizeTaskAiSuggestion,
  type NormalizedTaskAiSuggestion,
  type TaskAiSuggestionType,
} from "@/lib/tasks/taskAiSuggestionNormalize";
import {
  AiBorderCard,
  AiChip,
  AiHeading,
  AiSparkle,
  aiGradientTextClass,
} from "@/components/ai/AiUi";

interface Suggestion {
  type: TaskAiSuggestionType;
  data: NormalizedTaskAiSuggestion;
}

interface AISuggestionPanelProps {
  task: Task;
  onAcceptTitle?: (title: string) => void | Promise<void>;
  onAcceptDescription?: (desc: string) => void | Promise<void>;
  onAcceptTags?: (tags: string[]) => void | Promise<void>;
  onAcceptSubtasks?: (subtasks: string[]) => void | Promise<void>;
  onAcceptEstimate?: (hours: number) => void | Promise<void>;
}

export const AISuggestionPanel: React.FC<AISuggestionPanelProps> = ({
  task,
  onAcceptTitle,
  onAcceptDescription,
  onAcceptTags,
  onAcceptSubtasks,
  onAcceptEstimate,
}) => {
  const { addToast } = useUIContext();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingType, setLoadingType] = useState<TaskAiSuggestionType | null>(
    null,
  );
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  const fetchSuggestion = async (type: TaskAiSuggestionType) => {
    setIsLoading(true);
    setLoadingType(type);
    setSuggestion(null);
    setAccepted(new Set());
    try {
      const raw = await api.tasks.getAISuggestions(task.id, type);
      const data = normalizeTaskAiSuggestion(type, raw);
      if (
        (type === "improve" || type === "proofread") &&
        !hasImproveSuggestions(data)
      ) {
        addToast(
          type === "proofread"
            ? "No grammar or spelling fixes suggested."
            : "AI had no concrete improvements to suggest.",
          "info",
        );
        return;
      }
      if (
        type === "subtasks" &&
        (!data.subtasks || data.subtasks.length === 0)
      ) {
        addToast(
          "AI did not return any subtasks. Try again or edit the task description.",
          "warning",
        );
        return;
      }
      if (
        type === "estimate" &&
        (data.hours == null || Number.isNaN(data.hours))
      ) {
        addToast("AI could not produce an hour estimate.", "warning");
        return;
      }
      setSuggestion({ type, data });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "AI suggestion failed";
      addToast(msg, "error");
    } finally {
      setIsLoading(false);
      setLoadingType(null);
    }
  };

  const runAccept = async (key: string, fn: () => void | Promise<void>) => {
    setApplyingKey(key);
    try {
      await fn();
      setAccepted((prev) => new Set([...prev, key]));
      addToast("Suggestion applied", "success");
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Could not apply suggestion",
        "error",
      );
    } finally {
      setApplyingKey(null);
    }
  };

  const acceptAllSubtasks = async () => {
    if (
      !suggestion ||
      suggestion.type !== "subtasks" ||
      !suggestion.data.subtasks?.length
    )
      return;
    const pending = suggestion.data.subtasks
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => !accepted.has(`subtask-${i}`));
    if (!pending.length) return;
    setApplyingKey("subtasks-all");
    try {
      await onAcceptSubtasks?.(pending.map((p) => p.s));
      setAccepted((prev) => {
        const next = new Set(prev);
        pending.forEach(({ i }) => next.add(`subtask-${i}`));
        return next;
      });
      addToast(
        `Added ${pending.length} subtask${pending.length === 1 ? "" : "s"}`,
        "success",
      );
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Could not add subtasks",
        "error",
      );
    } finally {
      setApplyingKey(null);
    }
  };

  const pendingSubtaskCount =
    suggestion?.type === "subtasks" && suggestion.data.subtasks
      ? suggestion.data.subtasks.filter((_, i) => !accepted.has(`subtask-${i}`))
          .length
      : 0;

  return (
    <div className="space-y-3">
      <AiHeading
        title="AI Suggestions"
        subtitle="Proofread, improve, or plan work"
      />

      <div className="grid grid-cols-1 gap-2">
        {[
          {
            type: "proofread" as TaskAiSuggestionType,
            icon: "spellcheck",
            label: "Proofread",
          },
          {
            type: "improve" as TaskAiSuggestionType,
            icon: "edit_note",
            label: "Improve task",
          },
          {
            type: "subtasks" as TaskAiSuggestionType,
            icon: "account_tree",
            label: "Break into subtasks",
          },
          {
            type: "estimate" as TaskAiSuggestionType,
            icon: "schedule",
            label: "Estimate effort",
          },
        ].map((btn) => (
          <AiChip
            key={btn.type}
            icon={btn.icon}
            busy={loadingType === btn.type}
            disabled={isLoading}
            onClick={() => void fetchSuggestion(btn.type)}
            className="cursor-pointer w-full justify-start"
          >
            {btn.label}
          </AiChip>
        ))}
      </div>

      {suggestion ? (
        <AiBorderCard innerClassName="p-3 space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <AiSparkle size="xs" />
              <span
                className={`text-[10px] font-bold uppercase tracking-widest ${aiGradientTextClass()}`}
              >
                AI Suggestion
              </span>
            </div>
            {suggestion.type === "subtasks" &&
            pendingSubtaskCount > 1 &&
            onAcceptSubtasks ? (
              <button
                type="button"
                disabled={applyingKey !== null}
                onClick={() => void acceptAllSubtasks()}
                className="cursor-pointer shrink-0 px-2 py-1 rounded-lg border border-primary/35 bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 disabled:opacity-45"
              >
                Accept all ({pendingSubtaskCount})
              </button>
            ) : null}
          </div>

          {suggestion.type === "improve" || suggestion.type === "proofread" ? (
            <div className="space-y-2">
              {suggestion.data.title ? (
                <SuggestionItem
                  label="Title"
                  value={suggestion.data.title}
                  accepted={accepted.has("title")}
                  busy={applyingKey === "title"}
                  onAccept={() =>
                    void runAccept("title", () =>
                      onAcceptTitle?.(suggestion.data.title!),
                    )
                  }
                />
              ) : null}
              {suggestion.data.description ? (
                <SuggestionItem
                  label="Description"
                  value={suggestion.data.description}
                  accepted={accepted.has("description")}
                  busy={applyingKey === "description"}
                  onAccept={() =>
                    void runAccept("description", () =>
                      onAcceptDescription?.(suggestion.data.description!),
                    )
                  }
                />
              ) : null}
              {suggestion.data.tags && suggestion.data.tags.length > 0 ? (
                <SuggestionItem
                  label="Tags"
                  value={suggestion.data.tags.join(", ")}
                  accepted={accepted.has("tags")}
                  busy={applyingKey === "tags"}
                  onAccept={() =>
                    void runAccept("tags", () =>
                      onAcceptTags?.(suggestion.data.tags!),
                    )
                  }
                />
              ) : null}
            </div>
          ) : null}

          {suggestion.type === "subtasks" && suggestion.data.subtasks ? (
            <div className="space-y-2">
              {suggestion.data.subtasks.map((sub, i) => (
                <SuggestionItem
                  key={i}
                  label={`Subtask ${i + 1}`}
                  value={sub}
                  accepted={accepted.has(`subtask-${i}`)}
                  busy={
                    applyingKey === `subtask-${i}` ||
                    applyingKey === "subtasks-all"
                  }
                  onAccept={() =>
                    void runAccept(`subtask-${i}`, () =>
                      onAcceptSubtasks?.([sub]),
                    )
                  }
                />
              ))}
            </div>
          ) : null}

          {suggestion.type === "estimate" && suggestion.data.hours != null ? (
            <SuggestionItem
              label="Estimated Hours"
              value={`${Number(suggestion.data.hours)}h — ${suggestion.data.reasoning || ""}`}
              accepted={accepted.has("hours")}
              busy={applyingKey === "hours"}
              onAccept={() =>
                void runAccept("hours", () =>
                  onAcceptEstimate?.(Number(suggestion.data.hours)),
                )
              }
            />
          ) : null}
        </AiBorderCard>
      ) : null}
    </div>
  );
};

function SuggestionItem({
  label,
  value,
  accepted,
  busy,
  onAccept,
}: {
  label: string;
  value: string;
  accepted: boolean;
  busy?: boolean;
  onAccept: () => void;
}) {
  return (
    <div
      className={`rounded-lg p-2.5 border transition-all ${accepted ? "border-emerald-500/30 bg-emerald-500/5" : "border-border-dark bg-surface-dark"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-[9px] font-bold text-text-secondary uppercase tracking-widest">
            {label}
          </span>
          <p className="text-[11px] text-white mt-0.5 leading-relaxed">
            {value}
          </p>
        </div>
        {!accepted ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="cursor-pointer shrink-0 px-2 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] font-bold rounded hover:bg-primary/20 transition-all disabled:opacity-45"
          >
            {busy ? "…" : "Accept"}
          </button>
        ) : (
          <span className="shrink-0 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">
              check_circle
            </span>
            Applied
          </span>
        )}
      </div>
    </div>
  );
}
