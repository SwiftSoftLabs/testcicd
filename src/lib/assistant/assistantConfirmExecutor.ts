import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { api } from "@/lib/api";
import { callRoomHref } from "@/lib/calls/joinSession";
import type { AssistantPendingAction } from "@/types/assistant";
import type { Project, Task } from "@/types";
import type { CalendarDTO } from "@/types/calendar";

type OpenModalFn = (
  modal: string,
  payload?: Record<string, unknown>,
) => void;

export async function executeAssistantPendingAction(
  action: AssistantPendingAction,
  deps: {
    router: AppRouterInstance;
    openModal: OpenModalFn;
    pathname: string;
    calendars: CalendarDTO[];
    projects: Project[];
    workspaceId: string | null;
    projectId: string | null;
    fetchNativeEvents: () => Promise<void>;
    updateTask: (id: string, updates: Partial<Task>) => Promise<void | Task>;
    bulkUpdateTasks: (ids: string[], updates: Partial<Task>) => Promise<void>;
    addToast: (
      message: string,
      type: "success" | "error" | "warning" | "info",
    ) => void;
  },
): Promise<void> {
  switch (action.kind) {
    case "start_call": {
      const participantCount = action.participantUserIds.length;
      const payload: Record<string, unknown> = {
        workspace_id: action.workspaceId,
        title: action.title || "Meeting",
        type: participantCount <= 1 ? "instant_1_1" : "instant_group",
        participant_ids: action.participantUserIds,
      };
      if (action.projectId) payload.project_id = action.projectId;
      if (action.conversationId) {
        payload.conversation_id = action.conversationId;
      }
      const call = await api.calls.create(payload);
      deps.router.push(callRoomHref(call.id, deps.pathname));
      return;
    }

    case "create_calendar_event": {
      if (!deps.workspaceId) {
        throw new Error("Select a workspace first.");
      }
      deps.openModal("calendar-event", {
        calendars: deps.calendars,
        projects: deps.projects,
        workspaceId: deps.workspaceId,
        initialStart: action.startAt,
        initialEnd: action.endAt ?? undefined,
        initialTitle: action.title,
        initialProjectId: action.projectId ?? deps.projectId ?? undefined,
      });
      return;
    }

    case "update_task": {
      const taskUpdates: Partial<Task> = {};
      switch (action.action) {
        case "complete":
          taskUpdates.status = "done";
          break;
        case "assign":
          taskUpdates.assigneeId = action.assigneeId ?? "";
          break;
        case "set_status":
          if (action.status) {
            taskUpdates.status = action.status as Task["status"];
          }
          break;
        case "set_priority":
          if (action.priority) {
            taskUpdates.priority = action.priority as Task["priority"];
          }
          break;
        case "move_project":
          if (action.projectId !== undefined) {
            taskUpdates.projectId = action.projectId;
          }
          break;
        default:
          break;
      }
      if (!Object.keys(taskUpdates).length) {
        throw new Error("No task changes to apply.");
      }
      await deps.updateTask(action.taskId, taskUpdates);
      const label = action.taskLabel ?? "Task";
      deps.addToast(`${label} updated.`, "success");
      return;
    }

    case "bulk_update_tasks": {
      const bulkUpdates: Partial<Task> = {};
      if (action.action === "set_status" && action.status) {
        bulkUpdates.status = action.status as Task["status"];
      }
      if (action.action === "move_project" && action.projectId) {
        bulkUpdates.projectId = action.projectId;
      }
      if (!Object.keys(bulkUpdates).length) {
        throw new Error("No bulk task changes to apply.");
      }
      await deps.bulkUpdateTasks(action.taskIds, bulkUpdates);
      deps.addToast(`${action.taskIds.length} task(s) updated.`, "success");
      return;
    }

    case "send_email": {
      window.dispatchEvent(new CustomEvent("assistant:send-email"));
      return;
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown pending action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
