import type { PermissionKey } from "@/lib/rbac/permissions";

export type AssistantModule =
  | "dashboard"
  | "tasks"
  | "calendar"
  | "version-control"
  | "chat"
  | "email"
  | "calls"
  | "files"
  | "analytics"
  | "vault"
  | "settings"
  | "notifications"
  | "support";

export type AssistantModalId =
  | "new-task"
  | "new-message"
  | "calendar-event";

/** Serializable pending action executed after user confirms in ConfirmActionModal. */
export type AssistantPendingAction =
  | {
      kind: "start_call";
      workspaceId: string;
      title: string;
      participantUserIds: string[];
      projectId?: string | null;
      conversationId?: string | null;
    }
  | {
      kind: "create_calendar_event";
      workspaceId: string;
      title: string;
      startAt: string;
      endAt?: string | null;
      projectId?: string | null;
    }
  | {
      kind: "update_task";
      taskId: string;
      action:
        | "complete"
        | "assign"
        | "set_status"
        | "set_priority"
        | "move_project";
      assigneeId?: string | null;
      status?: string;
      priority?: string;
      projectId?: string | null;
      taskLabel?: string;
    }
  | {
      kind: "bulk_update_tasks";
      taskIds: string[];
      action: "set_status" | "move_project";
      status?: string;
      projectId?: string | null;
    }
  | { kind: "send_email"; messageId: string };

export type AssistantClientAction =
  | { type: "navigate"; path: string }
  | {
      type: "open_modal";
      modal: AssistantModalId;
      payload?: Record<string, unknown>;
    }
  | { type: "open_email_compose"; hints?: string }
  | { type: "open_global_search"; query: string }
  | { type: "switch_workspace"; workspaceId: string }
  | { type: "switch_project"; projectId: string }
  | { type: "open_quick_pr"; projectId?: string }
  | {
      type: "open_confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      intent?: "danger" | "default";
      requireTextMatch?: string;
      pendingAction: AssistantPendingAction;
    };

export interface AssistantPageContext {
  pathname: string;
  workspaceId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  emailMessageId?: string | null;
  taskId?: string | null;
}

export type AssistantCommandSource = "voice" | "typed";

export interface AssistantCommandRequest {
  transcript: string;
  pageContext: AssistantPageContext;
  source?: AssistantCommandSource;
}

export interface AssistantCommandResponse {
  spokenReply: string;
  clientActions: AssistantClientAction[];
  data?: Record<string, unknown>;
  toolName?: string;
  /** True when the command is outside OneWork — no navigation or modals. */
  unsupported?: boolean;
}

export interface AssistantRouteDefinition {
  path: string;
  label: string;
  module: AssistantModule;
  requires?: PermissionKey;
  /** Any one of these permissions grants access (e.g. invite OR manage members). */
  requiresAny?: PermissionKey[];
  requiresProject?: boolean;
}

/** All assistant tool names — keep in sync with assistantToolRegistry.ts */
export const ASSISTANT_TOOL_NAMES = [
  "navigate",
  "open_modal",
  "create_task_draft",
  "open_email_compose",
  "summarize_context",
  "open_quick_pr",
  "open_global_search",
  "switch_workspace",
  "switch_project",
  "filter_tasks",
  "draft_chat_reply",
  "draft_email_reply",
  "summarize_email_thread",
  "start_call",
  "create_calendar_event",
  "update_task",
  "bulk_update_tasks",
  "send_email",
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];
