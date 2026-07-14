import { query, SCHEMA } from "@/lib/db";

import { deleteLinkedReposForUserProvider } from "./linked-repos-repository";
import { decryptGitToken, encryptGitToken } from "./crypto";
import type {
  GitIntegrationAccount,
  GitIntegrationRow,
  GitProvider,
} from "@/types/git";

function rowToPublic(row: GitIntegrationRow): GitIntegrationAccount {
  return {
    provider: row.provider,
    authMethod: row.auth_method,
    accountLogin: row.account_login,
    accountAvatarUrl: row.account_avatar_url,
    status: row.status,
    scopes: row.scopes ?? [],
    connectedAt: row.created_at,
  };
}

export async function findIntegration(
  workspaceId: string,
  userId: string,
  provider: GitProvider,
): Promise<GitIntegrationRow | null> {
  const res = await query<GitIntegrationRow>(
    `SELECT *
         FROM ${SCHEMA}.git_integrations
         WHERE workspace_id = $1 AND user_id = $2 AND provider = $3
         LIMIT 1`,
    [workspaceId, userId, provider],
  );
  return res.rows[0] ?? null;
}

export async function getStatusForUser(
  workspaceId: string,
  userId: string,
): Promise<{
  onework: GitIntegrationAccount | null;
  github: GitIntegrationAccount | null;
  gitlab: GitIntegrationAccount | null;
}> {
  const res = await query<GitIntegrationRow>(
    `SELECT * FROM ${SCHEMA}.git_integrations
         WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  let onework: GitIntegrationAccount | null = null;
  let github: GitIntegrationAccount | null = null;
  let gitlab: GitIntegrationAccount | null = null;
  for (const row of res.rows) {
    if (row.provider === "onework") onework = rowToPublic(row);
    if (row.provider === "github") github = rowToPublic(row);
    if (row.provider === "gitlab") gitlab = rowToPublic(row);
  }
  return { onework, github, gitlab };
}

export async function upsertIntegration(params: {
  workspaceId: string;
  userId: string;
  provider: GitProvider;
  authMethod: "oauth" | "pat" | "platform";
  accountLogin: string;
  accountId: string;
  accountAvatarUrl: string | null;
  scopes: string[];
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}): Promise<GitIntegrationRow> {
  const enc = encryptGitToken(params.accessToken);
  const encRefresh = params.refreshToken
    ? encryptGitToken(params.refreshToken)
    : null;
  const res = await query<GitIntegrationRow>(
    `INSERT INTO ${SCHEMA}.git_integrations (
            workspace_id, user_id, provider, auth_method, account_login, account_id,
            account_avatar_url, scopes, encrypted_token, encrypted_refresh, token_expires_at,
            status, last_used_at, updated_at
        ) VALUES (
            $1, $2, $3::text, $4::text, $5, $6, $7, $8::text[], $9, $10, $11,
            'connected', NOW(), NOW()
        )
        ON CONFLICT (workspace_id, user_id, provider) DO UPDATE SET
            auth_method = EXCLUDED.auth_method,
            account_login = EXCLUDED.account_login,
            account_id = EXCLUDED.account_id,
            account_avatar_url = EXCLUDED.account_avatar_url,
            scopes = EXCLUDED.scopes,
            encrypted_token = EXCLUDED.encrypted_token,
            encrypted_refresh = EXCLUDED.encrypted_refresh,
            token_expires_at = EXCLUDED.token_expires_at,
            status = 'connected',
            last_used_at = NOW(),
            updated_at = NOW()
        RETURNING *`,
    [
      params.workspaceId,
      params.userId,
      params.provider,
      params.authMethod,
      params.accountLogin,
      params.accountId,
      params.accountAvatarUrl,
      params.scopes,
      enc,
      encRefresh,
      params.tokenExpiresAt?.toISOString() ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to upsert git integration");
  return row;
}

export async function deleteIntegration(
  workspaceId: string,
  userId: string,
  provider: GitProvider,
): Promise<boolean> {
  await deleteLinkedReposForUserProvider(workspaceId, userId, provider);
  const res = await query(
    `DELETE FROM ${SCHEMA}.git_integrations
         WHERE workspace_id = $1 AND user_id = $2 AND provider = $3`,
    [workspaceId, userId, provider],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getAccessTokenForIntegration(
  row: GitIntegrationRow,
): Promise<string> {
  return decryptGitToken(row.encrypted_token);
}

export async function bumpLastUsed(integrationId: string): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.git_integrations SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [integrationId],
  ).catch(() => {});
}
