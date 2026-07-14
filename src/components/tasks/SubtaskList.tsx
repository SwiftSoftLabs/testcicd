"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { Task, Status, Priority } from "@/types";

interface SubtaskListProps {
  parentTask: Task;
  onSubtaskCountChange?: (total: number, done: number) => void;
  /** Bump after external creates (e.g. AI suggestions) to reload the list. */
  refreshToken?: number;
  readOnly?: boolean;
}

interface SubtaskCreatedResponse {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assigneeId: string;
  tags: string[];
  commentsCount: number;
  parentTaskId: string;
}

const STATUS_DOT: Record<Status, string> = {
  backlog: "bg-slate-400",
  todo: "bg-blue-400",
  "in-progress": "bg-primary",
  review: "bg-purple-400",
  done: "bg-emerald-400",
};

export const SubtaskList: React.FC<SubtaskListProps> = ({
  parentTask,
  onSubtaskCountChange,
  refreshToken = 0,
  readOnly = false,
}) => {
  const { currentUser, updateTask, selectedWorkspaceId } = useAppContext();
  const { addToast } = useUIContext();
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  const fetchSubtasks = async () => {
    try {
      const data = (await api.tasks.getSubtasks(parentTask.id)) as Task[];
      setSubtasks(data);
      const done = data.filter((t) => t.status === "done").length;
      onSubtaskCountChange?.(data.length, done);
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    void fetchSubtasks();
  }, [parentTask.id, refreshToken]);

  useEffect(() => {
    if (showAdd) addInputRef.current?.focus();
  }, [showAdd]);

  const handleAddSubtask = async () => {
    if (!newTitle.trim() || isAdding) return;
    setIsAdding(true);
    try {
      const created = (await api.tasks.createSubtask(parentTask.id, {
        title: newTitle.trim(),
        status: "todo",
        priority: "medium",
        workspace_id: selectedWorkspaceId,
        parent_task_id: parentTask.id,
        assignee_id: currentUser.id,
        tags: [],
      })) as SubtaskCreatedResponse;
      setSubtasks((prev) => [
        ...prev,
        {
          id: created.id,
          title: created.title,
          status: created.status,
          priority: created.priority,
          assigneeId: created.assigneeId,
          tags: created.tags || [],
          commentsCount: 0,
          parentTaskId: parentTask.id,
        },
      ]);
      setNewTitle("");
      await updateTask(parentTask.id, {});
    } catch {
      addToast("Failed to add subtask", "error");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleDone = async (subtask: Task) => {
    const newStatus: Status = subtask.status === "done" ? "todo" : "done";
    try {
      await api.tasks.update(subtask.id, { status: newStatus });
      const updated = subtasks.map((t) =>
        t.id === subtask.id ? { ...t, status: newStatus } : t,
      );
      setSubtasks(updated);
      const done = updated.filter((t) => t.status === "done").length;
      onSubtaskCountChange?.(updated.length, done);

      if (done === updated.length && updated.length > 0) {
        addToast("All subtasks done — mark parent task as complete?", "info");
      }
    } catch {
      addToast("Failed to update subtask", "error");
    }
  };

  const doneCount = subtasks.filter((t) => t.status === "done").length;
  const pct =
    subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
          Subtasks {subtasks.length > 0 && `(${doneCount}/${subtasks.length})`}
        </h4>
        {!readOnly && (
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="cursor-pointer text-text-secondary hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {showAdd ? "close" : "add"}
            </span>
          </button>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {showAdd && (
        <div className="flex items-center gap-2">
          <input
            ref={addInputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddSubtask();
              if (e.key === "Escape") setShowAdd(false);
            }}
            placeholder="Subtask title..."
            className="flex-1 bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none"
          />
          <button
            onClick={handleAddSubtask}
            disabled={!newTitle.trim() || isAdding}
            className="cursor-pointer px-3 py-2 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-blue-600 transition-all"
          >
            Add
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-4 opacity-40">
          <div className="size-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
        </div>
      ) : subtasks.length === 0 ? (
        !showAdd && (
          <p className="text-[11px] text-text-secondary opacity-40 py-2">
            No subtasks yet
          </p>
        )
      ) : (
        <div className="space-y-1.5">
          {subtasks.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-2.5 group px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <button
                disabled={readOnly}
                onClick={() => { if (!readOnly) handleToggleDone(sub); }}
                className={`cursor-pointer size-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${sub.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-border-dark hover:border-primary"}`}
              >
                {sub.status === "done" && (
                  <span className="material-symbols-outlined text-white text-[10px]">
                    check
                  </span>
                )}
              </button>
              <span
                className={`flex-1 text-xs ${sub.status === "done" ? "line-through text-text-secondary" : "text-white"}`}
              >
                {sub.title}
              </span>
              <span
                className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[sub.status as Status]}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
