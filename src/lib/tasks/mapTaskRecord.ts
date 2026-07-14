import type { Task } from "@/types";

interface TaskApiRecord {
  id: string;
  task_key?: string | null;
  task_number?: number | null;
  title: string;
  description?: string | null;
  status: Task["status"];
  priority: Task["priority"];
  assignee_id?: string | null;
  project_id?: string | null;
  tags?: string[] | null;
  comments_count?: number | null;
  due_date?: string | null;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  estimated_hours?: number | string | null;
  subtask_count?: number | null;
  subtask_done_count?: number | null;
  attachment_count?: number | null;
  source_call_id?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  source?: string | null;
  source_plugin_provider?: string | null;
}

export function mapTaskRecord(task: unknown): Task {
  const t = task as TaskApiRecord;
  return {
    id: t.id,
    taskKey: t.task_key ?? undefined,
    taskNumber: t.task_number ?? undefined,
    title: t.title,
    description: t.description ?? undefined,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id ?? "",
    projectId: t.project_id ?? undefined,
    tags: t.tags || [],
    commentsCount: t.comments_count || 0,
    dueDate: t.due_date ?? undefined,
    parentTaskId: t.parent_task_id ?? undefined,
    sprintId: t.sprint_id ?? undefined,
    estimatedHours:
      t.estimated_hours != null ? Number(t.estimated_hours) : undefined,
    subtaskCount: t.subtask_count || 0,
    subtaskDoneCount: t.subtask_done_count || 0,
    attachmentCount: t.attachment_count || 0,
    sourceCallId: t.source_call_id ?? undefined,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    completedAt: t.completed_at ?? undefined,
    source: t.source === "plugin" ? "plugin" : "local",
    sourceProvider:
      t.source === "plugin" && t.source_plugin_provider
        ? (t.source_plugin_provider as Task["sourceProvider"])
        : undefined,
  };
}
