import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { loadMessagesForAi } from "@/lib/chat/chatAccess";
import { runChatAi } from "@/lib/chat/chatAiService";
import { query, SCHEMA } from "@/lib/db";
import { handleEmailAiPost } from "@/lib/email/emailAiService";
import { requireWorkspaceTasksWrite } from "@/lib/rbac/task-access";
import { runTaskAi, type TaskFilterRosterEntry } from "@/lib/tasks/taskAiService";
import type { AssistantClientAction, AssistantPendingAction } from "@/types/assistant";
import type { ResolvedAssistantContext } from "./assistantContext";
import { isPathAllowed } from "./assistantContext";
import {
  BULK_TASK_CAP,
  extractNameAfterPattern,
  findTaskByReference,
  findTaskIdsByFilter,
  loadUserWorkspaces,
  loadWorkspaceMembers,
  loadWorkspaceProjects,
  isStatusDestinationPhrase,
  normalizeTaskStatus,
  resolveByName,
  resolveProjectReference,
  type TaskFilterCriteria,
} from "./assistantResolveContext";
import {
  loadUpcomingCalendarEvents,
  summarizeCalendarEvents,
} from "./summarizeCalendar";
import type { ToolExecutionResult } from "./assistantTools";

const STATUS_ALLOW = new Set(["backlog", "todo", "in-progress", "review", "done"]);
const PRIORITY_ALLOW = new Set(["urgent", "high", "medium", "low"]);

function statusFromTaskUpdateArgs(
  args: Record<string, unknown>,
): string | null {
  const candidates = [
    typeof args.status === "string" ? args.status.trim() : "",
    typeof args.projectReference === "string" ? args.projectReference.trim() : "",
    typeof args.projectName === "string" ? args.projectName.trim() : "",
  ].filter((value) => value.length > 0);

  for (const candidate of candidates) {
    const status = normalizeTaskStatus(candidate);
    if (status) return status;
  }
  return null;
}

async function loadWorkspaceRoster(
  workspaceId: string,
): Promise<TaskFilterRosterEntry[]> {
  const r = await query<{ id: string; name: string | null; email: string | null }>(
    `SELECT p.id, p.full_name AS name, p.email
     FROM ${SCHEMA}.workspace_members wm
     JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
     WHERE wm.workspace_id = $1`,
    [workspaceId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: (row.name || row.email || "User").slice(0, 120),
    email: (row.email || "").slice(0, 200),
  }));
}

