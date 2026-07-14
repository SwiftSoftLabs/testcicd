"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import type { Task, Status } from "@/types";
import type { MeetingTaskReviewRow } from "@/types/calls";

interface MeetingReviewQueueProps {
  workspaceId: string;
  initialReviews: MeetingTaskReviewRow[];
  onUpdated?: () => void;
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

export function MeetingReviewQueue({
  workspaceId: _workspaceId,
  initialReviews,
  onUpdated: _onUpdated,
}: MeetingReviewQueueProps) {
  const { patchTaskLocal } = useAppContext();
  const { openModal } = useUIContext();
  const [reviews, setReviews] = useState(initialReviews);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (initialReviews.length === 0) {
      setReviews([]);
      return;
    }
    setReviews((current) => {
      const existingIds = new Set(current.map((r) => r.id));
      const added = initialReviews.filter((r) => !existingIds.has(r.id));
      return added.length > 0 ? [...current, ...added] : current;
    });
  }, [initialReviews]);

  const viewTask = (review: MeetingTaskReviewRow) => {
    const task = reviewTaskToTask(review);
    if (!task) return;
    openModal("task-detail", { task });
  };

  const approve = async (id: string) => {
    const review = reviews.find((x) => x.id === id);
    setBusy(id);
    setReviews((r) => r.filter((x) => x.id !== id));
    try {
      const result = await api.calls.approveReview(id, false);
      if (result.task) {
        patchTaskLocal(result.task.id, {
          status: result.task.status as Status,
          tags: result.task.tags,
          sprintId: result.task.sprint_id ?? undefined,
          projectId: result.task.project_id ?? undefined,
        });
      } else if (review?.task_id) {
        patchTaskLocal(review.task_id, {
          status: "backlog",
          tags: (review.task?.tags ?? []).filter((t) => t !== "pending-review"),
        });
      }
    } catch {
      if (review) {
        setReviews((r) => [...r, review]);
      }
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    const review = reviews.find((x) => x.id === id);
    setBusy(id);
    setReviews((r) => r.filter((x) => x.id !== id));
    try {
      await api.calls.rejectReview(id);
    } catch {
      if (review) {
        setReviews((r) => [...r, review]);
      }
    } finally {
      setBusy(null);
    }
  };

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-text-secondary py-8 text-center">
        No meeting tasks pending review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <div
          key={r.id}
          className="p-4 rounded-xl border border-border-dark bg-surface-dark"
        >
          <p className="text-xs text-text-secondary mb-1">
            From: {r.call?.title ?? "Meeting"}
          </p>
          <h3 className="font-semibold text-white">{r.task?.title}</h3>
          {r.review_status === "acknowledged" ? (
            <p className="text-xs text-amber-200/90 mt-1">
              Approved during the call — add to backlog to create the task.
            </p>
          ) : null}
          {r.task?.description && (
            <p className="text-sm text-text-secondary mt-1 line-clamp-2">
              {r.task.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              disabled={busy === r.id || !r.task}
              onClick={() => viewTask(r)}
              className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-primary text-white rounded-lg"
            >
              View task
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => void approve(r.id)}
              className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg disabled:opacity-50"
            >
              {busy === r.id
                ? "Approving…"
                : r.review_status === "acknowledged"
                  ? "Add to backlog"
                  : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => void reject(r.id)}
              className="cursor-pointer px-3 py-1.5 text-xs font-bold bg-white/10 text-white rounded-lg disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
