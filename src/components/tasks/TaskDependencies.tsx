"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getTaskDisplayKey } from "@/lib/tasks/taskKey";
import { useUIContext } from "@/context/UIContext";
import { Task, TaskDependency } from "@/types";

interface TaskDependenciesProps {
  task: Task;
  allTasks: Task[];
  readOnly?: boolean;
}

export const TaskDependencies: React.FC<TaskDependenciesProps> = ({
  task,
  allTasks,
  readOnly = false,
}) => {
  const { addToast } = useUIContext();
  const [deps, setDeps] = useState<TaskDependency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.tasks
      .getDependencies(task.id)
      .then((data) => setDeps(data as TaskDependency[]))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [task.id]);

  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  const suggestions = allTasks
    .filter(
      (t) =>
        t.id !== task.id &&
        !deps.some((d) => d.depends_on_task_id === t.id) &&
        t.title.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 6);

  const handleAdd = async (blocker: Task) => {
    try {
      const newDep = (await api.tasks.addDependency(
        task.id,
        blocker.id,
      )) as TaskDependency;
      setDeps((prev) => [
        ...prev,
        {
          ...newDep,
          depends_on: {
            id: blocker.id,
            title: blocker.title,
            status: blocker.status,
          },
        },
      ]);
      setQuery("");
      setShowSearch(false);
    } catch {
      addToast("Failed to add dependency", "error");
    }
  };

  const handleRemove = async (depId: string) => {
    try {
      await api.tasks.removeDependency(task.id, depId);
      setDeps((prev) => prev.filter((d) => d.id !== depId));
    } catch {
      addToast("Failed to remove dependency", "error");
    }
  };

  const openBlockers = deps.filter((d) => d.depends_on?.status !== "done");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Dependencies
          </h4>
          {openBlockers.length > 0 && (
            <span className="bg-amber-500/10 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-500/20 uppercase">
              {openBlockers.length} blocking
            </span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="cursor-pointer text-text-secondary hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {showSearch ? "close" : "add"}
            </span>
          </button>
        )}
      </div>

      {showSearch && (
        <div className="relative">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks to link as blockers..."
            className="w-full bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none"
          />
          {query && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden">
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleAdd(t)}
                  className="cursor-pointer w-full px-3 py-2 text-left text-xs hover:bg-white/5 transition-colors flex items-center gap-2"
                >
                  <span className="font-mono text-[9px] text-text-secondary">
                    {getTaskDisplayKey(t)}
                  </span>
                  <span className="font-bold text-white truncate">
                    {t.title}
                  </span>
                  <span
                    className={`text-[9px] font-bold ml-auto shrink-0 ${t.status === "done" ? "text-emerald-400" : "text-amber-400"}`}
                  >
                    {t.status.replace("-", " ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isLoading && deps.length === 0 && (
        <p className="text-[11px] text-text-secondary opacity-40">
          No dependencies
        </p>
      )}

      {deps.map((dep) => {
        const blockerTask = allTasks.find((t) => t.id === dep.depends_on_task_id);
        return (
        <div
          key={dep.id}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${dep.depends_on?.status !== "done" ? "bg-amber-500/5 border-amber-500/20" : "bg-surface-dark border-border-dark"}`}
        >
          <span className="material-symbols-outlined text-[14px] text-amber-400">
            block
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-text-secondary">
                {blockerTask ? getTaskDisplayKey(blockerTask) : dep.depends_on_task_id.slice(0, 8)}
              </span>
              <span className="text-xs font-bold text-white truncate">
                {dep.depends_on?.title || "Unknown task"}
              </span>
            </div>
            <span
              className={`text-[10px] font-bold ${dep.depends_on?.status === "done" ? "text-emerald-400" : "text-amber-400"}`}
            >
              {dep.depends_on?.status === "done"
                ? "✓ Resolved"
                : "Blocked by this task"}
            </span>
          </div>
          {!readOnly && (
            <button
              onClick={() => handleRemove(dep.id)}
              className="cursor-pointer text-text-secondary hover:text-red-400 transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>
      );
      })}
    </div>
  );
};