function buildTasksFilterPath(filter: Record<string, unknown>): string {
  const params = new URLSearchParams();
  if (typeof filter.q === "string" && filter.q.trim()) {
    params.set("q", filter.q.trim().slice(0, 200));
  }
  if (Array.isArray(filter.status) && filter.status.length) {
    const status = filter.status.filter((s): s is string => typeof s === "string");
    if (status.length) params.set("status", status.join(","));
  }
  if (Array.isArray(filter.priority) && filter.priority.length) {
    const priority = filter.priority.filter(
      (p): p is string => typeof p === "string",
    );
    if (priority.length) params.set("priority", priority.join(","));
  }
  if (typeof filter.assignee_id === "string" && filter.assignee_id) {
    params.set("assignee", filter.assignee_id);
  }
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

export const EXTENDED_ASSISTANT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "open_quick_pr",
    description: "Open the new pull request flow on Version Control.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "open_global_search",
    description: "Open global search with a query.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "switch_workspace",
    description: "Switch to a workspace by name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Workspace name" },
      },
      required: ["name"],
    },
  },
  {
    name: "switch_project",
    description: "Switch to a project by name in the current workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Project name" },
      },
      required: ["name"],
    },
  },
  {
    name: "filter_tasks",
    description: "Filter the task board using natural language.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        utterance: { type: Type.STRING },
      },
      required: ["utterance"],
    },
  },
  {
    name: "draft_chat_reply",
    description: "Suggest reply options for the active chat conversation.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "draft_email_reply",
    description: "Draft a reply for the open email thread.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "summarize_email_thread",
    description: "Summarize the open email thread.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "start_call",
    description: "Start an instant video call with workspace members.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        participantNames: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["title", "participantNames"],
    },
  },
  {
    name: "create_calendar_event",
    description: "Create a calendar event from a spoken description.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        utterance: { type: Type.STRING },
      },
      required: ["utterance"],
    },
  },
  {
    name: "update_task",
    description:
      "Update one task: complete, assign, change status/priority, or move to another project (by project name, key, or id).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskReference: {
          type: Type.STRING,
          description: "Task title, task key (e.g. ONEWORK-5), task UUID, or this task",
        },
        taskTitle: { type: Type.STRING, description: "Alias for taskReference" },
        action: {
          type: Type.STRING,
          enum: [
            "complete",
            "assign",
            "set_status",
            "set_priority",
            "move_project",
          ],
        },
        assigneeName: { type: Type.STRING },
        status: { type: Type.STRING },
        priority: { type: Type.STRING },
        projectReference: {
          type: Type.STRING,
          description: "Target project name, key (e.g. ONEWORK), or UUID",
        },
        projectName: {
          type: Type.STRING,
          description: "Alias for projectReference",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "bulk_update_tasks",
    description:
      "Update multiple tasks matching a filter: change status or move to another project (name, key, or id).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        utterance: {
          type: Type.STRING,
          description: "Natural language filter e.g. all review tasks",
        },
        action: {
          type: Type.STRING,
          enum: ["set_status", "move_project"],
        },
        status: { type: Type.STRING },
        projectReference: { type: Type.STRING },
        projectName: { type: Type.STRING },
      },
      required: ["utterance", "action"],
    },
  },
  {
    name: "send_email",
    description: "Send the current email draft (requires explicit confirmation).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

async function parseNlTaskFilter(
  apiKey: string,
  userId: string,
  workspaceId: string,
  utterance: string,
): Promise<TaskFilterCriteria> {
  const roster = await loadWorkspaceRoster(workspaceId);
  const raw = await runTaskAi({
    apiKey,
    kind: "filter_nl",
    userId,
    filterNl: { nl: utterance, roster },
  });
  const rosterIds = new Set(roster.map((r) => r.id));
  const filter: TaskFilterCriteria = {};
  if (typeof raw.q === "string" && raw.q.trim()) filter.q = raw.q.trim();
  if (Array.isArray(raw.status)) {
    filter.status = raw.status.filter(
      (x): x is string => typeof x === "string" && STATUS_ALLOW.has(x),
    );
  }
  if (Array.isArray(raw.priority)) {
    filter.priority = raw.priority.filter(
      (x): x is string => typeof x === "string" && PRIORITY_ALLOW.has(x),
    );
  }
  if (raw.assignee_id === null) filter.assignee_id = null;
  else if (
    typeof raw.assignee_id === "string" &&
    rosterIds.has(raw.assignee_id)
  ) {
    filter.assignee_id = raw.assignee_id;
  }
  return filter;
}

function taskDisplayLabel(task: {
  title: string;
  task_key: string | null;
}): string {
  return task.task_key ? `${task.task_key} (${task.title})` : task.title;
}

function confirmAction(
  title: string,
  message: string,
  pendingAction: AssistantPendingAction,
  spokenReply: string,
  extra?: Partial<{
    confirmLabel: string;
    intent: "danger" | "default";
    requireTextMatch: string;
  }>,
): ToolExecutionResult {
  return {
    spokenReply,
    clientActions: [
      {
        type: "open_confirm",
        title,
        message,
        confirmLabel: extra?.confirmLabel,
        intent: extra?.intent,
        requireTextMatch: extra?.requireTextMatch,
        pendingAction,
      },
    ],
  };
}

export async function executeExtendedAssistantTool(opts: {
  apiKey: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  ctx: ResolvedAssistantContext;
}): Promise<ToolExecutionResult | null> {
  const { apiKey, userId, toolName, args, ctx } = opts;
  const workspaceId = ctx.pageContext.workspaceId;

  switch (toolName) {
    case "open_quick_pr": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      if (!isPathAllowed(ctx, "/version-control")) {
        return {
          spokenReply: "You do not have access to Version Control.",
          clientActions: [],
        };
      }
      if (!ctx.hasProject) {
        return {
          spokenReply: "Select a project before creating a pull request.",
          clientActions: [{ type: "navigate", path: "/version-control" }],
        };
      }
      return {
        spokenReply: "Opening new pull request.",
        clientActions: [
          {
            type: "open_quick_pr",
            projectId: ctx.pageContext.projectId ?? undefined,
          },
        ],
      };
    }

    case "open_global_search": {
      const query =
        typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
      if (!query) {
        return {
          spokenReply: "What should I search for?",
          clientActions: [],
        };
      }
      return {
        spokenReply: `Searching for "${query}".`,
        clientActions: [{ type: "open_global_search", query }],
      };
    }

    case "switch_workspace": {
      const name =
        typeof args.name === "string"
          ? args.name.trim()
          : extractNameAfterPattern(
              String(args.utterance ?? ""),
              /(?:switch|change)\s+(?:to\s+)?(?:the\s+)?workspace\s+(.+)$/i,
            );
      if (!name) {
        return {
          spokenReply: "Which workspace should I switch to?",
          clientActions: [],
        };
      }
      const workspaces = await loadUserWorkspaces(userId);
      const match = resolveByName(name, workspaces);
      if (!match) {
        return {
          spokenReply: `I could not find a workspace named "${name}".`,
          clientActions: [],
        };
      }
      return {
        spokenReply: `Switching to ${match.name}.`,
        clientActions: [{ type: "switch_workspace", workspaceId: match.id }],
      };
    }

    case "switch_project": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      const name =
        typeof args.name === "string"
          ? args.name.trim()
          : extractNameAfterPattern(
              String(args.utterance ?? ""),
              /(?:switch|change)\s+(?:to\s+)?(?:the\s+)?project\s+(.+)$/i,
            );
      if (!name) {
        return {
          spokenReply: "Which project should I switch to?",
          clientActions: [],
        };
      }
      const projects = await loadWorkspaceProjects(workspaceId);
      const match = resolveByName(name, projects);
      if (!match) {
        return {
          spokenReply: `I could not find a project named "${name}".`,
          clientActions: [],
        };
      }
      return {
        spokenReply: `Switching to project ${match.name}.`,
        clientActions: [{ type: "switch_project", projectId: match.id }],
      };
    }

    case "filter_tasks": {
      const utterance =
        typeof args.utterance === "string" ? args.utterance.trim() : "";
      if (!workspaceId || !utterance) {
        return {
          spokenReply: "Tell me how to filter your tasks.",
          clientActions: [],
        };
      }
      const roster = await loadWorkspaceRoster(workspaceId);
      const raw = await runTaskAi({
        apiKey,
        kind: "filter_nl",
        userId,
        filterNl: { nl: utterance, roster },
      });
      const rosterIds = new Set(roster.map((r) => r.id));
      const filter: Record<string, unknown> = {};
      if (typeof raw.explanation === "string") filter.explanation = raw.explanation;
      if (typeof raw.q === "string" && raw.q.trim()) filter.q = raw.q.trim();
      if (Array.isArray(raw.status)) {
        filter.status = raw.status.filter(
          (x): x is string => typeof x === "string" && STATUS_ALLOW.has(x),
        );
      }
      if (Array.isArray(raw.priority)) {
        filter.priority = raw.priority.filter(
          (x): x is string => typeof x === "string" && PRIORITY_ALLOW.has(x),
        );
      }
      if (raw.assignee_id === null) filter.assignee_id = null;
      else if (
        typeof raw.assignee_id === "string" &&
        rosterIds.has(raw.assignee_id)
      ) {
        filter.assignee_id = raw.assignee_id;
      }
      const path = buildTasksFilterPath(filter);
      const explanation =
        typeof raw.explanation === "string" ? raw.explanation.trim() : "";
      return {
        spokenReply: explanation || "Filtered your task board.",
        clientActions: [{ type: "navigate", path }],
        data: filter,
      };
    }

    case "draft_chat_reply": {
      const conversationId = ctx.pageContext.conversationId;
      if (!conversationId) {
        return {
          spokenReply: "Open a chat conversation first.",
          clientActions: [{ type: "navigate", path: "/chat" }],
        };
      }
      const messages = await loadMessagesForAi(conversationId, { limit: 40 });
      const result = await runChatAi({
        apiKey,
        kind: "suggest_reply",
        userId,
        conversationName: "chat",
        conversationType: "channel",
        messages,
      });
      const replies = Array.isArray(result.replies)
        ? result.replies.filter((r): r is string => typeof r === "string")
        : [];
      const first = replies[0]?.trim();
      return {
        spokenReply: first
          ? `Suggestion: ${first.slice(0, 400)}`
          : "Here are some reply ideas in the assistant data.",
        clientActions: [],
        data: { replies },
      };
    }

    case "draft_email_reply": {
      const emailId = ctx.pageContext.emailMessageId;
      if (!emailId) {
        return {
          spokenReply: "Open an email thread first.",
          clientActions: [{ type: "navigate", path: "/email" }],
        };
      }
      const res = await handleEmailAiPost({
        userId,
        emailId,
        apiKey,
        body: { kind: "reply_drafts", tone: "neutral" },
      });
      if (res.status !== 200) {
        return {
          spokenReply: "Could not draft a reply for this email.",
          clientActions: [],
        };
      }
      const drafts = res.json.drafts;
      const first =
        Array.isArray(drafts) && typeof drafts[0] === "string"
          ? drafts[0]
          : typeof res.json.hint === "string"
            ? res.json.hint
            : "";
      return {
        spokenReply: first
          ? `Draft: ${first.slice(0, 400)}`
          : "Reply draft ready — open the email to review.",
        clientActions: [{ type: "navigate", path: `/email/${emailId}` }],
        data: res.json,
      };
    }

    case "summarize_email_thread": {
      const emailId = ctx.pageContext.emailMessageId;
      if (!emailId) {
        return {
          spokenReply: "Open an email thread first.",
          clientActions: [{ type: "navigate", path: "/email" }],
        };
      }
      const res = await handleEmailAiPost({
        userId,
        emailId,
        apiKey,
        body: { kind: "thread_digest" },
      });
      if (res.status !== 200) {
        return {
          spokenReply: "Could not summarize this email thread.",
          clientActions: [],
        };
      }
      const summary =
        typeof res.json.summary === "string" ? res.json.summary.trim() : "";
      return {
        spokenReply: summary || "Nothing notable in this thread.",
        clientActions: [],
        data: res.json,
      };
    }

    case "start_call": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      const title =
        typeof args.title === "string" ? args.title.trim().slice(0, 200) : "Team call";
      const names = Array.isArray(args.participantNames)
        ? args.participantNames.filter((n): n is string => typeof n === "string")
        : [];
      const members = await loadWorkspaceMembers(workspaceId);
      const participantUserIds: string[] = [];
      for (const n of names) {
        const m = resolveByName(n, members);
        if (m) participantUserIds.push(m.id);
      }
      if (!participantUserIds.length) {
        return {
          spokenReply: "I could not find those participants in your workspace.",
          clientActions: [{ type: "navigate", path: "/calls" }],
        };
      }
      const pending: AssistantPendingAction = {
        kind: "start_call",
        workspaceId,
        title,
        participantUserIds,
        projectId: ctx.pageContext.projectId,
        conversationId: ctx.pageContext.conversationId,
      };
      return confirmAction(
        "Start video call?",
        `Start "${title}" with ${participantUserIds.length} participant(s)?`,
        pending,
        "Confirm to start the call.",
      );
    }

    case "create_calendar_event": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      const utterance =
        typeof args.utterance === "string" ? args.utterance.trim() : "";
      if (!utterance) {
        return {
          spokenReply: "Describe the event you want to schedule.",
          clientActions: [],
        };
      }
      const ai = new GoogleGenAI({ apiKey });
      const parseResult = await ai.models.generateContent({
        model: getGeminiModelId(),
        contents: utterance,
        config: {
          systemInstruction:
            'Parse a calendar event request. Respond JSON only: {"title":"...","startAt":"ISO8601","endAt":"ISO8601 or null"}. Use reasonable 1h duration if end missing.',
          temperature: 0.1,
          maxOutputTokens: 300,
          responseMimeType: "application/json",
        },
      });
      let title = utterance.slice(0, 200);
      let startAt = new Date(Date.now() + 3600_000).toISOString();
      let endAt: string | null = null;
      try {
        const parsed = JSON.parse(parseResult.text ?? "{}") as Record<
          string,
          unknown
        >;
        if (typeof parsed.title === "string" && parsed.title.trim()) {
          title = parsed.title.trim().slice(0, 200);
        }
        if (typeof parsed.startAt === "string") startAt = parsed.startAt;
        if (typeof parsed.endAt === "string") endAt = parsed.endAt;
      } catch {
        /* use defaults */
      }
      const pending: AssistantPendingAction = {
        kind: "create_calendar_event",
        workspaceId,
        title,
        startAt,
        endAt,
        projectId: ctx.pageContext.projectId,
      };
      return confirmAction(
        "Create calendar event?",
        `Create "${title}" at ${new Date(startAt).toLocaleString()}?`,
        pending,
        "Confirm to open the event form.",
      );
    }

    case "update_task": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      await requireWorkspaceTasksWrite(workspaceId, userId);
      const rawAction = args.action;
      const validActions = [
        "complete",
        "assign",
        "set_status",
        "set_priority",
        "move_project",
      ] as const;
      if (!validActions.includes(rawAction as (typeof validActions)[number])) {
        return {
          spokenReply: "Tell me which task to update and how.",
          clientActions: [],
        };
      }

      const statusDestination = statusFromTaskUpdateArgs(args);
      let action = rawAction as (typeof validActions)[number];
      if (
        statusDestination &&
        (action === "move_project" || action === "set_status")
      ) {
        action = "set_status";
      }

      const taskPhrase =
        (typeof args.taskReference === "string"
          ? args.taskReference.trim()
          : "") ||
        (typeof args.taskTitle === "string" ? args.taskTitle.trim() : "");

      const task = await findTaskByReference({
        workspaceId,
        projectId: ctx.pageContext.projectId ?? null,
        phrase: taskPhrase,
        openTaskId: ctx.pageContext.taskId,
        workspaceWide: action === "move_project",
      });
      if (!task) {
        return {
          spokenReply: taskPhrase
            ? `I could not find a task matching "${taskPhrase}".`
            : "Tell me which task to update — title, key, or open a task first.",
          clientActions: [{ type: "navigate", path: "/tasks" }],
        };
      }

      let assigneeId: string | null | undefined;
      if (action === "assign") {
        const assigneeName =
          typeof args.assigneeName === "string" ? args.assigneeName.trim() : "";
        const members = await loadWorkspaceMembers(workspaceId);
        const m = resolveByName(assigneeName, members);
        if (!m) {
          return {
            spokenReply: `I could not find a member named "${assigneeName}".`,
            clientActions: [],
          };
        }
        assigneeId = m.id;
      }

      let normalizedStatus: string | undefined;
      if (action === "set_status") {
        normalizedStatus = statusDestination ?? undefined;
        if (!normalizedStatus && typeof args.status === "string") {
          normalizedStatus = normalizeTaskStatus(args.status) ?? undefined;
        }
        if (!normalizedStatus) {
          return {
            spokenReply:
              "Use a status like backlog, todo, in progress, review, or done.",
            clientActions: [],
          };
        }
      }

      let targetProjectId: string | null | undefined;
      let targetProjectLabel: string | undefined;
      if (action === "move_project") {
        const projectPhrase =
          (typeof args.projectReference === "string"
            ? args.projectReference.trim()
            : "") ||
          (typeof args.projectName === "string" ? args.projectName.trim() : "");
        if (!projectPhrase) {
          return {
            spokenReply:
              "Which project should I move it to? Say the name, key, or id.",
            clientActions: [],
          };
        }
        if (isStatusDestinationPhrase(projectPhrase)) {
          return {
            spokenReply:
              "That sounds like a status, not a project. Say move to review, in progress, or done.",
            clientActions: [],
          };
        }
        const project = await resolveProjectReference(workspaceId, projectPhrase);
        if (!project) {
          return {
            spokenReply: `I could not find a project matching "${projectPhrase}".`,
            clientActions: [],
          };
        }
        targetProjectId = project.id;
        targetProjectLabel = project.key
          ? `${project.name} (${project.key})`
          : project.name;
      }

      const label = taskDisplayLabel(task);
      const pending: AssistantPendingAction = {
        kind: "update_task",
        taskId: task.id,
        action: action as
          | "complete"
          | "assign"
          | "set_status"
          | "set_priority"
          | "move_project",
        assigneeId: assigneeId ?? null,
        status: normalizedStatus,
        priority: typeof args.priority === "string" ? args.priority : undefined,
        projectId: targetProjectId,
        taskLabel: label,
      };

      let confirmMessage = `Apply "${action}" to ${label}?`;
      if (action === "move_project" && targetProjectLabel) {
        confirmMessage = `Move ${label} to ${targetProjectLabel}? The task key will update to match the new project.`;
      } else if (action === "set_status" && normalizedStatus) {
        confirmMessage = `Change ${label} to ${normalizedStatus.replace(/-/g, " ")}?`;
      } else if (action === "complete") {
        confirmMessage = `Mark ${label} as done?`;
      }

      return confirmAction(
        "Update task?",
        confirmMessage,
        pending,
        "Confirm to update the task.",
        action === "complete" ? { intent: "default" } : undefined,
      );
    }

    case "bulk_update_tasks": {
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace first.",
          clientActions: [],
        };
      }
      await requireWorkspaceTasksWrite(workspaceId, userId);
      const utterance =
        typeof args.utterance === "string" ? args.utterance.trim() : "";
      const rawBulkAction = args.action;
      if (
        !utterance ||
        (rawBulkAction !== "set_status" && rawBulkAction !== "move_project")
      ) {
        return {
          spokenReply: "Tell me which tasks to update and how.",
          clientActions: [],
        };
      }

      const bulkStatusDestination = statusFromTaskUpdateArgs(args);
      let bulkAction = rawBulkAction as "set_status" | "move_project";
      if (
        bulkStatusDestination &&
        (bulkAction === "move_project" || bulkAction === "set_status")
      ) {
        bulkAction = "set_status";
      }

      const filter = await parseNlTaskFilter(
        apiKey,
        userId,
        workspaceId,
        utterance,
      );
      const { ids, overCap } = await findTaskIdsByFilter(
        workspaceId,
        ctx.pageContext.projectId ?? null,
        filter,
      );

      if (ids.length === 0) {
        return {
          spokenReply: "No tasks matched that filter.",
          clientActions: [{ type: "navigate", path: "/tasks" }],
        };
      }
      if (overCap) {
        return {
          spokenReply: `Too many tasks matched (over ${BULK_TASK_CAP}). Narrow the filter and try again.`,
          clientActions: [],
        };
      }

      let bulkStatus: string | undefined;
      if (bulkAction === "set_status") {
        const spoken =
          bulkStatusDestination ??
          (typeof args.status === "string"
            ? normalizeTaskStatus(args.status.trim())
            : null) ??
          normalizeTaskStatus(utterance);
        if (!spoken) {
          return {
            spokenReply:
              "Tell me the target status: backlog, todo, in progress, review, or done.",
            clientActions: [],
          };
        }
        bulkStatus = spoken;
      }

      let bulkProjectId: string | null | undefined;
      let bulkProjectLabel: string | undefined;
      if (bulkAction === "move_project") {
        const projectPhrase =
          (typeof args.projectReference === "string"
            ? args.projectReference.trim()
            : "") ||
          (typeof args.projectName === "string" ? args.projectName.trim() : "");
        if (!projectPhrase) {
          return {
            spokenReply:
              "Which project should I move them to? Say the name, key, or id.",
            clientActions: [],
          };
        }
        const project = await resolveProjectReference(workspaceId, projectPhrase);
        if (!project) {
          return {
            spokenReply: `I could not find a project matching "${projectPhrase}".`,
            clientActions: [],
          };
        }
        bulkProjectId = project.id;
        bulkProjectLabel = project.key
          ? `${project.name} (${project.key})`
          : project.name;
      }

      const pending: AssistantPendingAction = {
        kind: "bulk_update_tasks",
        taskIds: ids,
        action: bulkAction,
        status: bulkStatus,
        projectId: bulkProjectId,
      };

      const count = ids.length;
      const message =
        bulkAction === "move_project" && bulkProjectLabel
          ? `Move ${count} task(s) to ${bulkProjectLabel}? Task keys will update per project.`
          : bulkAction === "set_status" && bulkStatus
            ? `Change ${count} task(s) to ${bulkStatus.replace(/-/g, " ")}?`
            : `Update ${count} task(s)?`;

      return confirmAction(
        `Update ${count} tasks?`,
        message,
        pending,
        "Confirm to apply bulk changes.",
      );
    }

    case "send_email": {
      const messageId = ctx.pageContext.emailMessageId;
      if (!messageId || !ctx.pageContext.pathname.includes("/email/compose")) {
        return {
          spokenReply: "Open email compose with a draft before sending.",
          clientActions: [{ type: "navigate", path: "/email/compose" }],
        };
      }
      const pending: AssistantPendingAction = {
        kind: "send_email",
        messageId,
      };
      return confirmAction(
        "Send email?",
        "This will send your email. Type SEND to confirm.",
        pending,
        "Confirm to send the email.",
        {
          intent: "danger",
          confirmLabel: "Send",
          requireTextMatch: "SEND",
        },
      );
    }

    default:
      return null;
  }
}

export async function summarizeCalendarForContext(
  apiKey: string,
  ctx: ResolvedAssistantContext,
): Promise<ToolExecutionResult> {
  const workspaceId = ctx.pageContext.workspaceId;
  if (!workspaceId) {
    return {
      spokenReply: "Select a workspace first.",
      clientActions: [],
    };
  }
  const events = await loadUpcomingCalendarEvents({
    workspaceId,
    projectId: ctx.pageContext.projectId,
  });
  const summary = await summarizeCalendarEvents({ apiKey, events });
  return {
    spokenReply: summary,
    clientActions: [{ type: "navigate", path: "/calendar" }],
    data: { eventCount: events.length },
  };
}
