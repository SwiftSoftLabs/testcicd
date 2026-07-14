import { query, SCHEMA } from "@/lib/db";
import type { GitRepoVercelDeploymentLink } from "@/types/git";

export type GitRepoVercelDeploymentRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  git_provider: "onework";
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  vercel_project_id: string;
  vercel_project_name: string;
  production_branch: string;
  gitea_deploy_token_enc: string | null;
  vercel_webhook_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToLink(row: GitRepoVercelDeploymentRow): GitRepoVercelDeploymentLink {
  return {
    id: row.id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    git_provider: row.git_provider,
    repo_owner: row.repo_owner,
    repo_name: row.repo_name,
    repo_full_name: row.repo_full_name,
    vercel_project_id: row.vercel_project_id,
    vercel_project_name: row.vercel_project_name,
    production_branch: row.production_branch,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getVercelDeploymentLinkForRepo(
  projectId: string,
  repoFullName: string,
): Promise<GitRepoVercelDeploymentRow | null> {
  const res = await query<GitRepoVercelDeploymentRow>(
    `SELECT * FROM ${SCHEMA}.git_repo_vercel_deployments
     WHERE project_id = $1 AND repo_full_name = $2
     LIMIT 1`,
    [projectId, repoFullName],
  );
  return res.rows[0] ?? null;
}

export async function getEnabledVercelDeploymentLinkForRepo(
  projectId: string,
  repoFullName: string,
): Promise<GitRepoVercelDeploymentRow | null> {
  const row = await getVercelDeploymentLinkForRepo(projectId, repoFullName);
  return row?.enabled ? row : null;
}

export async function getVercelDeploymentLinkByVercelProjectId(
  vercelProjectId: string,
): Promise<GitRepoVercelDeploymentRow | null> {
  const res = await query<GitRepoVercelDeploymentRow>(
    `SELECT * FROM ${SCHEMA}.git_repo_vercel_deployments
     WHERE vercel_project_id = $1 AND enabled = true
     LIMIT 1`,
    [vercelProjectId],
  );
  return res.rows[0] ?? null;
}

export async function getVercelDeploymentLinkForProjectRepo(
  projectId: string,
  owner: string,
  repo: string,
): Promise<GitRepoVercelDeploymentLink | null> {
  const fullName = `${owner}/${repo}`;
  const row = await getVercelDeploymentLinkForRepo(projectId, fullName);
  return row ? rowToLink(row) : null;
}

export async function upsertVercelDeploymentLink(params: {
  projectId: string;
  workspaceId: string;
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  vercelProjectId: string;
  vercelProjectName: string;
  productionBranch: string;
  giteaDeployTokenEnc: string | null;
  vercelWebhookId: string | null;
  createdBy: string;
}): Promise<GitRepoVercelDeploymentRow> {
  const res = await query<GitRepoVercelDeploymentRow>(
    `INSERT INTO ${SCHEMA}.git_repo_vercel_deployments (
        project_id, workspace_id, git_provider,
        repo_owner, repo_name, repo_full_name,
        vercel_project_id, vercel_project_name, production_branch,
        gitea_deploy_token_enc, vercel_webhook_id, created_by
     ) VALUES ($1, $2, 'onework', $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (project_id, git_provider, repo_full_name)
     DO UPDATE SET
        vercel_project_id = EXCLUDED.vercel_project_id,
        vercel_project_name = EXCLUDED.vercel_project_name,
        production_branch = EXCLUDED.production_branch,
        gitea_deploy_token_enc = EXCLUDED.gitea_deploy_token_enc,
        vercel_webhook_id = EXCLUDED.vercel_webhook_id,
        enabled = true,
        updated_at = NOW()
     RETURNING *`,
    [
      params.projectId,
      params.workspaceId,
      params.repoOwner,
      params.repoName,
      params.repoFullName,
      params.vercelProjectId,
      params.vercelProjectName,
      params.productionBranch,
      params.giteaDeployTokenEnc,
      params.vercelWebhookId,
      params.createdBy,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to save Vercel deployment link");
  return row;
}

export async function deleteVercelDeploymentLink(
  projectId: string,
  repoFullName: string,
): Promise<GitRepoVercelDeploymentRow | null> {
  const res = await query<GitRepoVercelDeploymentRow>(
    `DELETE FROM ${SCHEMA}.git_repo_vercel_deployments
     WHERE project_id = $1 AND repo_full_name = $2
     RETURNING *`,
    [projectId, repoFullName],
  );
  return res.rows[0] ?? null;
}
