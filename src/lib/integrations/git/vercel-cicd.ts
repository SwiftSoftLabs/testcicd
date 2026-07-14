import { createHmac, timingSafeEqual } from "crypto";

import { query, SCHEMA } from "@/lib/db";
import { getAppOrigin } from "@/lib/integrations/git/oauth";
import { giteaEnsureRepoDeployToken } from "@/lib/integrations/git/gitea-admin";
import {
  type GiteaCommitStatusState,
  postGiteaCommitStatus,
} from "@/lib/integrations/git/gitea-commit-status";
import {
  deleteVercelDeploymentLink,
  getEnabledVercelDeploymentLinkForRepo,
  getVercelDeploymentLinkForRepo,
  upsertVercelDeploymentLink,
  type GitRepoVercelDeploymentRow,
} from "@/lib/integrations/git/git-repo-vercel-deployments-repository";
import { getPlatformRepoForProject } from "@/lib/integrations/git/platform-repos-repository";
import { notifyWorkspaceVcEvent } from "@/lib/integrations/git/vc-notifications";
import {
  createVercelDeployment,
  ensureVercelProject,
  createVercelWebhook,
  deleteVercelWebhook,
  listVercelDeployments,
  upsertVercelEnvVar,
  type VercelEnvTarget,
} from "@/lib/integrations/vercel/client";
import { decryptVercelToken, encryptVercelToken } from "@/lib/integrations/vercel/crypto";
import type { VercelIntegrationRow } from "@/lib/integrations/vercel/types";
import { getProjectDek } from "@/lib/vault/keys";
import { decryptValue } from "@/lib/vault/crypto";
import type { VaultVariableRow } from "@/types/vault";
import type {
  GitRepoVercelDeploymentItem,
  GitRepoVercelDeploymentStatus,
} from "@/types/git";

const SYSTEM_VAULT_ENVS: Array<{
  name: string;
  vercelTargets: VercelEnvTarget[];
}> = [
  { name: "development", vercelTargets: ["development"] },
  { name: "preview", vercelTargets: ["preview"] },
  { name: "production", vercelTargets: ["production"] },
];

function giteaHostFromEnv(): string {
  const raw = process.env.ONEWORK_VC_GITEA_URL?.trim();
  if (!raw) throw new Error("ONEWORK_VC_GITEA_URL is not configured");
  return new URL(raw).host;
}

function gitCredentialsValue(token: string, host: string): string {
  return `https://${token}:x-oauth-basic@${host}`;
}

