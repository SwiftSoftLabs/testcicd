import { query, SCHEMA } from "@/lib/db";

import type { GitRepo } from "@/types/git";

export type GitProjectPlatformRepoRow = {
  project_id: string;
  workspace_id: string;
  provider: string;
  repo_external_id: string;
  repo_full_name: string;
  repo_owner: string;
  repo_name: string;
  default_branch: string;
  is_private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  description: string | null;
  homepage: string | null;
  license: string | null;
  stargazers_count: number;
  updated_at_repo: string;
  created_at: string;
};

function rowToGitRepo(row: GitProjectPlatformRepoRow): GitRepo {
  return {
    id: row.repo_external_id,
    provider: "onework",
    owner: row.repo_owner,
    name: row.repo_name,
    fullName: row.repo_full_name,
    private: row.is_private,
    defaultBranch: row.default_branch || "main",
    description: row.description,
    homepage: row.homepage,
    license: row.license,
    htmlUrl: row.html_url,
    cloneUrl: row.clone_url,
    sshUrl: row.ssh_url,
    stargazersCount: row.stargazers_count,
    updatedAt: row.updated_at_repo || row.created_at,
  };
}

export async function getPlatformRepoForProject(
  projectId: string,
): Promise<GitRepo | null> {
  const res = await query<GitProjectPlatformRepoRow>(
    `SELECT * FROM ${SCHEMA}.git_project_platform_repos WHERE project_id = $1 LIMIT 1`,
    [projectId],
  );
  const row = res.rows[0];
  return row ? rowToGitRepo(row) : null;
}

export async function listPlatformReposForWorkspace(
  workspaceId: string,
): Promise<GitRepo[]> {
  const res = await query<GitProjectPlatformRepoRow>(
    `SELECT * FROM ${SCHEMA}.git_project_platform_repos
     WHERE workspace_id = $1
     ORDER BY repo_full_name ASC`,
    [workspaceId],
  );
  return res.rows.map(rowToGitRepo);
}

export async function upsertPlatformRepo(params: {
  projectId: string;
  workspaceId: string;
  repoExternalId: string;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  isPrivate: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  description?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.git_project_platform_repos (
      project_id, workspace_id, provider,
      repo_external_id, repo_full_name, repo_owner, repo_name,
      default_branch, is_private, html_url, clone_url, ssh_url,
      description, updated_at_repo
    ) VALUES (
      $1, $2, 'onework',
      $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13
    )
    ON CONFLICT (project_id) DO UPDATE SET
      repo_external_id = EXCLUDED.repo_external_id,
      repo_full_name = EXCLUDED.repo_full_name,
      repo_owner = EXCLUDED.repo_owner,
      repo_name = EXCLUDED.repo_name,
      default_branch = EXCLUDED.default_branch,
      is_private = EXCLUDED.is_private,
      html_url = EXCLUDED.html_url,
      clone_url = EXCLUDED.clone_url,
      ssh_url = EXCLUDED.ssh_url,
      description = EXCLUDED.description,
      updated_at_repo = EXCLUDED.updated_at_repo`,
    [
      params.projectId,
      params.workspaceId,
      params.repoExternalId,
      params.repoFullName,
      params.repoOwner,
      params.repoName,
      params.defaultBranch,
      params.isPrivate,
      params.htmlUrl,
      params.cloneUrl,
      params.sshUrl,
      params.description ?? null,
      new Date().toISOString(),
    ],
  );
}
