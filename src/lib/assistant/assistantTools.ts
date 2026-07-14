import { z } from "zod";
import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { loadMessagesForAi } from "@/lib/chat/chatAccess";
import { runChatAi } from "@/lib/chat/chatAiService";
import { query, SCHEMA } from "@/lib/db";
import { getPrimaryMailAccount } from "@/lib/email/accounts";
import { getDigestSummaryByMessageIds } from "@/lib/email/emailAiService";
import { parseQuickCreate } from "@/lib/tasks/parseQuickCreate";
import { requireWorkspaceTasksWrite } from "@/lib/rbac/task-access";
import { runTaskAi, type TaskDigestItem } from "@/lib/tasks/taskAiService";
import type {
  AssistantClientAction,
  AssistantModalId,
  AssistantModule,
} from "@/types/assistant";
import {
  ASSISTANT_ROUTES,
  isPathAllowed,
  type ResolvedAssistantContext,
} from "./assistantContext";
import {
  executeExtendedAssistantTool,
  EXTENDED_ASSISTANT_FUNCTION_DECLARATIONS,
  summarizeCalendarForContext,
} from "./assistantExtendedTools";
import { INFER_TOOL_SYSTEM_INSTRUCTION } from "./assistantPrompts";
import { ASSISTANT_TOOL_NAMES } from "@/types/assistant";

export type ToolExecutionResult = {
  spokenReply: string;
  clientActions: AssistantClientAction[];
  data?: Record<string, unknown>;
};

const navigateArgsSchema = z.object({
  path: z.string().min(1).max(200),
});

const openModalArgsSchema = z.object({
  modal: z.enum(["new-task", "new-message"]),
  hints: z.string().max(500).optional(),
});

const createTaskDraftArgsSchema = z.object({
  utterance: z.string().min(1).max(1200),
});

const openEmailComposeArgsSchema = z.object({
  hints: z.string().max(500).optional(),
});

const summarizeContextArgsSchema = z.object({
  module: z.enum(["tasks", "email", "chat", "calendar"]),
});

export const ASSISTANT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "navigate",
    description:
      "Navigate the user to an allowed OneWork page. USE THIS for go to/open/show/take me to + module (settings, tasks, calendar, email, chat, etc.). Use only paths from the allowed navigation list.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: "Absolute app path such as /tasks or /calendar",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "open_modal",
    description: "Open a quick-create modal for a new task or new chat message.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        modal: {
          type: Type.STRING,
          enum: ["new-task", "new-message"],
        },
        hints: {
          type: Type.STRING,
          description: "Optional prefilled hint for the modal",
        },
      },
      required: ["modal"],
    },
  },
  {
    name: "create_task_draft",
    description:
      "ONLY when user explicitly asks to create/add/make a NEW TASK. Do not use for navigation or calling someone.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        utterance: {
          type: Type.STRING,
          description: "What the user wants the task to be about",
        },
      },
      required: ["utterance"],
    },
  },
  {
    name: "open_email_compose",
    description: "Open the email compose screen, optionally with a subject or body hint.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        hints: {
          type: Type.STRING,
          description: "Optional compose hint (subject or gist)",
        },
      },
    },
  },
  {
    name: "summarize_context",
    description:
      "Summarize the user's current tasks list, inbox, or active chat thread.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        module: {
          type: Type.STRING,
          enum: ["tasks", "email", "chat", "calendar"],
        },
      },
      required: ["module"],
    },
  },
];

export const ALL_ASSISTANT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  ...ASSISTANT_FUNCTION_DECLARATIONS,
  ...EXTENDED_ASSISTANT_FUNCTION_DECLARATIONS,
];

function routeLabel(path: string): string {
  return (
    ASSISTANT_ROUTES.find((r) => r.path === path.split("?")[0])?.label ?? path
  );
}

