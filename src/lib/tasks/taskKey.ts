export const PROJECT_KEY_MAX_LENGTH = 50;

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,49}$/;

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  done: 'Done',
};

export function formatTaskKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

function sanitizeNameToKey(name: string): string {
  const key = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (key.length < 2) return 'GEN';
  return key.slice(0, PROJECT_KEY_MAX_LENGTH);
}

/**
 * Primary project key from name — full sanitized name (e.g. "OneWork" → ONEWORK).
 */
export function deriveProjectKey(name: string): string {
  return sanitizeNameToKey(name);
}

/**
 * Ordered fallback keys when the primary collides within a workspace.
 */
export function projectKeyCandidates(name: string): string[] {
  const primary = deriveProjectKey(name);
  const out: string[] = [primary];

  for (let n = 2; n <= 99; n++) {
    const suffix = String(n);
    const baseMax = PROJECT_KEY_MAX_LENGTH - suffix.length;
    if (baseMax < 2) break;
    out.push(`${primary.slice(0, baseMax)}${suffix}`);
  }

  return [...new Set(out.filter((k) => PROJECT_KEY_RE.test(k)))];
}

export function pickUniqueProjectKey(
  name: string,
  takenInWorkspace: ReadonlySet<string>,
): string {
  for (const candidate of projectKeyCandidates(name)) {
    if (!takenInWorkspace.has(candidate.toUpperCase())) {
      return candidate;
    }
  }
  return deriveProjectKey(name);
}

export function deriveWorkspaceKey(slug: string): string {
  return sanitizeNameToKey(slug.length >= 2 ? slug : 'ws');
}

export function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeProjectKeyInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PROJECT_KEY_MAX_LENGTH);
}

export function getTaskDisplayKey(task: { taskKey?: string; id: string }): string {
  if (task.taskKey) return task.taskKey;
  return task.id.slice(0, 8);
}
