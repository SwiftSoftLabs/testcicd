import { randomBytes } from "crypto";

import { query, SCHEMA } from "@/lib/db";

import {
  buildCloneUrls,
  buildGiteaUsername,
  buildOrgName,
  giteaAddOrgMember,
  giteaAddRepoCollaborator,
  giteaCreateOrg,
  giteaCreateOrgRepo,
  giteaCreateUser,
  giteaEnsureOrgWebhook,
  giteaEnsureUserApiToken,
  giteaFetchViewerLogin,
  getOneworkVcAdminToken,
} from "./gitea-admin";
import { UpstreamError } from "./errors";
import { isOneworkVcConfigured } from "./onework";
import { isSameVcLogin } from "./pr-reviews";
import { upsertPlatformRepo } from "./platform-repos-repository";
import {
  findIntegration,
  getAccessTokenForIntegration,
  upsertIntegration,
} from "./repository";
import {
  isRepoCollaboratorExcluded,
} from "./collaborator-exclusions";

export type ProvisioningResult =
  | { ok: true }
  | { ok: false; error: string };

function formatUnknownError(error: unknown): string {
  if (error instanceof UpstreamError) {
    const detail = error.message.trim();
    return detail
      ? `Gitea API error (${error.status}): ${detail}`
      : `Gitea API error (${error.status})`;
  }
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code =
      typeof (cause as NodeJS.ErrnoException).code === "string"
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
  } else if (cause != null) {
    parts.push(String(cause));
  }
  return parts.join(" — ");
}

function logProvisionError(context: string, error: unknown): void {
  console.error(`[onework-vc] ${context}:`, formatUnknownError(error));
}

async function registerOneworkOrgWebhookIfConfigured(
  orgName: string,
): Promise<void> {
  const secret = process.env.ONEWORK_VC_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!secret || !appUrl) return;
  try {
    await giteaEnsureOrgWebhook({
      orgName,
      webhookUrl: `${appUrl}/api/integrations/git/onework/webhooks`,
      secret,
    });
  } catch (e) {
    logProvisionError("registerOneworkOrgWebhookIfConfigured", e);
  }
}

