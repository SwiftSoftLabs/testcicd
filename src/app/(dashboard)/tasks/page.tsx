"use client";

import React, { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { mapTaskRecord } from "@/lib/tasks/mapTaskRecord";
import type { Task } from "@/types";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskTimeline } from "@/components/tasks/TaskTimeline";
import { TaskFilters } from "@/components/tasks/TaskFilters";
import { SprintBanner } from "@/components/tasks/SprintBanner";
import { BulkActionBar } from "@/components/tasks/BulkActionBar";
import { TasksPageAiDrawer } from "@/components/tasks/TasksPageAiDrawer";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { Status, Priority } from "@/types";
import ProjectScopeSelect from "@/components/ProjectScopeSelect";
import { usePageProjectScope } from "@/hooks/usePageProjectScope";
import { useProjectLock } from "@/hooks/useProjectLock";
import { useWorkspacePermissions } from "@/hooks/useWorkspacePermissions";
import { matchesAssigneeFilter } from "@/lib/tasks/assigneeFilter";

function TasksPageInner() {
  const [activeView, setActiveView] = useState<"kanban" | "list" | "timeline">(
    "kanban",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

  const VIEW_ICONS: Record<"kanban" | "list" | "timeline", string> = {
    kanban: "view_column",
    list: "format_list_bulleted",
    timeline: "timeline",
  };
  const VIEW_LABELS: Record<"kanban" | "list" | "timeline", string> = {
    kanban: "Board",
    list: "List",
    timeline: "Timeline",
  };
  const { openModal, addToast, modalStack } = useUIContext();
  const {
    tasks,
    users,
    sprints,
    projects,
    selectedWorkspaceId,
    setSelectedProjectId,
    isLoading,
    selectedSprintId,
    projectsSettled,
  } = useAppContext();
  const { can } = useWorkspacePermissions();
  const canManageTasks = can("manage_workflows");
  const searchParams = useSearchParams();
  const {
    selectedProjectId,
    selectedProject,
    setProjectId,
  } = usePageProjectScope(projects, {
    storageKey: selectedWorkspaceId ? `ow-selected-project-id:${selectedWorkspaceId}` : null,
    onProjectChange: setSelectedProjectId,
  });

  // Read filters from URL
  const q = searchParams.get("q") || "";
  const statusFilter =
    (searchParams.get("status")?.split(",").filter(Boolean) as Status[]) || [];
  const priorityFilter =
    (searchParams.get("priority")?.split(",").filter(Boolean) as Priority[]) ||
    [];
  const assigneeFilter = searchParams.get("assignee") || "";

  const filteredTasks = useMemo(() => {
    return (tasks || []).filter((t) => {
      if (selectedProjectId && t.projectId !== selectedProjectId) return false;
      if (selectedSprintId && t.sprintId !== selectedSprintId) return false;
      if (q && !t.title?.toLowerCase().includes(q.toLowerCase())) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(t.status))
        return false;
      if (priorityFilter.length > 0 && !priorityFilter.includes(t.priority))
        return false;
      if (!matchesAssigneeFilter(t.assigneeId, assigneeFilter)) return false;
      return true;
    });
  }, [q, statusFilter, priorityFilter, assigneeFilter, selectedProjectId, selectedSprintId, tasks]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setSelectedIds(new Set()));
    return () => cancelAnimationFrame(id);
  }, [selectedProjectId]);

  const openTaskId = searchParams.get("open");
  const openedTaskFromParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!openTaskId) {
      openedTaskFromParamRef.current = null;
      return;
    }
    if (!projectsSettled) return;
    if (openedTaskFromParamRef.current === openTaskId) return;

    let cancelled = false;

    const openTask = (task: Task) => {
      if (cancelled) return;

      const alreadyOpen = modalStack.some((entry) => {
        if (entry.id !== "task-detail") return false;
        const props = entry.props as { task?: Task } | null;
        return props?.task?.id === task.id;
      });
      if (alreadyOpen) {
        openedTaskFromParamRef.current = openTaskId;
        return;
      }

      if (task.projectId && task.projectId !== selectedProjectId) {
        setProjectId(task.projectId);
      }
      openedTaskFromParamRef.current = openTaskId;
      openModal("task-detail", { task });
    };

    const existing = tasks?.find((t) => t.id === openTaskId);
    if (existing) {
      openTask(existing);
      return () => {
        cancelled = true;
      };
    }

    void api.tasks.getOne(openTaskId).then(
      (data) => {
        if (cancelled) return;
        openTask(mapTaskRecord(data));
      },
      () => {
        if (cancelled) return;
        openedTaskFromParamRef.current = openTaskId;
        addToast("Task not found or you do not have access.", "error");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    addToast,
    modalStack,
    openTaskId,
    openModal,
    projectsSettled,
    selectedProjectId,
    setProjectId,
    tasks,
  ]);

  const bannerSprint = sprints.find((s) => s.status === "active") ?? sprints.find((s) => s.status === "planning");
  const isLockedProject = useProjectLock(selectedProjectId);
  const canWriteSelectedProject = canManageTasks && !isLockedProject;

  const handleSelectChange = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary font-bold animate-pulse uppercase tracking-widest text-xs">
            Loading Tasks...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background-dark">
      <header className="px-4 sm:px-6 py-4 flex flex-col gap-3 bg-background-dark border-b border-border-dark shrink-0">
        {/* Row 1: Project selector + Sprint banner */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full">
          <ProjectScopeSelect
            projects={projects}
            selectedProjectId={selectedProjectId}
            onChange={setProjectId}
            className="w-full sm:w-[260px] shrink-0"
          />
          {bannerSprint && (
            <div className="flex-1 min-w-0">
              <SprintBanner sprint={bannerSprint} tasks={tasks.filter(t => t.sprintId === bannerSprint.id)} className="w-full" readOnly={isLockedProject} />
            </div>
          )}
        </div>

        {/* Row 2: View tabs + action buttons */}
        <div className="flex items-center justify-between gap-2">
          {/* Desktop tabs — hidden below 450px */}
          <div className="hidden min-[450px]:flex gap-1 sm:gap-4 border-b border-border-dark/50 flex-1 overflow-x-auto">
            {(["kanban", "list", "timeline"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={`cursor-pointer px-2 sm:px-4 py-2 text-sm font-bold flex items-center gap-1.5 sm:gap-2 transition-all whitespace-nowrap shrink-0 ${activeView === v ? "text-white border-b-2 border-primary" : "text-text-secondary hover:text-white border-b-2 border-transparent"}`}
              >
                <span className="material-symbols-outlined text-[18px]">{VIEW_ICONS[v]}</span>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          {/* Mobile view dropdown — shown below 450px */}
          <div className="flex min-[450px]:hidden flex-1 relative">
            <button
              onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
              className="cursor-pointer flex items-center gap-2 px-3 py-2 bg-surface-dark border border-border-dark rounded-xl text-sm font-bold text-white w-full"
            >
              <span className="material-symbols-outlined text-[18px]">{VIEW_ICONS[activeView]}</span>
              <span>{VIEW_LABELS[activeView]}</span>
              <span className="material-symbols-outlined text-text-secondary text-[16px] ml-auto">
                {viewDropdownOpen ? "expand_less" : "expand_more"}
              </span>
            </button>
            {viewDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40 dismiss-backdrop" onClick={() => setViewDropdownOpen(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in duration-100">
                  {(["kanban", "list", "timeline"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => { setActiveView(v); setViewDropdownOpen(false); }}
                      className={`cursor-pointer w-full px-4 py-3 flex items-center gap-3 text-sm font-bold transition-colors hover:bg-white/5 ${activeView === v ? "text-primary bg-white/5" : "text-white"}`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{VIEW_ICONS[v]}</span>
                      {VIEW_LABELS[v]}
                      {activeView === v && (
                        <span className="material-symbols-outlined text-primary text-[16px] ml-auto">check</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => !isLockedProject && openModal("sprint-modal")}
              disabled={isLockedProject}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs font-bold bg-white/5 border border-border-dark text-text-secondary hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
              title={isLockedProject ? "This project is read-only" : "Sprint"}
            >
              <span className="material-symbols-outlined text-[16px]">sprint</span>
              <span className="hidden sm:inline">Sprint</span>
            </button>
            {canManageTasks && (
              <button
                onClick={() => openModal("new-task", { initialProjectId: selectedProjectId ?? undefined })}
                className="bg-primary hover:bg-blue-600 text-white px-2 sm:px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!selectedProject || isLockedProject}
                title={isLockedProject ? "This project is read-only because it is over the plan limit." : "New Task"}
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span className="hidden sm:inline">New Task</span>
              </button>
            )}
            <button
              onClick={() => !isLockedProject && openModal("template-picker")}
              disabled={isLockedProject}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs font-bold bg-white/5 border border-border-dark text-text-secondary hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary"
              title={isLockedProject ? "This project is read-only" : "Manage templates"}
            >
              <span className="material-symbols-outlined text-[16px]">description</span>
              <span className="hidden sm:inline">Templates</span>
            </button>
          </div>
        </div>
      </header>

      {canManageTasks && !isLockedProject && (
        <TasksPageAiDrawer
          filteredTasks={filteredTasks}
          onOpenNewTaskWithDraft={(draft) =>
            openModal("new-task", {
              initialProjectId: selectedProjectId ?? undefined,
              initialTitle: draft.title,
              initialDescription: draft.description,
              initialPriority: draft.priority,
              initialTags: draft.tags.join(", "),
            })
          }
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden bg-background-dark">
        <TaskFilters onSearchChange={() => {}} users={users} workspaceId={selectedWorkspaceId ?? null} readOnly={isLockedProject} />

        <div className="flex-1 min-h-0 overflow-x-auto p-3 sm:p-6 scroll-smooth custom-scrollbar bg-background-dark relative">
          {isLockedProject && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              This project is read-only because your workspace is over its plan limit. Upgrade to restore editing.
            </div>
          )}
          {activeView === "kanban" && (
            <div className="h-full min-h-[calc(100vh-280px)]">
              <TaskBoard
                tasks={filteredTasks}
                users={users}
                selectedIds={selectedIds}
                onSelectChange={handleSelectChange}
                initialProjectId={selectedProjectId}
                canEditTasks={!isLockedProject}
                canManageTasks={canWriteSelectedProject}
                isReadOnlyProject={isLockedProject}
              />
            </div>
          )}
          {activeView === "list" && (
            <TaskList
              tasks={filteredTasks}
              users={users}
              selectedIds={selectedIds}
              onSelectChange={handleSelectChange}
              isReadOnly={isLockedProject}
            />
          )}
          {activeView === "timeline" && (
            <TaskTimeline tasks={filteredTasks} users={users} sprints={sprints} selectedSprintId={selectedSprintId} isReadOnly={isLockedProject} />
          )}
        </div>
      </div>

      {canManageTasks && !isLockedProject && selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          selectedTasks={filteredTasks.filter((t) => selectedIds.has(t.id))}
        />
      )}

      <div className="h-6 shrink-0 pointer-events-none" />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center bg-background-dark">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}
