"use client";

import React from "react";
import { format } from "date-fns";
import { TaskSourceBadge } from "@/components/tasks/TaskSourceBadge";
import { useUIContext } from "@/context/UIContext";
import { parseDueDateLocal } from "@/lib/tasks/dueUrgency";
import { cn } from "@/lib/utils";
import { Priority, Project, Status, Task, User } from "@/types";

interface UpNextCardProps {
  task: Task | null;
  project: Project | null;
  assignee: User | null;
  counts: {
    open: number;
    overdue: number;
    dueToday: number;
  };
}

const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  todo: "To Do",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

const STATUS_STYLES: Record<Status, string> = {
  backlog: "bg-slate-400/10 text-slate-300 border-slate-400/20",
  todo: "bg-blue-400/10 text-blue-300 border-blue-400/20",
  "in-progress": "bg-primary/10 text-primary border-primary/20",
  review: "bg-purple-400/10 text-purple-300 border-purple-400/20",
  done: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  urgent: "bg-red-400/10 text-red-300 border-red-400/20",
  high: "bg-orange-400/10 text-orange-300 border-orange-400/20",
  medium: "bg-blue-400/10 text-blue-300 border-blue-400/20",
  low: "bg-slate-400/10 text-slate-300 border-slate-400/20",
};

function getDueState(dueDate?: string) {
  if (!dueDate) {
    return {
      label: "No due date",
      className: "text-text-secondary",
      icon: "event_busy",
    };
  }

  const parsed = parseDueDateLocal(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    return {
      label: "No due date",
      className: "text-text-secondary",
      icon: "event_busy",
    };
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  if (parsed.getTime() < startOfToday.getTime()) {
    return {
      label: `Overdue ${format(parsed, "MMM d")}`,
      className: "text-red-300",
      icon: "warning",
    };
  }

  if (parsed.getTime() === startOfToday.getTime()) {
    return {
      label: "Due today",
      className: "text-amber-300",
      icon: "today",
    };
  }

  return {
    label: `Due ${format(parsed, "MMM d")}`,
    className: "text-text-secondary",
    icon: "event_upcoming",
  };
}

function getSubtaskLabel(task: Task) {
  if (!task.subtaskCount || task.subtaskCount <= 0) return null;
  return `${task.subtaskDoneCount ?? 0}/${task.subtaskCount} subtasks`;
}

function getScopeSummary(counts: UpNextCardProps["counts"]) {
  if (counts.open === 0) return "All caught up";
  if (counts.overdue > 0) return `${counts.open} open · ${counts.overdue} overdue`;
  if (counts.dueToday > 0) return `${counts.open} open · ${counts.dueToday} due today`;
  return `${counts.open} open tasks`;
}

export const UpNextCard: React.FC<UpNextCardProps> = ({
  task,
  project,
  assignee,
  counts,
}) => {
  const { openModal } = useUIContext();

  const dueState = getDueState(task?.dueDate);
  const subtaskLabel = task ? getSubtaskLabel(task) : null;
  const scopeSummary = getScopeSummary(counts);
  const clickable = Boolean(task);

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => {
        if (task) openModal("task-detail", { task });
      }}
      className={cn(
        "lg:col-span-3 rounded-2xl border p-6 text-left transition-all disabled:pointer-events-none",
        clickable
          ? "cursor-pointer border-border-dark bg-surface-dark hover:border-primary/50 hover:bg-surface-highlight"
          : "cursor-default border-border-dark bg-surface-dark",
      )}
    >
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Up Next
            </p>
            <p className="mt-1 text-xs text-text-secondary/80">{scopeSummary}</p>
          </div>
          <span
            className={`material-symbols-outlined text-[22px] ${
              clickable ? "text-primary" : "text-text-secondary"
            }`}
          >
            {clickable ? "assignment" : "task_alt"}
          </span>
        </div>

        {task ? (
          <>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${PRIORITY_STYLES[task.priority]}`}
                >
                  {task.priority}
                </span>
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${STATUS_STYLES[task.status]}`}
                >
                  {STATUS_LABELS[task.status]}
                </span>
              </div>

              <h3 className="text-lg font-bold leading-tight text-main line-clamp-2">
                {task.title}
              </h3>

              <div className={`flex items-center gap-2 text-xs font-medium ${dueState.className}`}>
                <span className="material-symbols-outlined text-[16px]">
                  {dueState.icon}
                </span>
                <span>{dueState.label}</span>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Project
                  </p>
                  <p className="truncate text-sm font-medium text-main">
                    {project?.name ?? "No project"}
                  </p>
                </div>
                {task.source === "plugin" && task.sourceProvider ? (
                  <TaskSourceBadge provider={task.sourceProvider} />
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Assignee
                  </p>
                  <p className="truncate text-sm font-medium text-main">
                    {assignee?.name ?? "Unassigned"}
                  </p>
                </div>
                {assignee?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assignee.avatar}
                    alt={assignee.name}
                    className="size-8 shrink-0 rounded-full border border-border-dark object-cover"
                  />
                ) : assignee ? (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-dark bg-white/5 text-[11px] font-bold text-text-secondary">
                    {assignee.name.slice(0, 1).toUpperCase()}
                  </div>
                ) : (
                  <span className="material-symbols-rounded text-base text-text-secondary">
                    person
                  </span>
                )}
              </div>
            </div>

            <div className="mt-auto flex flex-wrap gap-3 text-xs text-text-secondary">
              {subtaskLabel ? <span>{subtaskLabel}</span> : null}
              {task.commentsCount > 0 ? (
                <span>{task.commentsCount} comments</span>
              ) : null}
              {task.attachmentCount && task.attachmentCount > 0 ? (
                <span>{task.attachmentCount} attachments</span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border-dark bg-white/[0.02] p-5">
            <h3 className="text-lg font-bold text-main">No tasks left</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              Everything in this dashboard scope is complete. The card will start routing to the next best task as soon as new work appears.
            </p>
          </div>
        )}
      </div>
    </button>
  );
};
