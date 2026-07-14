import { query, SCHEMA } from "@/lib/db";
import { toAccessResponse } from "@/lib/rbac/http";
import { requireWorkspaceTasksRead, requireWorkspaceTasksWrite, requireTaskRead } from "@/lib/rbac/task-access";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import {
  mapTaskAiError,
  runTaskAi,
  type TaskAiKind,
  type TaskDigestItem,
  type TaskFilterRosterEntry,
} from "@/lib/tasks/taskAiService";
import { taskAiCacheGet, taskAiCacheKey, taskAiCacheSet } from "@/lib/tasks/taskAiResponseCache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_DIGEST_TASKS = 40;
const MAX_TITLE_LEN = 280;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_ALLOW = new Set(["backlog", "todo", "in-progress", "review", "done"]);
const PRIORITY_ALLOW = new Set(["urgent", "high", "medium", "low"]);

function isTaskAiKind(v: string): v is TaskAiKind {
  return (
    v === "improve" ||
    v === "proofread" ||
    v === "subtasks" ||
    v === "estimate" ||
    v === "view_digest" ||
    v === "quick_create" ||
    v === "filter_nl"
  );
}

function sanitizeDigestTasks(raw: unknown): TaskDigestItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskDigestItem[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DIGEST_TASKS) break;
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const title = typeof o.title === "string" ? o.title.trim().slice(0, MAX_TITLE_LEN) : "";
    if (!id || !title) continue;
    if (!UUID_RE.test(id)) continue;
    const status = typeof o.status === "string" ? o.status.trim().slice(0, 48) : "unknown";
    const priority = typeof o.priority === "string" ? o.priority.trim().slice(0, 32) : "unknown";
    out.push({ id, title, status, priority });
  }
  return out;
}

async function loadWorkspaceRoster(workspaceId: string): Promise<TaskFilterRosterEntry[]> {
  const r = await query<{ id: string; name: string | null; email: string | null }>(
    `SELECT p.id, p.full_name AS name, p.email
     FROM ${SCHEMA}.workspace_members wm
     JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY p.full_name NULLS LAST, p.email`,
    [workspaceId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: (row.name || row.email || "User").slice(0, 120),
    email: (row.email || "").slice(0, 200),
  }));
}

function sanitizeFilterNlResult(
  raw: Record<string, unknown>,
  rosterIds: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw.explanation === "string") out.explanation = raw.explanation.trim().slice(0, 600);
  if (typeof raw.q === "string") {
    const q = raw.q.trim();
    if (q) out.q = q.slice(0, 200);
  }
  if (Array.isArray(raw.status)) {
    const st = [
      ...new Set(
        raw.status.filter((x): x is string => typeof x === "string" && STATUS_ALLOW.has(x)),
      ),
    ];
    if (st.length) out.status = st;
  }
  if (Array.isArray(raw.priority)) {
    const pr = [
      ...new Set(
        raw.priority.filter((x): x is string => typeof x === "string" && PRIORITY_ALLOW.has(x)),
      ),
    ];
    if (pr.length) out.priority = pr;
  }
  if (raw.assignee_id === null) {
    out.assignee_id = null;
  } else if (typeof raw.assignee_id === "string" && rosterIds.has(raw.assignee_id)) {
    out.assignee_id = raw.assignee_id;
  }
  return out;
}

/**
 * Keep only tasks the user may access (workspace member) and refresh fields from DB
 * so clients cannot spoof titles or enumerate arbitrary UUIDs.
 */
async function resolveDigestTasksForUser(
  userId: string,
  requested: TaskDigestItem[],
): Promise<{ tasks: TaskDigestItem[]; droppedCount: number }> {
  if (requested.length === 0) return { tasks: [], droppedCount: 0 };
  const ids = requested.map((t) => t.id);
  const res = await query<{ id: string; title: string; status: string; priority: string }>(
    `SELECT t.id, t.title, t.status::text, t.priority::text
     FROM ${SCHEMA}.tasks t
     INNER JOIN ${SCHEMA}.workspace_members wm
       ON wm.workspace_id = t.workspace_id AND wm.user_id = $1
     WHERE t.id = ANY($2::uuid[])`,
    [userId, ids],
  );
  const rowMap = new Map(res.rows.map((r) => [r.id, r]));
  const tasks: TaskDigestItem[] = [];
  for (const req of requested) {
    const row = rowMap.get(req.id);
    if (!row) continue;
    tasks.push({
      id: row.id,
      title: (row.title || "(Untitled)").slice(0, MAX_TITLE_LEN),
      status: row.status,
      priority: row.priority,
    });
  }
  return { tasks, droppedCount: requested.length - tasks.length };
}

