"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCorners,
  rectIntersection,
  type CollisionDetection,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { useCombinedRefs } from "@dnd-kit/utilities";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { TaskSourceBadge } from "@/components/tasks/TaskSourceBadge";
import { getTaskDisplayKey } from "@/lib/tasks/taskKey";
import { Status, Task, User } from "@/types";
import { format, isPast, isToday, parseISO } from "date-fns";
import PresenceDot from "@/components/PresenceDot";
import { presenceFromMemberStatus } from "@/lib/presence";

interface TaskBoardProps {
  tasks: Task[];
  users: User[];
  selectedIds?: Set<string>;
  onSelectChange?: (id: string, selected: boolean) => void;
  initialProjectId?: string | null;
  canEditTasks?: boolean;
  canManageTasks?: boolean;
  isReadOnlyProject?: boolean;
}

const COLUMNS: { id: Status; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-slate-400" },
  { id: "todo", label: "To Do", color: "text-blue-400" },
  { id: "in-progress", label: "In Progress", color: "text-primary" },
  { id: "review", label: "Review", color: "text-purple-400" },
  { id: "done", label: "Done", color: "text-emerald-400" },
];

const STATUS_DOT: Record<Status, string> = {
  backlog: "bg-slate-400",
  todo: "bg-blue-400",
  "in-progress": "bg-primary",
  review: "bg-purple-400",
  done: "bg-emerald-400",
};

/** Matches tasks page header + filters; keeps every column the same drop height. */
const BOARD_COLUMN_MIN_HEIGHT = "calc(100vh - 280px)";

const taskDropId = (taskId: string) => `drop-task:${taskId}`;

const parseTaskDropId = (id: string): string | undefined =>
  id.startsWith("drop-task:") ? id.slice("drop-task:".length) : undefined;

function DueDateBadge({ dueDate }: { dueDate?: string }) {
  if (!dueDate) return null;
  const date = parseISO(dueDate);
  const overdue = isPast(date) && !isToday(date);
  const due_today = isToday(date);
  return (
    <span
      className={`text-[10px] font-bold ${overdue ? "text-red-400" : due_today ? "text-amber-400" : "text-text-secondary"}`}
    >
      {overdue ? "⚠ Overdue · " : ""}
      {format(date, "MMM d")}
    </span>
  );
}

function SubtaskBadge({ count, done }: { count?: number; done?: number }) {
  if (!count || count === 0) return null;
  const pct = Math.round(((done || 0) / count) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] font-bold text-text-secondary">
        {done}/{count}
      </span>
    </div>
  );
}

interface DraggableTaskCardProps {
  task: Task;
  users: User[];
  isSelected?: boolean;
  onSelect?: (id: string, sel: boolean) => void;
  onOpen: (task: Task) => void;
  readOnly?: boolean;
}

