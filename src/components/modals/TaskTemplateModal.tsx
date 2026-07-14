"use client";

import React, { useEffect, useRef, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { TaskTemplate } from "@/types";
import { api } from "@/lib/api";

interface TaskTemplateModalProps {
  onClose: () => void;
  onSelect?: (template: TaskTemplate) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-400",
  high: "text-orange-400",
  medium: "text-blue-400",
  low: "text-slate-400",
};

const TaskTemplateModal: React.FC<TaskTemplateModalProps> = ({
  onClose,
  onSelect,
}) => {
  const { selectedWorkspaceId } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, onClose);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(selectedWorkspaceId));
  const [search, setSearch] = useState("");

  const isManageMode = !onSelect;

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    api.taskTemplates
      .getAll(selectedWorkspaceId)
      .then((data) => setTemplates(data as TaskTemplate[]))
      .catch(() => addToast("Failed to load templates", "error"))
      .finally(() => setIsLoading(false));
  }, [addToast, selectedWorkspaceId]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.taskTemplates.delete(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      addToast("Template deleted", "success");
    } catch {
      addToast("Failed to delete template", "error");
    }
  };

  const handleUse = (tmpl: TaskTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    openModal("new-task", {
      initialTitle: tmpl.title,
      initialDescription: tmpl.description,
      initialPriority: tmpl.priority,
      initialTags: tmpl.tags.join(", "),
      initialAssigneeId: tmpl.default_assignee_id,
    });
  };

  const handleEdit = (tmpl: TaskTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    openModal("edit-template", {
      template: tmpl,
      onSaved: (updated: TaskTemplate) =>
        setTemplates((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t)),
        ),
    });
  };

  const filtered = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      ref={modalRef}
      className="w-full max-w-lg mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between">
        <h2 className="text-lg font-black text-white">
          {isManageMode ? "Manage Templates" : "Task Templates"}
        </h2>
        <button
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white"
          aria-label="Close dialog"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="px-6 pt-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary outline-none"
        />
      </div>

      <div className="p-6 space-y-3 max-h-[calc(100dvh-12rem)] overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="size-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 opacity-30">
            <span className="material-symbols-outlined text-4xl">
              description
            </span>
            <p className="text-xs font-bold uppercase tracking-widest mt-2">
              {templates.length === 0 ? "No templates yet" : "No matches"}
            </p>
            {templates.length === 0 && (
              <p className="text-[11px] text-text-secondary mt-1">
                Save any task as a template from the task detail view
              </p>
            )}
          </div>
        ) : (
          filtered.map((tmpl) =>
            isManageMode ? (
              /* Manage mode: explicit Use / Edit / Delete buttons */
              <div
                key={tmpl.id}
                className="w-full p-4 bg-background-dark border border-border-dark rounded-xl hover:border-white/10 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-black text-white truncate">
                        {tmpl.name}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase ${PRIORITY_COLORS[tmpl.priority]}`}
                      >
                        {tmpl.priority}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-secondary truncate">
                      {tmpl.title}
                    </p>
                    {tmpl.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {tmpl.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-surface-dark border border-border-dark text-[9px] font-bold text-text-secondary rounded uppercase"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleUse(tmpl, e)}
                      className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:text-white border border-border-dark hover:border-white/20 rounded-lg transition-all"
                      aria-label={`Use template ${tmpl.name}`}
                    >
                      <span className="material-symbols-outlined text-[13px]">add_task</span>
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleEdit(tmpl, e)}
                      className="cursor-pointer p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                      aria-label={`Edit template ${tmpl.name}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(tmpl.id, e)}
                      className="cursor-pointer p-1.5 text-text-secondary hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10"
                      aria-label={`Delete template ${tmpl.name}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Picker mode: click card to apply */
              <div
                key={tmpl.id}
                className="w-full p-4 bg-background-dark border border-border-dark rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSelect?.(tmpl);
                        onClose();
                      }}
                      className="cursor-pointer w-full text-left"
                      aria-label={`Use template ${tmpl.name}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-black text-white group-hover:text-primary transition-colors truncate">
                          {tmpl.name}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase ${PRIORITY_COLORS[tmpl.priority]}`}
                        >
                          {tmpl.priority}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-secondary truncate">
                        {tmpl.title}
                      </p>
                    </button>
                    {tmpl.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {tmpl.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-surface-dark border border-border-dark text-[9px] font-bold text-text-secondary rounded uppercase"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(tmpl.id, e)}
                    className="cursor-pointer shrink-0 text-text-secondary transition-all hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete template ${tmpl.name}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      delete
                    </span>
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
};

export default TaskTemplateModal;
