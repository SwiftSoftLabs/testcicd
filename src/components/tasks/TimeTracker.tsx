"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useUIContext } from "@/context/UIContext";
import { Task, TimeLog } from "@/types";
import { format } from "date-fns";

interface TimeTrackerProps {
  task: Task;
  readOnly?: boolean;
}

export const TimeTracker: React.FC<TimeTrackerProps> = ({ task, readOnly = false }) => {
  const { addToast } = useUIContext();
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [logDate, setLogDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.tasks
      .getTimeLogs(task.id)
      .then((data) => setLogs(data as TimeLog[]))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [task.id]);

  const totalLogged = logs.reduce(
    (sum, l) => sum + (parseFloat(String(l.hours)) || 0),
    0,
  );
  const estimated = task.estimatedHours || 0;
  const pct =
    estimated > 0 ? Math.min((totalLogged / estimated) * 100, 100) : 0;
  const overBudget = estimated > 0 && totalLogged > estimated;

  const handleLogTime = async () => {
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) return;
    setIsSaving(true);
    try {
      const newLog = (await api.tasks.logTime(task.id, {
        hours: h,
        note,
        log_date: logDate,
      })) as TimeLog;
      setLogs((prev) => [newLog, ...prev]);
      setHours("");
      setNote("");
      setShowForm(false);
      addToast(`${h}h logged`, "success");
    } catch {
      addToast("Failed to log time", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
          Time Tracking
        </h4>
        {!readOnly && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="cursor-pointer text-text-secondary hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {showForm ? "close" : "add"}
            </span>
          </button>
        )}
      </div>

      {/* Progress arc */}
      <div className="flex items-center gap-4">
        <div className="relative size-16 shrink-0">
          <svg viewBox="0 0 36 36" className="size-16 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke={overBudget ? "#f87171" : "#195de6"}
              strokeWidth="3"
              strokeDasharray={`${pct} 100`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white">
            {Math.round(pct)}%
          </span>
        </div>
        <div className="space-y-1">
          <p
            className={`text-sm font-black ${overBudget ? "text-red-400" : "text-white"}`}
          >
            {totalLogged.toFixed(1)}h logged
          </p>
          {estimated > 0 && (
            <p className="text-[11px] text-text-secondary">
              of {estimated}h estimated
            </p>
          )}
          {!estimated && (
            <p className="text-[11px] text-text-secondary">No estimate set</p>
          )}
        </div>
      </div>

      {showForm && (
        <div className="bg-background-dark border border-border-dark rounded-xl p-3 space-y-2 animate-in fade-in duration-150">
          <div className="flex gap-2">
            <input
              type="number"
              min="0.25"
              step="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Hours (e.g. 1.5)"
              className="flex-1 bg-surface-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none"
            />
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="bg-surface-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none [color-scheme:dark]"
            />
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note..."
            className="w-full bg-surface-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none"
          />
          <button
            onClick={handleLogTime}
            disabled={!hours || isSaving}
            className="cursor-pointer w-full py-2 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-50 hover:bg-blue-600 transition-all"
          >
            {isSaving ? "Saving..." : "Log Time"}
          </button>
        </div>
      )}

      {!isLoading && logs.length > 0 && (
        <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
          {logs.slice(0, 8).map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between text-[11px] px-2 py-1 rounded hover:bg-white/5 transition-colors"
            >
              <span className="font-bold text-white">
                {parseFloat(String(log.hours)).toFixed(1)}h
              </span>
              <span className="text-text-secondary flex-1 mx-2 truncate">
                {log.note || "—"}
              </span>
              <span className="text-text-secondary shrink-0">
                {format(new Date(log.log_date), "MMM d")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
