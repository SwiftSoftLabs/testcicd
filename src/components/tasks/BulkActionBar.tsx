"use client";

import React, { useRef, useState } from "react";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { api } from "@/lib/api";
import {
  formatTaskViewDigestResponse,
  taskViewDigestSkippedCount,
} from "@/lib/tasks/taskAiDigestFormat";
import { Status, Priority, Task } from "@/types";
import {
  AiGradientButton,
  AiSparkle,
  aiGradientTextClass,
} from "@/components/ai/AiUi";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  /** When set, enables “AI digest” for the current selection (max 40 tasks). */
  selectedTasks?: Pick<Task, 'id' | 'title' | 'status' | 'priority' | 'source' | 'sourceProvider'>[];
}

const MAX_AI_DIGEST = 40;

const STATUSES: { value: Status; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedIds,
  onClear,
  selectedTasks,
}) => {
  const { bulkUpdateTasks, deleteTask } = useAppContext();
  const { addToast } = useUIContext();
  const [openMenu, setOpenMenu] = useState<"status" | "priority" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [digestPanelOpen, setDigestPanelOpen] = useState(false);
  const [digestText, setDigestText] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setOpenMenu(null));

  const count = selectedIds.size;
  const ids = Array.from(selectedIds);
  const pluginSelectedCount = (selectedTasks ?? []).filter((t) => t.source === 'plugin').length;
  const deletableIds = ids.filter(
    (id) => (selectedTasks ?? []).find((t) => t.id === id)?.source !== 'plugin',
  );
  const allPluginSelected = pluginSelectedCount > 0 && deletableIds.length === 0;

  const handleBulkStatus = async (status: Status) => {
    setOpenMenu(null);
    try {
      await bulkUpdateTasks(ids, { status });
      addToast(
        `Status updated for ${count} task${count > 1 ? "s" : ""}`,
        "success",
      );
      onClear();
    } catch {
      addToast("Bulk update failed", "error");
    }
  };

  const handleBulkPriority = async (priority: Priority) => {
    setOpenMenu(null);
    try {
      await bulkUpdateTasks(ids, { priority });
      addToast(
        `Priority updated for ${count} task${count > 1 ? "s" : ""}`,
        "success",
      );
      onClear();
    } catch {
      addToast("Bulk update failed", "error");
    }
  };

  const handleBulkDelete = async () => {
    if (allPluginSelected) {
      addToast('Synced tasks cannot be deleted in OneWork.', 'warning');
      return;
    }
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; }
    try {
      await Promise.all(deletableIds.map((id) => deleteTask(id)));
      const deleted = deletableIds.length;
      addToast(`${deleted} task${deleted > 1 ? 's' : ''} deleted`, 'success');
      if (pluginSelectedCount > 0) {
        addToast(
          `Skipped ${pluginSelectedCount} synced task${pluginSelectedCount > 1 ? 's' : ''}.`,
          'warning',
        );
      }
      onClear();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleAiDigest = async () => {
    const tasks = (selectedTasks ?? []).slice(0, MAX_AI_DIGEST).map((t) => ({
      id: t.id,
      title: (t.title || "(Untitled)").slice(0, 280),
      status: t.status,
      priority: t.priority,
    }));
    if (tasks.length === 0) {
      addToast("No tasks selected.", "warning");
      return;
    }
    setAiBusy(true);
    setDigestText(null);
    try {
      const data = await api.tasks.runAi({ kind: "view_digest", tasks });
      const skipped = taskViewDigestSkippedCount(data);
      if (skipped > 0) {
        addToast(
          `${skipped} task${skipped === 1 ? "" : "s"} could not be included (no access).`,
          "info",
        );
      }
      setDigestText(formatTaskViewDigestResponse(data));
      setDigestPanelOpen(true);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "AI digest failed", "error");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-200 w-[min(100vw-1.5rem,52rem)] max-w-[calc(100vw-1.5rem)]">
      {digestPanelOpen && digestText ? (
        <div className="mb-2 rounded-2xl border border-border-dark bg-background-dark shadow-2xl p-4 max-h-56 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={`text-xs font-black uppercase tracking-wide inline-flex items-center gap-1.5 ${aiGradientTextClass()}`}>
              <AiSparkle size="xs" />
              Selection digest
            </span>
            <button
              type="button"
              onClick={() => setDigestPanelOpen(false)}
              className="cursor-pointer p-1 rounded-lg text-text-secondary hover:text-main hover:bg-white/5"
              aria-label="Close digest"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <pre className="text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed font-sans">
            {digestText}
          </pre>
        </div>
      ) : null}
      <div ref={menuRef} className="flex items-center gap-2 bg-background-dark border border-border-dark rounded-2xl shadow-2xl px-4 py-3 flex-wrap justify-center">
        <div className="flex items-center gap-2 pr-3 border-r border-border-dark">
          <div className="size-5 bg-primary rounded flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[12px]">check</span>
          </div>
          <span className="text-sm font-black text-white">{count} selected</span>
        </div>

        {/* Status */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-surface-dark border border-border-dark rounded-lg text-xs font-bold text-white hover:bg-white/5 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">radio_button_checked</span>
            Change Status
            <span className="material-symbols-outlined text-[12px] text-text-secondary">expand_more</span>
          </button>
          {openMenu === 'status' && (
            <div className="absolute bottom-full left-0 mb-2 bg-background-dark border border-border-dark rounded-xl shadow-2xl w-40 overflow-hidden animate-in fade-in duration-100">
              {STATUSES.map(s => (
                <button key={s.value} onClick={() => handleBulkStatus(s.value)}
                  className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors">
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'priority' ? null : 'priority')}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-surface-dark border border-border-dark rounded-lg text-xs font-bold text-white hover:bg-white/5 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">flag</span>
            Change Priority
            <span className="material-symbols-outlined text-[12px] text-text-secondary">expand_more</span>
          </button>
          {openMenu === 'priority' && (
            <div className="absolute bottom-full left-0 mb-2 bg-background-dark border border-border-dark rounded-xl shadow-2xl w-36 overflow-hidden animate-in fade-in duration-100">
              {PRIORITIES.map(p => (
                <button key={p.value} onClick={() => handleBulkPriority(p.value)}
                  className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedTasks && selectedTasks.length > 0 ? (
          <AiGradientButton
            busy={aiBusy}
            icon="summarize"
            onClick={() => void handleAiDigest()}
            className="cursor-pointer !py-1.5"
          >
            AI digest
          </AiGradientButton>
        ) : null}

        {/* Delete */}
        <button
          onClick={handleBulkDelete}
          disabled={allPluginSelected}
          title={allPluginSelected ? 'Synced tasks cannot be deleted in OneWork' : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${confirmDelete ? 'bg-red-500 border-red-600 text-white animate-pulse' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
        >
          <span className="material-symbols-outlined text-[14px]">{confirmDelete ? 'warning' : 'delete'}</span>
          {confirmDelete ? 'Confirm delete' : 'Delete'}
        </button>

        {/* Deselect */}
        <button onClick={onClear} className="cursor-pointer text-text-secondary hover:text-white transition-colors ml-1">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
    </div>
  );
};
