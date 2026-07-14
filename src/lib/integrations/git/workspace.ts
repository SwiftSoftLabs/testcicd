import { query, SCHEMA } from "@/lib/db";

export async function isWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const res = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, userId],
  );
  return res.rows.length > 0;
}

export async function isProjectInWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const res = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.projects WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [projectId, workspaceId],
  );
  return res.rows.length > 0;
}