function DraggableTaskCard({
  task,
  users,
  isSelected,
  onSelect,
  onOpen,
  readOnly = false,
}: DraggableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: task.id,
    disabled: readOnly,
    data: { type: "task", status: task.status },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: taskDropId(task.id),
    disabled: readOnly,
    data: { type: "task", status: task.status, taskId: task.id },
  });
  const setNodeRef = useCombinedRefs(setDragRef, setDropRef);

  const getPriorityIcon = (p: string) => {
    if (p === "urgent")
      return (
        <span className="material-symbols-outlined text-red-500 text-[16px]">
          error
        </span>
      );
    if (p === "high")
      return (
        <span className="material-symbols-outlined text-orange-400 text-[16px]">
          keyboard_double_arrow_up
        </span>
      );
    if (p === "medium")
      return (
        <span className="material-symbols-outlined text-yellow-400 text-[16px]">
          drag_handle
        </span>
      );
    return (
      <span className="material-symbols-outlined text-emerald-400 text-[16px]">
        keyboard_double_arrow_down
      </span>
    );
  };

  const assignee = users.find((u) => u.id === task.assigneeId);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative bg-surface-dark border rounded-xl shadow-lg transition-all group select-none ${readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${isDragging ? "opacity-40" : "opacity-100"} ${isOver ? "border-primary/60 ring-2 ring-primary/30 bg-primary/5" : ""} ${isSelected ? "border-primary/60 ring-1 ring-primary/30" : "border-border-dark hover:border-border-dark/80"}`}
    >
      {/* Checkbox on hover */}
      <div
        className={`absolute top-3 left-3 z-20 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${readOnly ? "pointer-events-none" : "cursor-pointer"}`}
        onClick={(e) => {
          if (readOnly) return;
          e.stopPropagation();
          onSelect?.(task.id, !isSelected);
        }}
      >
        <div
          className={`size-4 rounded border-2 flex items-center justify-center transition-all ${isSelected ? "bg-primary border-primary" : "border-border-dark bg-background-dark"}`}
        >
          {isSelected && (
            <span className="material-symbols-outlined text-white text-[10px]">
              check
            </span>
          )}
        </div>
      </div>

      <div className="p-4 cursor-pointer" onClick={() => onOpen(task)}>
        <div className="flex justify-between items-center mb-2 pl-5">
          <span className="text-[10px] font-mono text-text-secondary">
            {getTaskDisplayKey(task)}
          </span>
          {getPriorityIcon(task.priority)}
        </div>

        <div className="flex items-start gap-1.5 mb-3 pl-5">
          <h4 className="text-white text-sm font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2 flex-1 min-w-0">
            {task.title}
          </h4>
          {task.source === "plugin" && task.sourceProvider ? (
            <TaskSourceBadge provider={task.sourceProvider} />
          ) : null}
        </div>

        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3 pl-5">
            {task.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 bg-surface-highlight border border-border-dark text-[9px] font-bold text-text-secondary rounded uppercase tracking-tighter"
              >
                {tag}
              </span>
            ))}
            {task.tags.length > 3 && (
              <span className="text-[9px] font-bold text-text-secondary">
                +{task.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {task.subtaskCount && task.subtaskCount > 0 ? (
          <div className="mb-3 pl-5">
            <SubtaskBadge
              count={task.subtaskCount}
              done={task.subtaskDoneCount}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <div className="flex items-center gap-2 pl-5">
            {assignee?.avatar && (
              <div className="relative inline-flex shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="size-6 rounded-full border border-border-dark bg-slate-600 object-cover"
                  src={assignee.avatar}
                  alt=""
                />
                <span className="absolute -bottom-0.5 -right-0.5">
                  <PresenceDot status={presenceFromMemberStatus(assignee.status)} size="sm" ring />
                </span>
              </div>
            )}
            <DueDateBadge dueDate={task.dueDate} />
          </div>
          <div className="flex gap-2.5 text-text-secondary">
            {task.commentsCount > 0 && (
              <div className="flex items-center gap-1 text-[10px] font-bold">
                <span className="material-symbols-outlined text-[14px]">
                  chat_bubble
                </span>{" "}
                {task.commentsCount}
              </div>
            )}
            {task.attachmentCount && task.attachmentCount > 0 ? (
              <div className="flex items-center gap-1 text-[10px] font-bold">
                <span className="material-symbols-outlined text-[14px]">
                  attach_file
                </span>{" "}
                {task.attachmentCount}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  users,
  selectedIds = new Set(),
  onSelectChange,
  initialProjectId,
  canEditTasks = true,
  canManageTasks = false,
  isReadOnlyProject = false,
}) => {
  const { openModal } = useUIContext();
  const { updateTask } = useAppContext();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedMobileColumn, setSelectedMobileColumn] = useState<Status>("todo");
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 450px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const columnIds = useMemo(() => new Set(COLUMNS.map((c) => c.id)), []);
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);
      const collisions =
        pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);

      const taskCollision = collisions.find((c) => {
        const droppedTaskId = parseTaskDropId(String(c.id));
        return (
          droppedTaskId !== undefined &&
          droppedTaskId !== String(args.active.id) &&
          taskById.has(droppedTaskId)
        );
      });
      if (taskCollision) return [taskCollision];

      const columnCollision = collisions.find((c) =>
        columnIds.has(String(c.id) as Status),
      );
      if (columnCollision) return [columnCollision];

      if (collisions.length > 0) return collisions;
      return rectIntersection(args);
    },
    [taskById, columnIds],
  );

  const lastOverIdRef = useRef<string | null>(null);

  const getTasksByStatus = (status: Status) =>
    tasks.filter((t) => t.status === status);

  const resolveTargetStatus = useCallback(
    (overId: string): Status | undefined => {
      if (columnIds.has(overId as Status)) return overId as Status;
      const droppedTaskId = parseTaskDropId(overId) ?? overId;
      const overTask = taskById.get(droppedTaskId);
      return overTask?.status;
    },
    [columnIds, taskById],
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (isReadOnlyProject) return;
    lastOverIdRef.current = null;
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    if (!over || String(over.id) === String(active.id)) {
      lastOverIdRef.current = null;
      return;
    }
    lastOverIdRef.current = String(over.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    if (!canEditTasks) return;

    const taskId = String(active.id);
    const overId = over ? String(over.id) : lastOverIdRef.current;
    lastOverIdRef.current = null;
    if (!overId) return;

    const droppedOnSelf =
      overId === taskId || parseTaskDropId(overId) === taskId;
    if (droppedOnSelf) return;

    const targetStatus = resolveTargetStatus(overId);
    if (!targetStatus) return;

    const task = taskById.get(taskId);
    if (!task || task.status === targetStatus) return;

    updateTask(taskId, { status: targetStatus }).catch(() => {});
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    lastOverIdRef.current = null;
  };

  const activeMobileCol = COLUMNS.find((c) => c.id === selectedMobileColumn)!;

  return (
    <div className="h-full min-h-0">
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {isMobile ? (
        /* Mobile: single column with status picker */
        <div className="flex flex-col gap-3 h-full">
          {/* Status column picker */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="cursor-pointer w-full flex items-center gap-3 px-4 py-3 bg-surface-dark border border-border-dark rounded-xl text-sm font-bold text-white"
            >
              <span className={`size-2.5 rounded-full shrink-0 ${STATUS_DOT[selectedMobileColumn]}`} />
              <span className={activeMobileCol.color}>{activeMobileCol.label}</span>
              <span className="text-text-secondary text-xs font-medium">
                {getTasksByStatus(selectedMobileColumn).length} tasks
              </span>
              <span className="material-symbols-outlined text-text-secondary text-[18px] ml-auto">
                {showColumnPicker ? "expand_less" : "expand_more"}
              </span>
            </button>
            {showColumnPicker && (
              <>
                <div className="fixed inset-0 z-40 dismiss-backdrop" onClick={() => setShowColumnPicker(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in duration-100">
                  {COLUMNS.map((col) => {
                    const count = getTasksByStatus(col.id).length;
                    return (
                      <button
                        key={col.id}
                        onClick={() => { setSelectedMobileColumn(col.id); setShowColumnPicker(false); }}
                        className={`cursor-pointer w-full px-4 py-3 flex items-center gap-3 text-sm font-bold transition-colors hover:bg-white/5 ${selectedMobileColumn === col.id ? "bg-white/5" : ""}`}
                      >
                        <span className={`size-2.5 rounded-full shrink-0 ${STATUS_DOT[col.id]}`} />
                        <span className={col.color}>{col.label}</span>
                        <span className="text-text-secondary text-xs font-medium ml-1">{count} tasks</span>
                        {selectedMobileColumn === col.id && (
                          <span className="material-symbols-outlined text-primary text-[16px] ml-auto">check</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Active column — full width */}
          <DroppableColumn
            key={selectedMobileColumn}
            col={activeMobileCol}
            tasks={getTasksByStatus(selectedMobileColumn)}
            users={users}
            selectedIds={selectedIds}
            onSelectChange={onSelectChange}
            onOpen={(task) => openModal("task-detail", { task })}
            onAddTask={
              canManageTasks
                ? () => openModal("new-task", { initialStatus: selectedMobileColumn, initialProjectId: initialProjectId ?? undefined })
                : undefined
            }
            addDisabled={isReadOnlyProject}
            readOnly={isReadOnlyProject}
            fullWidth
          />
        </div>
      ) : (
        /* Desktop: all columns side by side — equal height for reliable drop targets */
        <div
          className="flex h-full items-stretch gap-4 pb-4 w-max min-w-full"
          style={{ minHeight: BOARD_COLUMN_MIN_HEIGHT }}
        >
          {COLUMNS.map((col) => {
            const colTasks = getTasksByStatus(col.id);
            return (
              <DroppableColumn
                key={col.id}
                col={col}
                tasks={colTasks}
                users={users}
                selectedIds={selectedIds}
                onSelectChange={onSelectChange}
                onOpen={(task) => openModal("task-detail", { task })}
                onAddTask={
                  canManageTasks
                    ? () => openModal("new-task", { initialStatus: col.id, initialProjectId: initialProjectId ?? undefined })
                    : undefined
                }
                addDisabled={isReadOnlyProject}
                readOnly={isReadOnlyProject}
              />
            );
          })}
        </div>
      )}

      <DragOverlay>
        {activeTask ? (
          <div className="bg-surface-dark border border-primary/40 p-4 rounded-xl shadow-2xl opacity-90 w-[340px]">
            <p className="text-white text-sm font-bold truncate">
              {activeTask.title}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
    </div>
  );
};

function ColumnDropZone({
  colId,
  className,
  children,
}: {
  colId: Status;
  className?: string;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: colId,
    data: { type: "column", status: colId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ""} ${isOver ? "bg-primary/5 ring-1 ring-inset ring-primary/20 rounded-lg" : ""}`}
    >
      {children}
    </div>
  );
}