async function loadTasksForDigest(
  userId: string,
  workspaceId: string,
  projectId: string | null,
): Promise<TaskDigestItem[]> {
  const params: unknown[] = [userId, workspaceId];
  let projectClause = "";
  if (projectId) {
    params.push(projectId);
    projectClause = ` AND t.project_id = $${params.length}::uuid`;
  }
  params.push(40);
  const res = await query<{
    id: string;
    title: string;
    status: string;
    priority: string;
  }>(
    `SELECT t.id, t.title, t.status::text, t.priority::text
     FROM ${SCHEMA}.tasks t
     INNER JOIN ${SCHEMA}.workspace_members wm
       ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
     WHERE t.workspace_id = $2::uuid
       ${projectClause}
     ORDER BY t.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
  }));
}

async function summarizeTasks(
  apiKey: string,
  userId: string,
  ctx: ResolvedAssistantContext,
): Promise<ToolExecutionResult> {
  const workspaceId = ctx.pageContext.workspaceId;
  if (!workspaceId) {
    return {
      spokenReply: "Select a workspace first, then ask me to summarize your tasks.",
      clientActions: [],
    };
  }
  if (!ctx.hasProject) {
    return {
      spokenReply: "Pick a project to summarize tasks.",
      clientActions: [{ type: "navigate", path: "/tasks" }],
    };
  }
  const tasks = await loadTasksForDigest(
    userId,
    workspaceId,
    ctx.pageContext.projectId ?? null,
  );
  if (!tasks.length) {
    return {
      spokenReply: "You have no tasks to summarize yet.",
      clientActions: [],
    };
  }
  const digest = await runTaskAi({
    apiKey,
    kind: "view_digest",
    userId,
    tasks,
  });
  const summary =
    typeof digest.summary === "string" ? digest.summary.trim() : "";
  return {
    spokenReply: summary || "Here is your task overview.",
    clientActions: [],
    data: digest,
  };
}

async function summarizeEmail(
  userId: string,
): Promise<ToolExecutionResult> {
  const account = await getPrimaryMailAccount(userId);
  if (!account) {
    return {
      spokenReply: "Connect an email account first to summarize your inbox.",
      clientActions: [{ type: "navigate", path: "/email" }],
    };
  }
  const res = await query<{
    id: string;
    subject: string | null;
    from_json: unknown;
  }>(
    `SELECT id, subject, from_json
     FROM ${SCHEMA}.mail_messages
     WHERE account_id = $1 AND folder = 'inbox' AND is_draft = false
     ORDER BY received_at DESC NULLS LAST
     LIMIT 12`,
    [account.id],
  );
  if (!res.rows.length) {
    return {
      spokenReply: "Your inbox looks empty.",
      clientActions: [],
    };
  }
  const ids = res.rows.map((r) => r.id);
  const digestMap = await getDigestSummaryByMessageIds(userId, ids);
  const lines: string[] = [];
  for (const row of res.rows) {
    const cached = digestMap.get(row.id);
    if (cached) {
      lines.push(`- ${row.subject ?? "(No subject)"}: ${cached}`);
      continue;
    }
    const fromObj =
      row.from_json && typeof row.from_json === "object"
        ? (row.from_json as { address?: string; name?: string })
        : null;
    const from =
      fromObj?.name?.trim() ||
      fromObj?.address?.trim() ||
      "unknown sender";
    lines.push(`- ${row.subject ?? "(No subject)"} from ${from}`);
  }
  const spokenReply =
    lines.length <= 3
      ? `Inbox highlights: ${lines.join(" ")}`
      : `You have ${res.rows.length} recent emails. Top items: ${lines.slice(0, 3).join(" ")}`;
  return {
    spokenReply: spokenReply.slice(0, 900),
    clientActions: [{ type: "navigate", path: "/email" }],
    data: { emailCount: res.rows.length, highlights: lines.slice(0, 5) },
  };
}

async function summarizeChat(
  apiKey: string,
  userId: string,
  ctx: ResolvedAssistantContext,
): Promise<ToolExecutionResult> {
  const conversationId = ctx.pageContext.conversationId;
  if (!conversationId) {
    return {
      spokenReply: "Open a chat conversation first, then ask me to catch you up.",
      clientActions: [{ type: "navigate", path: "/chat" }],
    };
  }
  const messages = await loadMessagesForAi(conversationId, { limit: 80 });
  const digest = await runChatAi({
    apiKey,
    kind: "thread_digest",
    userId,
    conversationName: "chat",
    conversationType: "channel",
    messages,
  });
  const summary =
    typeof digest.summary === "string" ? digest.summary.trim() : "";
  return {
    spokenReply: summary || "Nothing new to summarize in this chat.",
    clientActions: [],
    data: digest,
  };
}

export async function executeAssistantTool(opts: {
  apiKey: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  ctx: ResolvedAssistantContext;
}): Promise<ToolExecutionResult> {
  const { apiKey, userId, toolName, args, ctx } = opts;

  switch (toolName) {
    case "navigate": {
      const parsed = navigateArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          spokenReply: "I could not understand where to navigate.",
          clientActions: [],
        };
      }
      const path = parsed.data.path.trim();
      if (!isPathAllowed(ctx, path)) {
        return {
          spokenReply: `You do not have access to ${routeLabel(path)}, or that page is unavailable.`,
          clientActions: [],
        };
      }
      return {
        spokenReply: `Opening ${routeLabel(path)}.`,
        clientActions: [{ type: "navigate", path }],
      };
    }

    case "open_modal": {
      const parsed = openModalArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          spokenReply: "I could not open that modal.",
          clientActions: [],
        };
      }
      const modal = parsed.data.modal as AssistantModalId;
      if (modal === "new-task" && !ctx.hasProject) {
        return {
          spokenReply: "Select a project before creating a task.",
          clientActions: [{ type: "navigate", path: "/tasks" }],
        };
      }
      const payload: Record<string, unknown> = {};
      if (parsed.data.hints) payload.hint = parsed.data.hints;
      if (modal === "new-task" && ctx.pageContext.projectId) {
        payload.initialProjectId = ctx.pageContext.projectId;
      }
      const label = modal === "new-task" ? "new task" : "new message";
      return {
        spokenReply: `Opening ${label}.`,
        clientActions: [{ type: "open_modal", modal, payload }],
      };
    }

    case "create_task_draft": {
      const parsed = createTaskDraftArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          spokenReply: "Tell me what the task should be about.",
          clientActions: [],
        };
      }
      const workspaceId = ctx.pageContext.workspaceId;
      if (!workspaceId) {
        return {
          spokenReply: "Select a workspace before creating a task.",
          clientActions: [],
        };
      }
      if (!ctx.hasProject) {
        return {
          spokenReply: "Pick a project, then ask me to create a task.",
          clientActions: [{ type: "navigate", path: "/tasks" }],
        };
      }
      await requireWorkspaceTasksWrite(workspaceId, userId);
      const draftRaw = await runTaskAi({
        apiKey,
        kind: "quick_create",
        userId,
        hint: parsed.data.utterance,
      });
      const draft = parseQuickCreate(draftRaw);
      if (!draft) {
        return {
          spokenReply: "I could not draft that task. Try rephrasing.",
          clientActions: [],
        };
      }
      return {
        spokenReply: `Drafted "${draft.title}". Review it in the new task form.`,
        clientActions: [
          {
            type: "open_modal",
            modal: "new-task",
            payload: {
              initialProjectId: ctx.pageContext.projectId,
              initialTitle: draft.title,
              initialDescription: draft.description,
              initialPriority: draft.priority,
              initialTags: draft.tags.join(", "),
            },
          },
        ],
        data: draftRaw,
      };
    }

    case "open_email_compose": {
      const parsed = openEmailComposeArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          spokenReply: "Opening compose.",
          clientActions: [{ type: "open_email_compose" }],
        };
      }
      return {
        spokenReply: "Opening email compose.",
        clientActions: [
          {
            type: "open_email_compose",
            hints: parsed.data.hints,
          },
        ],
      };
    }

    case "summarize_context": {
      const parsed = summarizeContextArgsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          spokenReply: "I can summarize tasks, email, or chat.",
          clientActions: [],
        };
      }
      const mod = parsed.data.module as AssistantModule;
      if (!ctx.allowedModules.includes(mod)) {
        return {
          spokenReply: `You do not have access to summarize ${mod}.`,
          clientActions: [],
        };
      }
      if (mod === "tasks") return summarizeTasks(apiKey, userId, ctx);
      if (mod === "email") return summarizeEmail(userId);
      if (mod === "chat") return summarizeChat(apiKey, userId, ctx);
      if (mod === "calendar") {
        return summarizeCalendarForContext(apiKey, ctx);
      }
      return {
        spokenReply: "I cannot summarize that module yet.",
        clientActions: [],
      };
    }

    default: {
      const extended = await executeExtendedAssistantTool({
        apiKey,
        userId,
        toolName,
        args,
        ctx,
      });
      if (extended) return extended;
      return {
        spokenReply: "I do not know how to do that yet.",
        clientActions: [],
      };
    }
  }
}

/** Fallback when the model returns plain text instead of a tool call. */
export async function inferToolFromTranscript(
  apiKey: string,
  transcript: string,
  contextText: string,
): Promise<{ toolName: string; args: Record<string, unknown> } | null> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = [
    contextText,
    "",
    "User voice command:",
    transcript.slice(0, 1200),
    "",
    `Pick one tool and respond with JSON only: {"tool":"${ASSISTANT_TOOL_NAMES.join("|")}","args":{...}}`,
  ].join("\n");
  try {
    const result = await ai.models.generateContent({
      model: getGeminiModelId(),
      contents: prompt,
      config: {
        systemInstruction: INFER_TOOL_SYSTEM_INSTRUCTION,
        temperature: 0.1,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
      },
    });
    const text = result.text?.trim();
    if (!text) return null;
    const parsed = JSON.parse(text) as {
      tool?: string;
      args?: Record<string, unknown>;
    };
    if (!parsed.tool || parsed.tool === "null") return null;
    if (typeof parsed.tool !== "string") return null;
    return {
      toolName: parsed.tool,
      args:
        parsed.args && typeof parsed.args === "object" ? parsed.args : {},
    };
  } catch {
    return null;
  }
}