async function loadWorkspaceVercelIntegration(
  workspaceId: string,
): Promise<VercelIntegrationRow> {
  const result = await query<VercelIntegrationRow>(
    `SELECT * FROM ${SCHEMA}.vercel_integrations
     WHERE workspace_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      "Vercel is not connected. Connect Vercel in Settings → Plugins.",
    );
  }
  return row;
}

async function syncAllVaultEnvsToVercelProject(params: {
  projectId: string;
  workspaceId: string;
  vercelProjectId: string;
  accessToken: string;
  teamId: string;
  gitCredentials?: string;
}): Promise<{ pushed: number; failed: string[] }> {
  const envRows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM ${SCHEMA}.vault_environments
     WHERE project_id = $1 AND is_system = true
     ORDER BY name ASC`,
    [params.projectId],
  );

  const dek = await getProjectDek(params.projectId);
  let pushed = 0;
  const failed: string[] = [];

  for (const mapping of SYSTEM_VAULT_ENVS) {
    const env = envRows.rows.find(
      (row) => row.name.toLowerCase() === mapping.name,
    );
    if (!env) continue;

    const varResult = await query<
      Pick<VaultVariableRow, "name" | "ciphertext" | "iv" | "auth_tag">
    >(
      `SELECT name, ciphertext, iv, auth_tag
       FROM ${SCHEMA}.vault_variables
       WHERE project_id = $1 AND environment_id = $2
       ORDER BY name ASC`,
      [params.projectId, env.id],
    );

    for (const variable of varResult.rows) {
      try {
        const plaintext = decryptValue(
          {
            ciphertext: variable.ciphertext,
            iv: variable.iv,
            authTag: variable.auth_tag,
          },
          dek,
        );
        await upsertVercelEnvVar(
          params.accessToken,
          params.teamId,
          params.vercelProjectId,
          variable.name,
          plaintext,
          mapping.vercelTargets,
        );
        pushed += 1;
      } catch (err) {
        failed.push(
          `${mapping.name}/${variable.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (params.gitCredentials) {
    for (const targets of [
      ["production", "preview"] as VercelEnvTarget[],
    ]) {
      try {
        await upsertVercelEnvVar(
          params.accessToken,
          params.teamId,
          params.vercelProjectId,
          "GIT_CREDENTIALS",
          params.gitCredentials,
          targets,
        );
        pushed += 1;
      } catch (err) {
        failed.push(
          `GIT_CREDENTIALS: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return { pushed, failed };
}

function sanitizeVercelProjectName(input: string, fallback: string): string {
  const base = (input.trim() || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base || "onework-project";
}

export async function setupOneworkVcVercelCicd(params: {
  projectId: string;
  workspaceId: string;
  actorId: string;
  productionBranch?: string;
  vercelProjectName?: string;
  vercelProjectId?: string;
}): Promise<GitRepoVercelDeploymentRow> {
  const platformRepo = await getPlatformRepoForProject(params.projectId);
  if (!platformRepo) {
    throw new Error("No OneWork Version Control repository found for this project.");
  }

  const integration = await loadWorkspaceVercelIntegration(params.workspaceId);
  const accessToken = decryptVercelToken(integration.access_token_enc);
  const teamId = integration.target_id;

  const productionBranch =
    params.productionBranch?.trim() || platformRepo.defaultBranch || "main";

  let vercelProjectId = params.vercelProjectId?.trim() || "";
  let vercelProjectName = params.vercelProjectName?.trim() || "";

  if (!vercelProjectId) {
    const projectName = sanitizeVercelProjectName(
      vercelProjectName,
      `${platformRepo.name}-onework`,
    );
    const created = await ensureVercelProject(accessToken, teamId, projectName);
    vercelProjectId = created.id;
    vercelProjectName = created.name;
  } else if (!vercelProjectName) {
    vercelProjectName = sanitizeVercelProjectName(
      platformRepo.name,
      "onework-project",
    );
  }

  const deployToken = await giteaEnsureRepoDeployToken(
    platformRepo.owner,
    platformRepo.name,
  );
  const giteaHost = giteaHostFromEnv();
  const gitCredentials = gitCredentialsValue(deployToken, giteaHost);

  const vaultSync = await syncAllVaultEnvsToVercelProject({
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    vercelProjectId,
    accessToken,
    teamId,
    gitCredentials,
  });

  if (vaultSync.failed.length > 0) {
    console.warn("[vercel-cicd setup] vault sync partial failures:", vaultSync.failed);
  }

  const callbackUrl = `${getAppOrigin()}/api/integrations/vercel/webhooks`;
  // Integration OAuth tokens cannot create account webhooks via REST (403).
  // Configure the same URL once in Vercel Integration Console → Webhooks.
  let webhookId: string | null = null;
  try {
    const webhook = await createVercelWebhook(accessToken, teamId, callbackUrl);
    webhookId = webhook.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(403)")) {
      console.warn(
        `[vercel-cicd] Skipping API webhook create (integration tokens lack permission). ` +
          `Configure deployment webhooks in the Vercel Integration Console → ${callbackUrl}`,
      );
    } else {
      console.warn("[vercel-cicd] Webhook create failed; continuing without it:", message);
    }
  }

  return upsertVercelDeploymentLink({
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    repoOwner: platformRepo.owner,
    repoName: platformRepo.name,
    repoFullName: platformRepo.fullName,
    vercelProjectId,
    vercelProjectName,
    productionBranch,
    giteaDeployTokenEnc: encryptVercelToken(deployToken),
    vercelWebhookId: webhookId,
    createdBy: params.actorId,
  });
}

export async function teardownOneworkVcVercelCicd(params: {
  projectId: string;
  workspaceId: string;
  repoFullName: string;
}): Promise<void> {
  const row = await deleteVercelDeploymentLink(
    params.projectId,
    params.repoFullName,
  );
  if (!row) return;

  try {
    const integration = await loadWorkspaceVercelIntegration(params.workspaceId);
    const accessToken = decryptVercelToken(integration.access_token_enc);
    const teamId = integration.target_id;
    if (row.vercel_webhook_id) {
      await deleteVercelWebhook(accessToken, teamId, row.vercel_webhook_id);
    }
  } catch (err) {
    console.error("[vercel-cicd teardown]", err);
  }
}

function deploymentTargetForBranch(
  branch: string,
  productionBranch: string,
): "production" | "preview" | undefined {
  return branch === productionBranch ? "production" : "preview";
}

export async function triggerVercelDeployForLink(params: {
  link: GitRepoVercelDeploymentRow;
  branch: string;
  sha: string;
}): Promise<{ deploymentId: string; url: string | null }> {
  const integration = await loadWorkspaceVercelIntegration(params.link.workspace_id);
  const accessToken = decryptVercelToken(integration.access_token_enc);
  const teamId = integration.target_id;
  const host = giteaHostFromEnv();
  const target = deploymentTargetForBranch(
    params.branch,
    params.link.production_branch,
  );

  const deployment = await createVercelDeployment(
    accessToken,
    teamId,
    params.link.vercel_project_id,
    params.link.vercel_project_name,
    {
      type: "github-custom-host",
      host,
      org: params.link.repo_owner,
      repo: params.link.repo_name,
      ref: params.branch,
      sha: params.sha,
    },
    target,
  );

  await postGiteaCommitStatus({
    owner: params.link.repo_owner,
    repo: params.link.repo_name,
    sha: params.sha,
    state: "pending",
    context: "Vercel",
    description: `Deploying ${params.branch} to Vercel…`,
    targetUrl: deployment.url,
  });

  return { deploymentId: deployment.id, url: deployment.url };
}

export async function triggerDeployOnPush(payload: Record<string, unknown>): Promise<void> {
  const after = typeof payload.after === "string" ? payload.after : "";
  if (!after || /^0+$/.test(after)) return;

  const ref = typeof payload.ref === "string" ? payload.ref : "";
  if (!ref.startsWith("refs/heads/")) return;
  const branch = ref.replace("refs/heads/", "");

  const repository = payload.repository as
    | { full_name?: string; owner?: { login?: string }; name?: string }
    | undefined;
  const fullName =
    repository?.full_name ??
    (repository?.owner?.login && repository?.name
      ? `${repository.owner.login}/${repository.name}`
      : null);
  if (!fullName) return;

  const platformRes = await query<{ project_id: string }>(
    `SELECT project_id FROM ${SCHEMA}.git_project_platform_repos
     WHERE repo_full_name = $1
     LIMIT 1`,
    [fullName],
  );
  const projectId = platformRes.rows[0]?.project_id;
  if (!projectId) return;

  const link = await getEnabledVercelDeploymentLinkForRepo(projectId, fullName);
  if (!link?.enabled) return;

  await triggerVercelDeployForLink({
    link,
    branch,
    sha: after,
  });
}

function vercelWebhookSecret(): string {
  const dedicated = process.env.VERCEL_WEBHOOK_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback = process.env.VERCEL_CLIENT_SECRET?.trim();
  if (!fallback) {
    throw new Error("VERCEL_WEBHOOK_SECRET or VERCEL_CLIENT_SECRET is required");
  }
  return fallback;
}

export function verifyVercelWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha1", vercelWebhookSecret())
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.trim();
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function mapVercelEventToGiteaState(eventType: string): GiteaCommitStatusState | null {
  if (eventType === "deployment.created") return "pending";
  if (eventType === "deployment.succeeded") return "success";
  if (eventType === "deployment.error") return "failure";
  if (eventType === "deployment.canceled") return "error";
  return null;
}

export async function handleVercelDeploymentWebhook(
  eventType: string,
  envelope: Record<string, unknown>,
): Promise<void> {
  const state = mapVercelEventToGiteaState(eventType);
  if (!state) return;

  const payload =
    envelope.payload && typeof envelope.payload === "object"
      ? (envelope.payload as Record<string, unknown>)
      : envelope;

  const deployment =
    payload.deployment && typeof payload.deployment === "object"
      ? (payload.deployment as Record<string, unknown>)
      : payload;

  const project =
    payload.project && typeof payload.project === "object"
      ? (payload.project as Record<string, unknown>)
      : null;

  const projectId =
    (typeof project?.id === "string" ? project.id : null) ??
    (typeof payload.projectId === "string" ? payload.projectId : null) ??
    (typeof deployment.projectId === "string" ? deployment.projectId : null);
  if (!projectId) return;

  const link = await query<GitRepoVercelDeploymentRow>(
    `SELECT * FROM ${SCHEMA}.git_repo_vercel_deployments
     WHERE vercel_project_id = $1 AND enabled = true
     LIMIT 1`,
    [projectId],
  ).then((res) => res.rows[0] ?? null);

  if (!link) return;

  const meta =
    deployment.meta && typeof deployment.meta === "object"
      ? (deployment.meta as Record<string, string>)
      : {};

  const sha =
    meta.githubCommitSha ??
    meta.gitCommitSha ??
    meta.gitlabCommitSha ??
    "";
  if (!sha) return;

  const deploymentUrlRaw =
    typeof deployment.url === "string" ? deployment.url : null;
  const deploymentUrl = deploymentUrlRaw
    ? deploymentUrlRaw.startsWith("http")
      ? deploymentUrlRaw
      : `https://${deploymentUrlRaw}`
    : null;

  const description =
    state === "pending"
      ? "Vercel deployment in progress"
      : state === "success"
        ? "Vercel deployment succeeded"
        : state === "failure"
          ? "Vercel deployment failed"
          : "Vercel deployment canceled";

  await postGiteaCommitStatus({
    owner: link.repo_owner,
    repo: link.repo_name,
    sha,
    state,
    context: "Vercel",
    description,
    targetUrl: deploymentUrl,
  });

  const deploymentId =
    typeof deployment.id === "string" ? deployment.id : undefined;

  if (state === "success" || state === "failure" || state === "error") {
    await notifyWorkspaceVcEvent({
      workspaceId: link.workspace_id,
      projectId: link.project_id,
      type: "vc_check",
      title: `Vercel ${state}: ${link.repo_full_name}`,
      content: description,
      extra: `vercel:${deploymentId ?? sha}:${state}`,
    });
  }
}

export async function getVercelDeploymentStatus(params: {
  projectId: string;
  workspaceId: string;
  owner: string;
  repo: string;
}): Promise<GitRepoVercelDeploymentStatus> {
  const fullName = `${params.owner}/${params.repo}`;
  const linkRow = await getVercelDeploymentLinkForRepo(params.projectId, fullName);

  let vercelConnected = false;
  try {
    await loadWorkspaceVercelIntegration(params.workspaceId);
    vercelConnected = true;
  } catch {
    vercelConnected = false;
  }

  if (!linkRow) {
    return {
      configured: false,
      vercelConnected,
      link: null,
      recentDeployments: [],
    };
  }

  let recentDeployments: GitRepoVercelDeploymentItem[] = [];
  if (vercelConnected) {
    try {
      const integration = await loadWorkspaceVercelIntegration(params.workspaceId);
      const accessToken = decryptVercelToken(integration.access_token_enc);
      const deployments = await listVercelDeployments(
        accessToken,
        integration.target_id,
        linkRow.vercel_project_id,
        5,
      );
      recentDeployments = deployments.map((d) => ({
        id: d.id,
        url: d.url,
        state: d.state,
        target: d.target,
        branch:
          d.meta?.githubCommitRef ??
          d.meta?.gitCommitRef ??
          null,
        sha:
          d.meta?.githubCommitSha ??
          d.meta?.gitCommitSha ??
          null,
        createdAt: new Date(d.createdAt).toISOString(),
      }));
    } catch (err) {
      console.error("[vercel-cicd status]", err);
    }
  }

  return {
    configured: true,
    vercelConnected,
    link: {
      id: linkRow.id,
      project_id: linkRow.project_id,
      workspace_id: linkRow.workspace_id,
      git_provider: linkRow.git_provider,
      repo_owner: linkRow.repo_owner,
      repo_name: linkRow.repo_name,
      repo_full_name: linkRow.repo_full_name,
      vercel_project_id: linkRow.vercel_project_id,
      vercel_project_name: linkRow.vercel_project_name,
      production_branch: linkRow.production_branch,
      enabled: linkRow.enabled,
      created_at: linkRow.created_at,
      updated_at: linkRow.updated_at,
    },
    recentDeployments,
  };
}
