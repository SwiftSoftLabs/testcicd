"use client";

import React, { useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { Sprint, Task } from "@/types";
import { format, differenceInCalendarDays, parseISO } from "date-fns";

interface SprintBannerProps {
  sprint: Sprint;
  tasks: Task[];
  className?: string;
  readOnly?: boolean;
}

export const SprintBanner: React.FC<SprintBannerProps> = ({
  sprint,
  tasks,
  className,
  readOnly = false,
}) => {
  const { completeSprint, updateSprint } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completeAction, setCompleteAction] = useState<
    "backlog" | "next-sprint" | null
  >(null);

  const totalTasks = tasks.filter((t) => t.sprintId === sprint.id).length;
  const doneTasks = tasks.filter(
    (t) => t.sprintId === sprint.id && t.status === "done",
  ).length;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const daysLeft = sprint.end_date
    ? differenceInCalendarDays(parseISO(sprint.end_date), new Date())
    : null;

  const handleCompleteSprint = async () => {
    if (!confirmComplete) {
      setConfirmComplete(true);
      return;
    }
    if (!completeAction) {
      setCompleteAction("backlog");
      return;
    }
    try {
      await completeSprint(sprint.id, completeAction);
      addToast(`Sprint "${sprint.name}" completed`, "success");
      setConfirmComplete(false);
      setCompleteAction(null);
    } catch {
      addToast("Failed to complete sprint", "error");
    }
  };

  if (sprint.status === "planning") {
    const daysUntilStart = sprint.start_date
      ? differenceInCalendarDays(parseISO(sprint.start_date), new Date())
      : null;

    return (
      <div
        className={`px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl ${className || ""}`}
      >
        <div className="flex items-start sm:items-center justify-between gap-3">
          {/* Left: name + date info */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white whitespace-nowrap">
                {sprint.name}
              </span>
              <span className="bg-blue-500/10 text-blue-400 text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-widest border border-blue-500/20 whitespace-nowrap">
                Planning
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {sprint.start_date && (
                <>
                  <span className="text-[11px] text-text-secondary whitespace-nowrap">
                    Starts {format(parseISO(sprint.start_date), "MMM d, yyyy")}
                  </span>
                  {daysUntilStart !== null && (
                    <span className="text-[11px] font-bold text-text-secondary whitespace-nowrap">
                      {daysUntilStart > 0
                        ? `Starts in ${daysUntilStart}d`
                        : "Starting today"}
                    </span>
                  )}
                </>
              )}
              {!sprint.start_date && (
                <span className="text-[11px] text-text-secondary">
                  No start date set
                </span>
              )}
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => openModal("sprint-modal", { mode: "history" })}
              className="cursor-pointer hidden sm:flex px-3 py-1.5 bg-white/5 border border-border-dark rounded-lg text-xs font-bold text-text-secondary hover:text-white transition-all"
            >
              Sprint History
            </button>
            {!readOnly && (
              <button
                onClick={async () => {
                  try {
                    await updateSprint(sprint.id, {
                      status: "active",
                      start_date: format(new Date(), "yyyy-MM-dd"),
                    });
                    addToast(`Sprint "${sprint.name}" started`, "success");
                  } catch {
                    addToast("Failed to start sprint", "error");
                  }
                }}
                className="cursor-pointer px-3 py-1.5 bg-primary border border-primary/50 rounded-lg text-xs font-bold text-white hover:bg-blue-600 transition-all whitespace-nowrap"
              >
                Start Sprint
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-3 bg-primary/5 border border-primary/20 rounded-xl ${className || ""}`}
    >
      {/* Main row: name/info left, buttons right */}
      <div className="flex items-start sm:items-center justify-between gap-3">
        {/* Left: name + badge + date + countdown */}
        <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-black text-white whitespace-nowrap">{sprint.name}</span>
            <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-widest border border-emerald-500/20 whitespace-nowrap">
              Active
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {sprint.start_date && sprint.end_date && (
              <span className="text-[11px] text-text-secondary whitespace-nowrap">
                {format(parseISO(sprint.start_date), "MMM d")} –{" "}
                {format(parseISO(sprint.end_date), "MMM d")}
              </span>
            )}
            {daysLeft !== null && (
              <span
                className={`text-[11px] font-bold whitespace-nowrap ${daysLeft <= 2 ? "text-red-400" : daysLeft <= 7 ? "text-amber-400" : "text-text-secondary"}`}
              >
                {daysLeft > 0
                  ? `${daysLeft}d left`
                  : daysLeft === 0
                    ? "Ends today"
                    : `${Math.abs(daysLeft)}d overdue`}
              </span>
            )}
          </div>
          {/* Progress bar — desktop only (shown inline) */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <div className="h-1.5 w-28 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 w-[var(--pct)]"
                style={{ "--pct": `${pct}%` } as React.CSSProperties}
              />
            </div>
            <span className="text-[11px] font-bold text-text-secondary whitespace-nowrap">
              {doneTasks}/{totalTasks} done ({pct}%)
            </span>
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => openModal("sprint-modal", { mode: "history" })}
            className="cursor-pointer hidden sm:flex px-3 py-1.5 bg-white/5 border border-border-dark rounded-lg text-xs font-bold text-text-secondary hover:text-white transition-all whitespace-nowrap"
          >
            Sprint History
          </button>

          {!readOnly && !confirmComplete ? (
            <button
              onClick={() => setConfirmComplete(true)}
              className="cursor-pointer px-3 py-1.5 bg-white/5 border border-border-dark rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-all whitespace-nowrap"
            >
              Complete
            </button>
          ) : !readOnly && confirmComplete ? (
            <div className="flex items-center gap-2 bg-background-dark border border-border-dark rounded-xl p-2 animate-in fade-in duration-150 flex-wrap">
              <span className="text-[11px] text-text-secondary whitespace-nowrap">
                Move incomplete to:
              </span>
              <button
                onClick={async () => {
                  await completeSprint(sprint.id, "backlog");
                  addToast("Sprint completed", "success");
                  setConfirmComplete(false);
                }}
                className="cursor-pointer px-2 py-1 bg-surface-dark border border-border-dark rounded text-[11px] font-bold text-white hover:bg-white/10 transition-all"
              >
                Backlog
              </button>
              <button
                onClick={async () => {
                  openModal("sprint-modal", {
                    mode: "create",
                    afterComplete: sprint.id,
                  });
                  setConfirmComplete(false);
                }}
                className="cursor-pointer px-2 py-1 bg-primary border border-primary/50 rounded text-[11px] font-bold text-white hover:bg-blue-600 transition-all"
              >
                Next Sprint
              </button>
              <button
                onClick={() => setConfirmComplete(false)}
                className="cursor-pointer text-text-secondary hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Progress bar — mobile only */}
      <div className="flex sm:hidden items-center gap-2 mt-2">
        <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 w-[var(--pct)]"
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
          />
        </div>
        <span className="text-[11px] font-bold text-text-secondary whitespace-nowrap">
          {doneTasks}/{totalTasks} ({pct}%)
        </span>
      </div>
    </div>
  );
};
