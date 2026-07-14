import { query, SCHEMA } from '@/lib/db';
import { deriveProjectKey, projectKeyCandidates } from '@/lib/tasks/taskKey';

export async function resolveUniqueProjectKey(
  name: string,
  workspaceId: string,
  excludeProjectId?: string,
): Promise<string> {
  const existing = await query<{ key: string | null }>(
    `SELECT key FROM ${SCHEMA}.projects
     WHERE workspace_id = $1 AND key IS NOT NULL
       ${excludeProjectId ? 'AND id <> $2' : ''}`,
    excludeProjectId ? [workspaceId, excludeProjectId] : [workspaceId],
  );
  const taken = new Set(
    existing.rows
      .map((r) => r.key?.toUpperCase())
      .filter((k): k is string => Boolean(k)),
  );

  for (const candidate of projectKeyCandidates(name)) {
    if (!taken.has(candidate.toUpperCase())) {
      return candidate;
    }
  }
  return deriveProjectKey(name);
}
