import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AssistantClientAction, AssistantPendingAction } from "@/types/assistant";
import type { Project, Task } from "@/types";
import type { CalendarDTO } from "@/types/calendar";
import { applyProjectSelection } from "@/lib/projects/projectSelection";
import { executeAssistantPendingAction } from "./assistantConfirmExecutor";

type OpenModalFn = (
  modal: string,
  payload?: Record<string, unknown>,
) => void;

export type AssistantClientActionDeps = {
  router: AppRouterInstance;
  openModal: OpenModalFn;
  openGlobalSearch: (query?: string) => void;
  switchWorkspace: (workspaceId: string) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  addToast: (
    message: string,
    type: "success" | "error" | "warning" | "info",
  ) => void;
  pathname: string;
  calendars: CalendarDTO[];
  projects: Project[];
  workspaceId: string | null;
  projectId: string | null;
  fetchNativeEvents: () => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void | Task>;
  bulkUpdateTasks: (ids: string[], updates: Partial<Task>) => Promise<void>;
};

export function executeAssistantClientActions(
  actions: AssistantClientAction[],
  deps: AssistantClientActionDeps,
): void {
  for (const action of actions) {
    switch (action.type) {
      case "navigate":
        if (action.path) deps.router.push(action.path);
        break;
      case "open_modal":
        deps.openModal(action.modal, action.payload);
        break;
      case "open_email_compose": {
        const params = new URLSearchParams();
        if (action.hints?.trim()) {
          params.set("hint", action.hints.trim().slice(0, 500));
        }
        const qs = params.toString();
        deps.router.push(qs ? `/email/compose?${qs}` : "/email/compose");
        break;
      }
      case "open_global_search":
        deps.openGlobalSearch(action.query);
        break;
      case "switch_workspace":
        deps.switchWorkspace(action.workspaceId);
        deps.addToast("Workspace switched.", "info");
        break;
      case "switch_project":
        applyProjectSelection({
          projectId: action.projectId,
          workspaceId: deps.workspaceId,
          pathname: deps.pathname,
          router: deps.router,
          setSelectedProjectId: deps.setSelectedProjectId,
        });
        deps.addToast("Project switched.", "info");
        break;
      case "open_quick_pr": {
        const params = new URLSearchParams();
        if (action.projectId) {
          params.set("projectId", action.projectId);
        } else if (deps.projectId) {
          params.set("projectId", deps.projectId);
        }
        params.set("quickPr", "1");
        deps.router.push(`/version-control?${params.toString()}`);
        break;
      }
      case "open_confirm":
        deps.openModal("confirm-action", {
          title: action.title,
          message: action.message,
          confirmLabel: action.confirmLabel,
          intent: action.intent,
          requireTextMatch: action.requireTextMatch,
          onConfirm: () =>
            executeAssistantPendingAction(action.pendingAction, {
              router: deps.router,
              openModal: deps.openModal,
              pathname: deps.pathname,
              calendars: deps.calendars,
              projects: deps.projects,
              workspaceId: deps.workspaceId,
              projectId: deps.projectId,
              fetchNativeEvents: deps.fetchNativeEvents,
              updateTask: deps.updateTask,
              bulkUpdateTasks: deps.bulkUpdateTasks,
              addToast: deps.addToast,
            }),
        });
        break;
      default:
        break;
    }
  }
}
