import { query, SCHEMA } from "@/lib/db";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { GoogleGenAI } from "@google/genai";

export type TaskAiKind =
  | "improve"
  | "proofread"
  | "subtasks"
  | "estimate"
  | "view_digest"
  | "quick_create"
  | "filter_nl";

export type TaskDigestItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
};

export type TaskFilterRosterEntry = {
  id: string;
  name: string;
  email: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  tags: unknown;
  priority: string;
  status: string;
};

function tagsToStringArray(tags: unknown): string[] {
  if (Array.isArray(tags))
    return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string" && tags.trim()) return [tags];
  return [];
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  return parsed && typeof parsed === "object" ? parsed : {};
}

/** Task visible only if caller is a member of the task's workspace. */
async function loadTaskRowForUser(
  taskId: string,
  userId: string,
): Promise<TaskRow | null> {
  const res = await query<TaskRow>(
    `SELECT t.id, t.title, t.description, t.tags, t.priority, t.status
     FROM ${SCHEMA}.tasks t
     INNER JOIN ${SCHEMA}.workspace_members wm
       ON wm.workspace_id = t.workspace_id AND wm.user_id = $2
     WHERE t.id = $1
     LIMIT 1`,
    [taskId, userId],
  );
  return res.rows[0] ?? null;
}

async function generateJson(
  apiKey: string,
  systemInstruction: string,
  userTurn: string,
  maxOutputTokens: number,
  temperature: number,
): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: getGeminiModelId(),
    contents: userTurn,
    config: {
      systemInstruction,
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  });
  const text = result.text?.trim();
  if (!text) throw new Error("Empty AI response");
  return parseJsonObject(text);
}

export async function runTaskAi(input: {
  apiKey: string;
  kind: TaskAiKind;
  userId: string;
  taskId?: string;
  hint?: string;
  tasks?: TaskDigestItem[];
  filterNl?: { nl: string; roster: TaskFilterRosterEntry[] };
}): Promise<Record<string, unknown>> {
  const {
    apiKey,
    kind,
    userId,
    taskId,
    hint,
    tasks: digestTasks,
    filterNl,
  } = input;

  if (
    kind === "improve" ||
    kind === "proofread" ||
    kind === "subtasks" ||
    kind === "estimate"
  ) {
    if (!taskId) throw new Error("taskId is required for this action");
    const task = await loadTaskRowForUser(taskId, userId);
    if (!task) throw new Error("Task not found");
    const tagList = tagsToStringArray(task.tags);

    if (kind === "proofread") {
      const userTurn = [
        `Task title: ${task.title}`,
        `Description: ${task.description?.trim() || "No description"}`,
        `Tags: ${tagList.length ? tagList.join(", ") : "None"}`,
      ].join("\n");
      return generateJson(
        apiKey,
        "Proofread the task title and description: fix spelling, grammar, and punctuation only. " +
          "Do not change meaning or add content. Keep tags unless they contain obvious typos. " +
          'Respond with one JSON object only: {"title":"...","description":"...","tags":["..."]}. ' +
          "Omit keys you would not change. tags optional array of 0-8 short labels. No markdown.",
        userTurn,
        800,
        0.1,
      );
    }

    if (kind === "improve") {
      const userTurn = [
        `Task title: ${task.title}`,
        `Description: ${task.description?.trim() || "No description"}`,
        `Tags: ${tagList.length ? tagList.join(", ") : "None"}`,
        `Priority: ${task.priority}`,
        `Status: ${task.status}`,
      ].join("\n");
      return generateJson(
        apiKey,
        "You are a project management assistant. Suggest concise improvements. " +
          'Respond with one JSON object only: {"title":"...","description":"...","tags":["..."]}. ' +
          "Omit keys you would not change. tags optional array of 0-8 short labels. No markdown.",
        userTurn,
        800,
        0.2,
      );
    }

    if (kind === "subtasks") {
      const userTurn = [
        `Task title: ${task.title}`,
        `Description: ${task.description?.trim() || "No description"}`,
      ].join("\n");
      return generateJson(
        apiKey,
        "Break the task into 3-5 concrete subtasks (imperative, verifiable). " +
          'Respond with one JSON object only: {"subtasks":["..."]}. No markdown.',
        userTurn,
        700,
        0.2,
      );
    }

    const userTurn = [
      `Task title: ${task.title}`,
      `Description: ${task.description?.trim() || "No description"}`,
      `Priority: ${task.priority}`,
    ].join("\n");
    return generateJson(
      apiKey,
      "Estimate effort in wall-clock hours for one engineer familiar with the codebase. " +
        'Respond with one JSON object only: {"hours":number,"reasoning":"short string"}. ' +
        "hours should be a realistic number (fractions allowed). No markdown.",
      userTurn,
      400,
      0.15,
    );
  }

  if (kind === "view_digest") {
    const rows = digestTasks ?? [];
    if (rows.length === 0) throw new Error("No tasks to summarize");
    const lines = rows.map(
      (r) => `- [${(r as { task_key?: string }).task_key ?? r.id.slice(0, 8)}] ${r.title} (${r.status}, ${r.priority})`,
    );
    const userTurn = [
      "Here is the current filtered task list the user sees:",
      ...lines,
    ].join("\n");
    return generateJson(
      apiKey,
      "Summarize workload and themes for a team lead. Be factual; do not invent tasks. " +
        'Respond with one JSON object only: {"summary":"2-4 sentences","focus":["up to 5 short bullets"],"risks":["0-3 short bullets"]}. ' +
        "focus = what to tackle next; risks = blockers or gaps implied by titles/status only.",
      userTurn,
      900,
      0.25,
    );
  }

  if (kind === "quick_create") {
    const h = (hint || "").trim();
    if (!h) throw new Error("hint is required");
    const userTurn = `User wants a new task described as:\n${h.slice(0, 1200)}`;
    return generateJson(
      apiKey,
      "Draft a single task for a product/engineering tracker. " +
        'Respond with one JSON object only: {"title":"...","description":"...","priority":"urgent"|"high"|"medium"|"low","tags":["..."]}. ' +
        "description 1-3 short paragraphs plain text. tags 0-6 items.",
      userTurn,
      900,
      0.25,
    );
  }

  if (kind === "filter_nl") {
    const nl = (filterNl?.nl || "").trim();
    if (!nl) throw new Error("nl is required");
    const roster = filterNl?.roster ?? [];
    if (roster.length === 0) throw new Error("roster is required");
    const rosterLines = roster.map((r) => `- ${r.id} | ${r.name} | ${r.email}`);
    const userTurn = [
      "Natural language request:",
      nl.slice(0, 800),
      "",
      "Workspace members (use ONLY these ids for assignee_id, or null to clear assignee filter):",
      ...rosterLines,
    ].join("\n");
    return generateJson(
      apiKey,
      "Map the user's request to task list filters. Valid status values: backlog, todo, in-progress, review, done. " +
        "Valid priority values: urgent, high, medium, low. " +
        "assignee_id must be exactly one of the UUIDs listed above, or null to mean no assignee filter / all assignees. " +
        'Respond with one JSON object only: {"explanation":"one short sentence what you matched","q":"optional search substring for task title","status":["..."],"priority":["..."],"assignee_id":"uuid-or-null"}. ' +
        "Omit status/priority/q/assignee_id keys if the user did not imply them. Use arrays only for status and priority.",
      userTurn,
      700,
      0.1,
    );
  }

  throw new Error("Unsupported kind");
}

export function mapTaskAiError(e: unknown): {
  httpStatus: number;
  message: string;
} {
  return mapGeminiClientError(e);
}