function DroppableColumn({
  col,
  tasks,
  users,
  selectedIds,
  onSelectChange,
  onOpen,
  onAddTask,
  addDisabled = false,
  fullWidth = false,
  readOnly = false,
}: {
  col: { id: Status; label: string; color: string };
  tasks: Task[];
  users: User[];
  selectedIds: Set<string>;
  onSelectChange?: (id: string, sel: boolean) => void;
  onOpen: (task: Task) => void;
  onAddTask?: () => void;
  addDisabled?: boolean;
  fullWidth?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div
      className={`${fullWidth ? "w-full flex-1 min-h-0" : "w-[340px] shrink-0 self-stretch"} flex flex-col min-h-0 rounded-xl border border-border-dark/50 bg-[#161b22]/20 shadow-sm`}
      style={fullWidth ? undefined : { minHeight: BOARD_COLUMN_MIN_HEIGHT }}
    >
      <div className="p-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${STATUS_DOT[col.id]}`} />
          <span className={`text-sm font-bold ${col.color}`}>{col.label}</span>
          <span className="bg-surface-highlight text-text-secondary text-[11px] font-bold px-1.5 py-0.5 rounded-md ml-1">
            {tasks.length}
          </span>
        </div>
        {onAddTask && (
          <button
            onClick={onAddTask}
            disabled={addDisabled}
            title={addDisabled ? 'This project is read-only because it is over the plan limit.' : 'Add task'}
            className="text-text-secondary hover:text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 custom-scrollbar flex flex-col">
        {tasks.length === 0 ? (
          <ColumnDropZone
            colId={col.id}
            className="flex flex-1 flex-col items-center justify-center min-h-[120px] opacity-20"
          >
            <span className="material-symbols-outlined text-3xl">inbox</span>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-1">
              Empty
            </p>
          </ColumnDropZone>
        ) : (
          <>
            <div className="space-y-3">
              {tasks.map((task) => (
                <DraggableTaskCard
                  key={task.id}
                  task={task}
                  users={users}
                  isSelected={selectedIds.has(task.id)}
                  onSelect={onSelectChange}
                  onOpen={onOpen}
                  readOnly={readOnly}
                />
              ))}
            </div>
            <ColumnDropZone colId={col.id} className="flex-1 min-h-[48px] mt-3" />
          </>
        )}
      </div>
    </div>
  );
}