export async function ensureOneworkWorkspaceOrg(params: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}): Promise<ProvisioningResult> {
  if (!isOneworkVcConfigured()) return { ok: false, error: "not_configured" };

  try {
    const existing = await query<{ gitea_org_name: string }>(
      `SELECT gitea_org_name FROM ${SCHEMA}.onework_vc_workspaces WHERE workspace_id = $1`,
      [params.workspaceId],
    );
    if (existing.rows[0]) {
      await registerOneworkOrgWebhookIfConfigured(
        existing.rows[0].gitea_org_name,
      );
      return { ok: true };
    }

    const orgName = buildOrgName(params.workspaceSlug);
    await giteaCreateOrg({
      name: orgName,
      fullName: params.workspaceName,
    });

    await query(
      `INSERT INTO ${SCHEMA}.onework_vc_workspaces (workspace_id, gitea_org_name)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [params.workspaceId, orgName],
    );
    await registerOneworkOrgWebhookIfConfigured(orgName);
    return { ok: true };
  } catch (e) {
    logProvisionError("ensureOneworkWorkspaceOrg", e);
    return { ok: false, error: formatUnknownError(e) || "provision_failed" };
  }
}

/** Ensure every workspace member is provisioned and added as a repo collaborator. */
export async function syncOneworkWorkspaceMembersToRepo(params: {
  workspaceId: string;
  owner: string;
  repo: string;
}): Promise<void> {
  if (!isOneworkVcConfigured()) return;

  const members = await query<{
    user_id: string;
    email: string;
    full_name: string | null;
  }>(
    `SELECT wm.user_id, p.email, p.full_name
     FROM ${SCHEMA}.workspace_members wm
     JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
     WHERE wm.workspace_id = $1`,
    [params.workspaceId],
  );

  for (const row of members.rows) {
    if (!row.email) continue;
    try {
      const result = await ensureOneworkMemberIntegration({
        workspaceId: params.workspaceId,
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name || row.email.split("@")[0] || "OneWork User",
      });
      if (!result.ok) continue;

      const account = await query<{ gitea_username: string }>(
        `SELECT gitea_username FROM ${SCHEMA}.onework_vc_accounts WHERE user_id = $1`,
        [row.user_id],
      );
      const username = account.rows[0]?.gitea_username;
      if (!username) continue;

      const excluded = await isRepoCollaboratorExcluded({
        workspaceId: params.workspaceId,
        owner: params.owner,
        repo: params.repo,
        giteaUsername: username,
      });
      if (excluded) continue;

      await giteaAddRepoCollaborator(
        params.owner,
        params.repo,
        username,
        "write",
      );
    } catch (e) {
      logProvisionError("syncOneworkWorkspaceMembersToRepo", e);
    }
  }
}

async function syncOneworkMemberToWorkspaceRepos(
  workspaceId: string,
  giteaUsername: string,
): Promise<void> {
  if (!isOneworkVcConfigured()) return;

  const repos = await query<{ repo_owner: string; repo_name: string }>(
    `SELECT repo_owner, repo_name FROM ${SCHEMA}.git_project_platform_repos WHERE workspace_id = $1`,
    [workspaceId],
  );

  for (const row of repos.rows) {
    try {
      const excluded = await isRepoCollaboratorExcluded({
        workspaceId,
        owner: row.repo_owner,
        repo: row.repo_name,
        giteaUsername,
      });
      if (excluded) continue;

      await giteaAddRepoCollaborator(
        row.repo_owner,
        row.repo_name,
        giteaUsername,
        "write",
      );
    } catch (e) {
      logProvisionError("syncOneworkMemberToWorkspaceRepos", e);
    }
  }
}

export async function ensureOneworkGiteaUser(params: {
  userId: string;
  email: string;
  fullName: string;
}): Promise<{ giteaUserId: number; giteaUsername: string } | null> {
  if (!isOneworkVcConfigured()) return null;

  const existing = await query<{
    gitea_user_id: number;
    gitea_username: string;
  }>(
    `SELECT gitea_user_id, gitea_username FROM ${SCHEMA}.onework_vc_accounts WHERE user_id = $1`,
    [params.userId],
  );
  if (existing.rows[0]) {
    return {
      giteaUserId: existing.rows[0].gitea_user_id,
      giteaUsername: existing.rows[0].gitea_username,
    };
  }

  const username = buildGiteaUsername(params.userId, params.email);
  const password = randomBytes(24).toString("base64url");
  const user = await giteaCreateUser({
    username,
    email: params.email,
    fullName: params.fullName || username,
    password,
  });

  await query(
    `INSERT INTO ${SCHEMA}.onework_vc_accounts (user_id, gitea_user_id, gitea_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [params.userId, user.id, user.login],
  );

  return { giteaUserId: user.id, giteaUsername: user.login };
}

function oneworkApiTokenName(userId: string): string {
  return `onework-api-${userId.replace(/-/g, "").slice(0, 8)}`;
}

async function ensureOneworkIntegrationUserToken(params: {
  workspaceId: string;
  userId: string;
  giteaUsername: string;
  giteaUserId: number;
}): Promise<void> {
  const existing = await findIntegration(
    params.workspaceId,
    params.userId,
    "onework",
  );

  if (existing) {
    const currentToken = await getAccessTokenForIntegration(existing);
    let stale = false;
    try {
      if (currentToken === getOneworkVcAdminToken()) stale = true;
    } catch {
      /* admin token env not set */
    }
    if (!stale) {
      const viewerLogin = await giteaFetchViewerLogin(currentToken);
      if (
        isSameVcLogin(viewerLogin, params.giteaUsername) &&
        isSameVcLogin(existing.account_login, params.giteaUsername)
      ) {
        return;
      }
    }
  }

  const token = await giteaEnsureUserApiToken(
    params.giteaUsername,
    oneworkApiTokenName(params.userId),
  );

  await upsertIntegration({
    workspaceId: params.workspaceId,
    userId: params.userId,
    provider: "onework",
    authMethod: "platform",
    accountLogin: params.giteaUsername,
    accountId: String(params.giteaUserId),
    accountAvatarUrl: null,
    scopes: ["all"],
    accessToken: token,
    refreshToken: null,
    tokenExpiresAt: null,
  });
}

export async function ensureOneworkMemberIntegration(params: {
  workspaceId: string;
  userId: string;
  email: string;
  fullName: string;
}): Promise<ProvisioningResult> {
  if (!isOneworkVcConfigured()) return { ok: false, error: "not_configured" };

  try {
    const ws = await query<{ slug: string; name: string }>(
      `SELECT slug, name FROM ${SCHEMA}.workspaces WHERE id = $1`,
      [params.workspaceId],
    );
    const workspace = ws.rows[0];
    if (!workspace) return { ok: false, error: "workspace_not_found" };

    const orgResult = await ensureOneworkWorkspaceOrg({
      workspaceId: params.workspaceId,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
    });
    if (!orgResult.ok) return orgResult;

    const giteaUser = await ensureOneworkGiteaUser({
      userId: params.userId,
      email: params.email,
      fullName: params.fullName,
    });
    if (!giteaUser) return { ok: false, error: "user_provision_failed" };

    const orgRow = await query<{ gitea_org_name: string }>(
      `SELECT gitea_org_name FROM ${SCHEMA}.onework_vc_workspaces WHERE workspace_id = $1`,
      [params.workspaceId],
    );
    const orgName = orgRow.rows[0]?.gitea_org_name;
    if (!orgName) return { ok: false, error: "org_not_found" };

    await giteaAddOrgMember(orgName, giteaUser.giteaUsername);
    await syncOneworkMemberToWorkspaceRepos(
      params.workspaceId,
      giteaUser.giteaUsername,
    );

    await ensureOneworkIntegrationUserToken({
      workspaceId: params.workspaceId,
      userId: params.userId,
      giteaUsername: giteaUser.giteaUsername,
      giteaUserId: giteaUser.giteaUserId,
    });

    return { ok: true };
  } catch (e) {
    logProvisionError("ensureOneworkMemberIntegration", e);
    return { ok: false, error: formatUnknownError(e) || "provision_failed" };
  }
}

export async function ensureOneworkProjectRepo(params: {
  workspaceId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
}): Promise<ProvisioningResult> {
  if (!isOneworkVcConfigured()) return { ok: false, error: "not_configured" };

  try {
    const existing = await query<{ project_id: string }>(
      `SELECT project_id FROM ${SCHEMA}.git_project_platform_repos WHERE project_id = $1`,
      [params.projectId],
    );
    if (existing.rows[0]) return { ok: true };

    const orgRow = await query<{ gitea_org_name: string }>(
      `SELECT gitea_org_name FROM ${SCHEMA}.onework_vc_workspaces WHERE workspace_id = $1`,
      [params.workspaceId],
    );
    let orgName = orgRow.rows[0]?.gitea_org_name;
    if (!orgName) {
      const ws = await query<{ slug: string; name: string }>(
        `SELECT slug, name FROM ${SCHEMA}.workspaces WHERE id = $1`,
        [params.workspaceId],
      );
      const workspace = ws.rows[0];
      if (!workspace) return { ok: false, error: "workspace_not_found" };
      const orgResult = await ensureOneworkWorkspaceOrg({
        workspaceId: params.workspaceId,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
      });
      if (!orgResult.ok) return orgResult;
      const refetch = await query<{ gitea_org_name: string }>(
        `SELECT gitea_org_name FROM ${SCHEMA}.onework_vc_workspaces WHERE workspace_id = $1`,
        [params.workspaceId],
      );
      orgName = refetch.rows[0]?.gitea_org_name;
    }
    if (!orgName) return { ok: false, error: "org_not_found" };

    const repoName = params.projectKey.toLowerCase();
    const giteaRepo = await giteaCreateOrgRepo({
      orgName,
      repoName,
      description: params.projectName,
      autoInit: true,
    });

    const urls = buildCloneUrls(orgName, giteaRepo.name);
  const sshPort = process.env.ONEWORK_VC_GIT_SSH_PORT?.trim() || "2222";
  const sshHost =
    process.env.ONEWORK_VC_GIT_SSH_HOST?.trim() ||
    new URL(process.env.ONEWORK_VC_GITEA_URL!.trim()).hostname;
  const sshUrl = `ssh://git@${sshHost}:${sshPort}/${orgName}/${giteaRepo.name}.git`;

    await upsertPlatformRepo({
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      repoExternalId: String(giteaRepo.id),
      repoFullName: giteaRepo.fullName,
      repoOwner: orgName,
      repoName: giteaRepo.name,
      defaultBranch: giteaRepo.defaultBranch,
      isPrivate: giteaRepo.private,
      htmlUrl: urls.htmlUrl,
      cloneUrl: urls.cloneUrl,
      sshUrl,
      description: params.projectName,
    });

    await registerOneworkOrgWebhookIfConfigured(orgName);
    await syncOneworkWorkspaceMembersToRepo({
      workspaceId: params.workspaceId,
      owner: orgName,
      repo: giteaRepo.name,
    });

    return { ok: true };
  } catch (e) {
    logProvisionError("ensureOneworkProjectRepo", e);
    return { ok: false, error: formatUnknownError(e) || "provision_failed" };
  }
}

/** Lazy safety net when loading git integration status. */
export async function provisionOneworkForMemberIfNeeded(params: {
  workspaceId: string;
  userId: string;
}): Promise<ProvisioningResult> {
  if (!isOneworkVcConfigured()) return { ok: false, error: "not_configured" };

  const profile = await query<{ email: string; full_name: string | null }>(
    `SELECT email, full_name FROM ${SCHEMA}.profiles WHERE id = $1`,
    [params.userId],
  );
  const row = profile.rows[0];
  if (!row?.email) return { ok: false, error: "profile_not_found" };

  return ensureOneworkMemberIntegration({
    workspaceId: params.workspaceId,
    userId: params.userId,
    email: row.email,
    fullName: row.full_name || row.email.split("@")[0] || "OneWork User",
  });
}
