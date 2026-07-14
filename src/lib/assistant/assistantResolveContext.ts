import type { Status } from "@/types";
import { query, SCHEMA } from "@/lib/db";

export type NamedEntity = { id: string; name: string };

export type ProjectReference = { id: string; name: string; key: string | null };

export type TaskReference = {
  id: string;
  title: string;
  task_key: string | null;
};

export interface TaskFilterCriteria {
  q?: string;
  status?: string[];
  priority?: string[];
  assignee_id?: string | null;
}

export const BULK_TASK_CAP = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TASK_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/i;

const STATUS_VALUES: readonly Status[] = [
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
];

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0),
  );
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function extractNameAfterPattern(
  transcript: string,
  pattern: RegExp,
): string | null {
  const m = transcript.match(pattern);
  const raw = m?.[1]?.trim();
  return raw && raw.length >= 2 ? raw : null;
}

export function resolveByName(
  phrase: string,
  candidates: NamedEntity[],
): NamedEntity | null {
  const cleaned = normalizeName(phrase);
  if (!cleaned) return null;

  const exact = candidates.find((c) => normalizeName(c.name) === cleaned);
  if (exact) return exact;

  let best: NamedEntity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const name = normalizeName(c.name);
    const dist = levenshtein(cleaned, name);
    const maxLen = Math.max(cleaned.length, name.length);
    if (maxLen < 3) continue;
    const threshold = maxLen >= 10 ? 3 : maxLen >= 6 ? 2 : 1;
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

export async function loadUserWorkspaces(
  userId: string,
): Promise<NamedEntity[]> {
  const res = await query<{ id: string; name: string }>(
    `SELECT w.id, w.name
     FROM ${SCHEMA}.workspaces w
     INNER JOIN ${SCHEMA}.workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = $1
     ORDER BY w.name`,
    [userId],
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function loadWorkspaceProjects(
  workspaceId: string,
): Promise<NamedEntity[]> {
  const projects = await loadWorkspaceProjectsDetailed(workspaceId);
  return projects.map((r) => ({ id: r.id, name: r.name }));
}

export async function loadWorkspaceProjectsDetailed(
  workspaceId: string,
): Promise<ProjectReference[]> {
  const res = await query<ProjectReference>(
    `SELECT id, name, key FROM ${SCHEMA}.projects
     WHERE workspace_id = $1
     ORDER BY name`,
    [workspaceId],
  );
  return res.rows;
}

/** Resolve a project by UUID, project key (e.g. ONEWORK), or fuzzy name. */
export async function resolveProjectReference(
  workspaceId: string,
  phrase: string,
): Promise<ProjectReference | null> {
  const trimmed = phrase.trim();
  if (!trimmed) return null;

  if (UUID_RE.test(trimmed)) {
    const res = await query<ProjectReference>(
      `SELECT id, name, key FROM ${SCHEMA}.projects
       WHERE workspace_id = $1 AND id = $2::uuid
       LIMIT 1`,
      [workspaceId, trimmed],
    );
    return res.rows[0] ?? null;
  }

  const projects = await loadWorkspaceProjectsDetailed(workspaceId);
  const sanitizedKey = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (sanitizedKey.length >= 2) {
    const byKey = projects.find(
      (p) => p.key && p.key.toUpperCase() === sanitizedKey,
    );
    if (byKey) return byKey;
  }

  const byName = resolveByName(
    trimmed,
    projects.map((p) => ({ id: p.id, name: p.name })),
  );
  if (!byName) return null;
  return projects.find((p) => p.id === byName.id) ?? null;
}

export function normalizeTaskStatus(spoken: string): Status | null {
  const normalized = spoken
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ");

  const map: Record<string, Status> = {
    backlog: "backlog",
    todo: "todo",
    "to do": "todo",
    "in progress": "in-progress",
    inprogress: "in-progress",
    progress: "in-progress",
    review: "review",
    "in review": "review",
    done: "done",
    complete: "done",
    completed: "done",
  };

  const direct = map[normalized];
  if (direct) return direct;

  for (const status of STATUS_VALUES) {
    if (normalized === status.replace(/-/g, " ")) return status;
  }
  return null;
}

/** "onework 46" / "ONEWORK 46" → ONEWORK-46 for task_key lookup */
export function normalizeTaskKeyPhrase(phrase: string): string {
  const trimmed = phrase.trim();
  const spaced = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s+(\d+)$/);
  if (spaced) {
    return `${spaced[1].toUpperCase()}-${spaced[2]}`;
  }
  return trimmed;
}

export function isStatusDestinationPhrase(phrase: string): boolean {
  return normalizeTaskStatus(phrase) !== null;
}

export function isThisTaskReference(phrase: string): boolean {
  const cleaned = phrase.trim().toLowerCase();
  return (
    cleaned === "this task" ||
    cleaned === "this" ||
    cleaned === "current task" ||
    cleaned === "open task"
  );
}

export async function loadWorkspaceMembers(
  workspaceId: string,
): Promise<NamedEntity[]> {
  const res = await query<{ id: string; name: string | null; email: string | null }>(
    `SELECT p.id, p.full_name AS name, p.email
     FROM ${SCHEMA}.workspace_members wm
     JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
     WHERE wm.workspace_id = $1`,
    [workspaceId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: (r.name || r.email || "User").slice(0, 120),
  }));
}

export async function findTaskByTitle(
  workspaceId: string,
  projectId: string | null,
  titlePhrase: string,
): Promise<{ id: string; title: string } | null> {
  const task = await findTaskByReference({
    workspaceId,
    projectId,
    phrase: titlePhrase,
    workspaceWide: false,
  });
  return task ? { id: task.id, title: task.title } : null;
}

export async function findTaskByReference(opts: {
  workspaceId: string;
  projectId: string | null;
  phrase: string;
  openTaskId?: string | null;
  workspaceWide?: boolean;
}): Promise<TaskReference | null> {
  const rawPhrase = opts.phrase.trim();
  const phrase = normalizeTaskKeyPhrase(rawPhrase);

  if (
    (!rawPhrase || isThisTaskReference(rawPhrase)) &&
    opts.openTaskId &&
    UUID_RE.test(opts.openTaskId)
  ) {
    const res = await query<TaskReference>(
      `SELECT id, title, task_key
       FROM ${SCHEMA}.tasks
       WHERE id = $1::uuid AND workspace_id = $2::uuid
       LIMIT 1`,
      [opts.openTaskId, opts.workspaceId],
    );
    return res.rows[0] ?? null;
  }

  if (!phrase) return null;

  if (UUID_RE.test(phrase)) {
    const res = await query<TaskReference>(
      `SELECT id, title, task_key
       FROM ${SCHEMA}.tasks
       WHERE id = $1::uuid AND workspace_id = $2::uuid
       LIMIT 1`,
      [phrase, opts.workspaceId],
    );
    return res.rows[0] ?? null;
  }

  if (TASK_KEY_RE.test(phrase)) {
    const res = await query<TaskReference>(
      `SELECT id, title, task_key
       FROM ${SCHEMA}.tasks
       WHERE workspace_id = $1::uuid AND upper(task_key) = upper($2)
       LIMIT 1`,
      [opts.workspaceId, phrase],
    );
    return res.rows[0] ?? null;
  }

  const params: unknown[] = [opts.workspaceId];
  let projectClause = "";
  if (opts.projectId && !opts.workspaceWide) {
    params.push(opts.projectId);
    projectClause = ` AND t.project_id = $${params.length}::uuid`;
  }

  const res = await query<TaskReference>(
    `SELECT t.id, t.title, t.task_key
     FROM ${SCHEMA}.tasks t
     WHERE t.workspace_id = $1::uuid ${projectClause}
     ORDER BY t.updated_at DESC
     LIMIT 80`,
    params,
  );
  const match = resolveByName(
    phrase,
    res.rows.map((r) => ({ id: r.id, name: r.title })),
  );
  if (!match) return null;
  return res.rows.find((r) => r.id === match.id) ?? null;
}

export async function findTaskIdsByFilter(
  workspaceId: string,
  projectId: string | null,
  filter: TaskFilterCriteria,
  cap = BULK_TASK_CAP + 1,
): Promise<{ ids: string[]; overCap: boolean }> {
  const params: unknown[] = [workspaceId];
  const clauses: string[] = ["t.workspace_id = $1::uuid"];

  if (projectId) {
    params.push(projectId);
    clauses.push(`t.project_id = $${params.length}::uuid`);
  }

  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().slice(0, 200)}%`);
    clauses.push(
      `(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length} OR t.task_key ILIKE $${params.length})`,
    );
  }

  if (filter.status?.length) {
    params.push(filter.status);
    clauses.push(`t.status = ANY($${params.length}::text[])`);
  }

  if (filter.priority?.length) {
    params.push(filter.priority);
    clauses.push(`t.priority = ANY($${params.length}::text[])`);
  }

  if (filter.assignee_id === null) {
    clauses.push("t.assignee_id IS NULL");
  } else if (filter.assignee_id) {
    params.push(filter.assignee_id);
    clauses.push(`t.assignee_id = $${params.length}::uuid`);
  }

  const res = await query<{ id: string }>(
    `SELECT t.id
     FROM ${SCHEMA}.tasks t
     WHERE ${clauses.join(" AND ")}
     ORDER BY t.updated_at DESC
     LIMIT $${params.length + 1}`,
    [...params, cap],
  );

  const ids = res.rows.map((r) => r.id);
  return {
    ids: ids.slice(0, BULK_TASK_CAP),
    overCap: ids.length > BULK_TASK_CAP,
  };
}
