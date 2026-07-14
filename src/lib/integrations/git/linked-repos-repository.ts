import { query, SCHEMA } from "@/lib/db";

import type { GitProvider, GitRepo } from "@/types/git";

export type GitProjectLinkedRepoRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  user_id: string;
  provider: GitProvider;
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

function rowToGitRepo(
  row: GitProjectLinkedRepoRow,
  provider: GitProvider,
): GitRepo {
  return {
    id: row.repo_external_id,
    provider,
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

export async function listLinkedReposForProject(
  projectId: string,
  workspaceId: string,
  userId: string,
  provider: GitProvider,
): Promise<GitRepo[]> {
  const res = await query<GitProjectLinkedRepoRow>(
    `SELECT *
         FROM ${SCHEMA}.git_project_linked_repos
         WHERE project_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4::text
         ORDER BY repo_full_name ASC`,
    [projectId, workspaceId, userId, provider],
  );
  return res.rows.map((r) => rowToGitRepo(r, provider));
}

export type LinkedRepoInput = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  description?: string | null;
  homepage?: string | null;
  license?: string | null;
  stargazersCount?: number;
  updatedAt?: string;
};

export async function replaceLinkedReposForProject(params: {
  projectId: string;
  workspaceId: string;
  userId: string;
  provider: GitProvider;
  repos: LinkedRepoInput[];
}): Promise<void> {
  await query(
    `DELETE FROM ${SCHEMA}.git_project_linked_repos
         WHERE project_id = $1 AND workspace_id = $2 AND user_id = $3 AND provider = $4::text`,
    [params.projectId, params.workspaceId, params.userId, params.provider],
  );

  for (const r of params.repos) {
    await query(
      `INSERT INTO ${SCHEMA}.git_project_linked_repos (
                project_id, workspace_id, user_id, provider,
                repo_external_id, repo_full_name, repo_owner, repo_name,
                default_branch, is_private, html_url, clone_url, ssh_url,
                description, homepage, license, stargazers_count, updated_at_repo
            ) VALUES (
                $1, $2, $3, $4::text,
                $5, $6, $7, $8,
                $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18
            )`,
      [
        params.projectId,
        params.workspaceId,
        params.userId,
        params.provider,
        r.id,
        r.fullName,
        r.owner,
        r.name,
        r.defaultBranch || "main",
        r.private,
        r.htmlUrl,
        r.cloneUrl,
        r.sshUrl,
        r.description ?? null,
        r.homepage ?? null,
        r.license ?? null,
        r.stargazersCount ?? 0,
        r.updatedAt ?? new Date().toISOString(),
      ],
    );
  }
}

export async function deleteLinkedReposForUserProvider(
  workspaceId: string,
  userId: string,
  provider: GitProvider,
): Promise<void> {
  await query(
    `DELETE FROM ${SCHEMA}.git_project_linked_repos
         WHERE workspace_id = $1 AND user_id = $2 AND provider = $3::text`,
    [workspaceId, userId, provider],
  );
}