export async function POST(request: Request) {
  try {
  const user = await requireSessionUser(request);

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const rate = checkSimpleRateLimit(`task-ai:${user.id}`, 40, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many task AI requests. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.retryAfterMs ?? 60_000) / 1000)),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kindRaw =
    (typeof body.kind === "string" && body.kind.trim()) ||
    (typeof body.type === "string" && body.type.trim()) ||
    "";
  if (!isTaskAiKind(kindRaw)) {
    return NextResponse.json({ error: "Invalid or missing kind" }, { status: 400 });
  }
  const kind = kindRaw;

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const hint = typeof body.hint === "string" ? body.hint : "";
  const nlRaw = typeof body.nl === "string" ? body.nl.trim() : "";
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const tasks = sanitizeDigestTasks(body.tasks);

  if (taskId && UUID_RE.test(taskId)) {
    await requireTaskRead(taskId, user.id);
  }
  if (kind === "quick_create" && UUID_RE.test(workspaceId)) {
    await requireWorkspaceTasksWrite(workspaceId, user.id);
  }

  let tasksForDigest: TaskDigestItem[] | undefined;
  let digestDroppedCount = 0;
  if (kind === "view_digest") {
    const resolved = await resolveDigestTasksForUser(user.id, tasks);
    tasksForDigest = resolved.tasks;
    digestDroppedCount = resolved.droppedCount;
    if (!tasksForDigest.length) {
      return NextResponse.json(
        { error: "No accessible tasks in the selection." },
        { status: 403 },
      );
    }
  }

  let rosterForNl: TaskFilterRosterEntry[] | undefined;
  if (kind === "filter_nl") {
    if (!UUID_RE.test(workspaceId)) {
      return NextResponse.json({ error: "workspaceId is required for filter_nl" }, { status: 400 });
    }
    if (!nlRaw) {
      return NextResponse.json({ error: "nl is required" }, { status: 400 });
    }
    await requireWorkspaceTasksRead(workspaceId, user.id);
    rosterForNl = await loadWorkspaceRoster(workspaceId);
    if (!rosterForNl.length) {
      return NextResponse.json({ error: "No workspace members to resolve assignee" }, { status: 400 });
    }
  }

  const cacheableKinds: TaskAiKind[] = ["view_digest", "quick_create", "filter_nl"];
  let cacheKey: string | null = null;
  if (cacheableKinds.includes(kind)) {
    if (kind === "view_digest") {
      const sig = tasksForDigest!.map((t) => [t.id, t.title, t.status, t.priority]);
      cacheKey = taskAiCacheKey(["v1", user.id, kind, sig]);
    } else if (kind === "quick_create") {
      cacheKey = taskAiCacheKey(["v1", user.id, kind, hint.trim().slice(0, 1200)]);
    } else {
      cacheKey = taskAiCacheKey(["v1", user.id, kind, workspaceId, nlRaw.slice(0, 800)]);
    }
    const hit = cacheKey ? taskAiCacheGet(cacheKey) : null;
    if (hit) {
      return NextResponse.json({ ...hit, cached: true });
    }
  }

  try {
    let result: Record<string, unknown>;

    if (kind === "filter_nl") {
      const roster = rosterForNl!;
      result = await runTaskAi({
        apiKey,
        kind: "filter_nl",
        userId: user.id,
        filterNl: { nl: nlRaw.slice(0, 800), roster },
      });
      const rosterIds = new Set(roster.map((r) => r.id));
      result = sanitizeFilterNlResult(result, rosterIds);
    } else {
      result = await runTaskAi({
        apiKey,
        kind,
        userId: user.id,
        taskId: taskId || undefined,
        hint: hint || undefined,
        tasks: kind === "view_digest" ? tasksForDigest : undefined,
      });
    }

    if (digestDroppedCount > 0) {
      result = { ...result, digest_skipped_count: digestDroppedCount };
    }

    if (cacheKey) taskAiCacheSet(cacheKey, result);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Task AI failed";
    if (msg === "Task not found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (
      msg === "hint is required" ||
      msg === "No tasks to summarize" ||
      msg === "taskId is required for this action" ||
      msg === "nl is required" ||
      msg === "roster is required"
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const mapped = mapTaskAiError(e);
    return NextResponse.json({ error: mapped.message }, { status: mapped.httpStatus });
  }
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) return access;
    const msg = e instanceof Error ? e.message : "Task AI failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
