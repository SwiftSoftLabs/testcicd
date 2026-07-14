import { query, SCHEMA } from "@/lib/db";

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export async function isRepoCollaboratorExcluded(params: {
  workspaceId: string;
  owner: string;
  repo: string;
  giteaUsername: string;
}): Promise<boolean> {
  const username = normalizeUsername(params.giteaUsername);
  if (!username) return false;
  try {
    const row = await query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM ${SCHEMA}.git_repo_collaborator_exclusions
       WHERE workspace_id = $1
         AND repo_owner = $2
         AND repo_name = $3
         AND lower(gitea_username) = $4
       LIMIT 1`,
      [params.workspaceId, params.owner, params.repo, username],
    );
    return Boolean(row.rows[0]);
  } catch {
    return false;
  }
}

export async function recordRepoCollaboratorExclusion(params: {
  workspaceId: string;
  owner: string;
  repo: string;
  giteaUsername: string;
}): Promise<void> {
  const username = normalizeUsername(params.giteaUsername);
  if (!username) return;
  await query(
    `INSERT INTO ${SCHEMA}.git_repo_collaborator_exclusions
       (workspace_id, repo_owner, repo_name, gitea_username)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [params.workspaceId, params.owner, params.repo, username],
  );
}

export async function clearRepoCollaboratorExclusion(params: {
  workspaceId: string;
  owner: string;
  repo: string;
  giteaUsername: string;
}): Promise<void> {
  const username = normalizeUsername(params.giteaUsername);
  if (!username) return;
  await query(
    `DELETE FROM ${SCHEMA}.git_repo_collaborator_exclusions
     WHERE workspace_id = $1
       AND repo_owner = $2
       AND repo_name = $3
       AND lower(gitea_username) = $4`,
    [params.workspaceId, params.owner, params.repo, username],
  );
}
