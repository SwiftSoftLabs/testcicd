import { query, SCHEMA } from "@/lib/db";

import type { GitProvider } from "@/types/git";
import type { PullRequest } from "@/types";

import { parseVcPullId } from "./vc-pull-id";

export type OneworkPullAuthorContext = {
  workspaceId?: string;
  repoOwner?: string;
  repoName?: string;
};

export async function resolveOneworkUserIdByGiteaUsername(
  giteaUsername: string | null | undefined,
): Promise<string | null> {
  const normalized = giteaUsername?.trim();
  if (!normalized) return null;
  const row = await query<{ user_id: string }>(
    `SELECT user_id
     FROM ${SCHEMA}.onework_vc_accounts
     WHERE lower(gitea_username) = lower($1)
     LIMIT 1`,
    [normalized],
  );
  return row.rows[0]?.user_id ?? null;
}

export async function resolveOneworkUserIdInWorkspace(
  workspaceId: string | undefined,
  login: string | null | undefined,
): Promise<string | null> {
  const fromAccount = await resolveOneworkUserIdByGiteaUsername(login);
  if (fromAccount) return fromAccount;
  const normalized = login?.trim();
  if (!workspaceId || !normalized) return null;
  const row = await query<{ user_id: string }>(
    `SELECT user_id
     FROM ${SCHEMA}.git_integrations
     WHERE workspace_id = $1
       AND provider = 'onework'
       AND lower(account_login) = lower($2)
     LIMIT 1`,
    [workspaceId, normalized],
  );
  return row.rows[0]?.user_id ?? null;
}

export async function lookupOneworkPullCreator(params: {
  workspaceId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
}): Promise<string | null> {
  const row = await query<{ created_by_user_id: string }>(
    `SELECT created_by_user_id
     FROM ${SCHEMA}.onework_vc_pull_creators
     WHERE workspace_id = $1
       AND repo_owner = $2
       AND repo_name = $3
       AND pr_number = $4
     LIMIT 1`,
    [
      params.workspaceId,
      params.repoOwner,
      params.repoName,
      params.prNumber,
    ],
  );
  return row.rows[0]?.created_by_user_id ?? null;
}

export async function recordOneworkPullCreator(params: {
  workspaceId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  userId: string;
}): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.onework_vc_pull_creators (
       workspace_id, repo_owner, repo_name, pr_number, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, repo_owner, repo_name, pr_number)
     DO UPDATE SET created_by_user_id = EXCLUDED.created_by_user_id`,
    [
      params.workspaceId,
      params.repoOwner,
      params.repoName,
      params.prNumber,
      params.userId,
    ],
  );
}

export async function enrichPullWithAuthorUserId(
  pull: PullRequest,
  provider: GitProvider,
  ctx?: OneworkPullAuthorContext,
): Promise<PullRequest> {
  if (provider !== "onework" || pull.author_user_id) return pull;

  const parsed = parseVcPullId(pull.id);
  const prNumber = parsed?.number;

  if (ctx?.workspaceId && ctx.repoOwner && ctx.repoName && prNumber) {
    const creator = await lookupOneworkPullCreator({
      workspaceId: ctx.workspaceId,
      repoOwner: ctx.repoOwner,
      repoName: ctx.repoName,
      prNumber,
    });
    if (creator) return { ...pull, author_user_id: creator };
  }

  const authorUserId = await resolveOneworkUserIdInWorkspace(
    ctx?.workspaceId,
    pull.author_id || pull.author?.full_name || null,
  );
  if (!authorUserId) return pull;
  return { ...pull, author_user_id: authorUserId };
}

export async function enrichPullsWithAuthorUserId(
  pulls: PullRequest[],
  provider: GitProvider,
  ctx?: OneworkPullAuthorContext,
): Promise<PullRequest[]> {
  if (provider !== "onework" || pulls.length === 0) return pulls;
  return Promise.all(
    pulls.map((pull) => enrichPullWithAuthorUserId(pull, provider, ctx)),
  );
}
