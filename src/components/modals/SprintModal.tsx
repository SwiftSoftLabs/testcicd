"use client";

import React, { useEffect, useRef, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Sprint } from "@/types";
import { addDays, format, parseISO } from "date-fns";

interface SprintModalProps {
  onClose: () => void;
  mode?: "create" | "history";
  afterComplete?: string;
}

const SprintModal: React.FC<SprintModalProps> = ({
  onClose,
  mode = "create",
  afterComplete,
}) => {
  const { addToast, openModal } = useUIContext();
  const {
    createSprint,
    sprints,
    completeSprint,
    selectedProjectId,
    setSelectedSprintId,
    tasks,
  } = useAppContext();
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, onClose);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [durationDays, setDurationDays] = useState(30);
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<"create" | "history">(mode);
  const [inputMode, setInputMode] = useState<"none" | "dates" | "duration">(
    "none",
  );
  const [expandedSprintId, setExpandedSprintId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const computedEndDate =
        endDate ||
        (startDate
          ? format(addDays(new Date(startDate), durationDays - 1), "yyyy-MM-dd")
          : undefined);
      const newSprint = await createSprint({
        name,
        start_date: startDate || undefined,
        end_date: computedEndDate,
        duration_days: durationDays,
        project_id: selectedProjectId || undefined,
      });
      if (afterComplete && newSprint) {
        await completeSprint(afterComplete, "next-sprint", newSprint.id);
        setSelectedSprintId(newSprint.id);
      }
      addToast(`Sprint "${name}" created`, "success");
      onClose();
    } catch {
      addToast("Failed to create sprint", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    planning: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    completed: "bg-white/5 text-text-secondary border-border-dark",
  };

  return (
    <div
      ref={modalRef}
      className="w-full max-w-lg mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between">
        <div className="flex gap-4">
          <button
            onClick={() => setTab("create")}
            className={`cursor-pointer text-sm font-bold pb-1 border-b-2 transition-all ${tab === "create" ? "text-white border-primary" : "text-text-secondary border-transparent"}`}
          >
            {afterComplete ? "Create Next Sprint" : "New Sprint"}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`cursor-pointer text-sm font-bold pb-1 border-b-2 transition-all ${tab === "history" ? "text-white border-primary" : "text-text-secondary border-transparent"}`}
          >
            Sprint History
          </button>
        </div>
        <button
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {tab === "create" ? (
        <form onSubmit={handleCreate} className="p-6 space-y-4">
          {afterComplete && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-400 font-bold">
              Incomplete tasks from the current sprint will be moved to this new
              sprint.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Sprint Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sprint 25"
              className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-3 outline-none"
            />
          </div>
          <div
            className={`transition-opacity duration-150 ${inputMode === "duration" ? "opacity-40 pointer-events-none" : ""}`}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value) {
                      setInputMode("dates");
                    } else if (!endDate) {
                      setInputMode("none");
                    }
                  }}
                  className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-3 outline-none [color-scheme:dark]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                  End Date{" "}
                  <span className="normal-case text-text-secondary/50">
                    (or use duration)
                  </span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    if (e.target.value) {
                      setInputMode("dates");
                    } else if (!startDate) {
                      setInputMode("none");
                    }
                  }}
                  className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-3 outline-none [color-scheme:dark]"
                />
              </div>
            </div>
          </div>
          <div
            className={`space-y-1.5 transition-opacity duration-150 ${inputMode === "dates" ? "opacity-40 pointer-events-none" : ""}`}
          >
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Sprint Duration
            </label>
            <div className="flex gap-2">
              {[7, 14, 21, 30, 45, 60].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDurationDays(d);
                    setInputMode("duration");
                    setStartDate("");
                    setEndDate("");
                  }}
                  className={`cursor-pointer flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all ${durationDays === d ? "bg-primary/20 border-primary text-primary" : "bg-background-dark border-border-dark text-text-secondary hover:text-white"}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {startDate && !endDate && (
              <p className="text-[10px] text-text-secondary">
                Ends:{" "}
                {format(
                  addDays(new Date(startDate), durationDays - 1),
                  "MMM d, yyyy",
                )}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer px-5 py-2.5 text-text-secondary text-sm font-bold hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="cursor-pointer px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl disabled:opacity-50 hover:bg-blue-600 transition-all"
            >
              {isSaving ? "Creating..." : "Create Sprint"}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
          {!sprints || sprints.length === 0 ? (
            <div className="text-center py-10 opacity-30">
              <span className="material-symbols-outlined text-4xl">sprint</span>
              <p className="text-xs font-bold uppercase tracking-widest mt-2">
                No sprints yet
              </p>
            </div>
          ) : (
            [...(sprints as Sprint[])]
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              )
              .map((s) => {
                const sprintTasks = tasks.filter((t) => t.sprintId === s.id);
                const isExpanded = expandedSprintId === s.id;
                return (
                  <div
                    key={s.id}
                    className="bg-background-dark border border-border-dark rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedSprintId(isExpanded ? null : s.id)
                      }
                      className="cursor-pointer w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">
                            {s.name}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${STATUS_COLORS[s.status] || STATUS_COLORS.planning}`}
                          >
                            {s.status}
                          </span>
                        </div>
                        {s.start_date && s.end_date && (
                          <span className="text-[11px] text-text-secondary text-left block">
                            {format(parseISO(s.start_date), "MMM d")} –{" "}
                            {format(parseISO(s.end_date), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-text-secondary">
                          {sprintTasks.length} tasks
                        </span>
                        <span
                          className={`material-symbols-outlined text-[16px] text-text-secondary transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                        >
                          expand_more
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border-dark max-h-48 overflow-y-auto custom-scrollbar">
                        {sprintTasks.length === 0 ? (
                          <p className="text-[11px] text-text-secondary px-4 py-3 opacity-50">
                            No tasks in this sprint
                          </p>
                        ) : (
                          sprintTasks.map((t) => (
                            <button
                              key={t.id}
                              onClick={() =>
                                openModal("task-detail", {
                                  task: t,
                                  readOnly: true,
                                })
                              }
                              className="cursor-pointer w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-all text-left border-b border-border-dark/50 last:border-0"
                            >
                              <span
                                className={`size-2 rounded-full shrink-0 ${t.status === "done" ? "bg-emerald-500" : t.status === "in-progress" ? "bg-primary" : "bg-slate-400"}`}
                              />
                              <span className="text-xs text-white truncate flex-1">
                                {t.title}
                              </span>
                              <span
                                className={`text-[9px] font-bold uppercase shrink-0 ${t.priority === "urgent" ? "text-red-400" : t.priority === "high" ? "text-orange-400" : "text-text-secondary"}`}
                              >
                                {t.priority}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
};

export default SprintModal;
