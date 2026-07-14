/**
 * Internal Gitea Admin API helpers (server-only; never user-facing).
 */
import { z } from "zod";

import { UpstreamError } from "./errors";
import { isOneworkVcConfigured } from "./onework";

function giteaBase(): string {
  const raw = process.env.ONEWORK_VC_GITEA_URL?.trim();
  if (!raw) throw new Error("ONEWORK_VC_GITEA_URL is not configured");
  return raw.replace(/\/$/, "");
}

export function getOneworkVcAdminToken(): string {
  const t = process.env.ONEWORK_VC_ADMIN_TOKEN?.trim();
  if (!t) throw new Error("ONEWORK_VC_ADMIN_TOKEN is not configured");
  return t;
}

function getOneworkVcAdminPassword(): string {
  const password = process.env.ONEWORK_VC_ADMIN_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "ONEWORK_VC_ADMIN_PASSWORD is required to provision per-user Gitea API tokens",
    );
  }
  return password;
}

let cachedAdminLogin: string | null = null;

async function resolveAdminLogin(): Promise<string> {
  const configured = process.env.ONEWORK_VC_ADMIN_USERNAME?.trim();
  if (configured) return configured;
  if (cachedAdminLogin) return cachedAdminLogin;
  const login = await giteaFetchViewerLogin(getOneworkVcAdminToken());
  if (!login) {
    throw new Error(
      "Failed to resolve Gitea admin login; set ONEWORK_VC_ADMIN_USERNAME",
    );
  }
  cachedAdminLogin = login;
  return login;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function adminToken(): string {
  return getOneworkVcAdminToken();
}

function formatFetchFailure(url: string, error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Gitea request failed (${url}): ${String(error)}`);
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeMsg =
    cause instanceof Error
      ? (() => {
          const code =
            typeof (cause as NodeJS.ErrnoException).code === "string"
              ? (cause as NodeJS.ErrnoException).code
              : undefined;
          return code ? `${cause.message} (${code})` : cause.message;
        })()
      : cause != null
        ? String(cause)
        : undefined;
  const detail = causeMsg
    ? `${error.message}: ${causeMsg}`
    : error.message;
  return new Error(`Gitea request failed (${url}): ${detail}`);
}

export async function adminFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `${giteaBase()}/api/v1${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `token ${adminToken()}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw formatFetchFailure(url, error);
  }
}

export async function giteaJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(text || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function sanitizeGiteaName(input: string, maxLen = 40): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = s.slice(0, maxLen) || "ow";
  return trimmed;
}

export function buildOrgName(workspaceSlug: string): string {
  return `ow-${sanitizeGiteaName(workspaceSlug, 30)}`;
}

export function buildGiteaUsername(userId: string, email: string): string {
  const prefix = email.split("@")[0] || "user";
  const idPart = userId.replace(/-/g, "").slice(0, 8);
  return sanitizeGiteaName(`${prefix}-${idPart}`, 35);
}

export function buildCloneUrls(owner: string, repo: string): {
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
} {
  const base = giteaBase();
  const sshHost =
    process.env.ONEWORK_VC_GIT_SSH_HOST?.trim() || new URL(base).hostname;
  const sshPort = process.env.ONEWORK_VC_GIT_SSH_PORT?.trim() || "2222";
  const full = `${owner}/${repo}`;
  return {
    htmlUrl: `${base}/${full}`,
    cloneUrl: `${base}/${full}.git`,
    sshUrl: `git@${sshHost}:${full}.git`,
  };
}

export async function giteaCreateOrg(params: {
  name: string;
  fullName: string;
}): Promise<{ id: number; username: string }> {
  if (!isOneworkVcConfigured()) {
    throw new Error("OneWork Version Control is not configured");
  }
  const res = await adminFetch("/orgs", {
    method: "POST",
    body: JSON.stringify({
      username: params.name,
      full_name: params.fullName,
      visibility: "private",
    }),
  });
  if (res.status === 422) {
    const existing = await adminFetch(`/orgs/${encodeURIComponent(params.name)}`);
    if (existing.ok) {
      const org = z
        .object({ id: z.number(), username: z.string() })
        .parse(await existing.json());
      return { id: org.id, username: org.username };
    }
  }
  const org = z
    .object({ id: z.number(), username: z.string() })
    .parse(await giteaJsonOrThrow(res));
  return { id: org.id, username: org.username };
}

export async function giteaCreateUser(params: {
  username: string;
  email: string;
  fullName: string;
  password: string;
}): Promise<{ id: number; login: string }> {
  const res = await adminFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: params.username,
      email: params.email,
      full_name: params.fullName,
      password: params.password,
      must_change_password: false,
      send_notify: false,
    }),
  });
  if (res.status === 422 || res.status === 409) {
    const lookup = await adminFetch(
      `/users/${encodeURIComponent(params.username)}`,
    );
    if (lookup.ok) {
      const u = z
        .object({ id: z.number(), login: z.string() })
        .parse(await lookup.json());
      return { id: u.id, login: u.login };
    }
  }
  const u = z
    .object({ id: z.number(), login: z.string() })
    .parse(await giteaJsonOrThrow(res));
  return { id: u.id, login: u.login };
}

export async function giteaAddRepoCollaborator(
  owner: string,
  repo: string,
  username: string,
  permission: "read" | "write" | "admin" = "write",
): Promise<void> {
  const res = await adminFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
    {
      method: "PUT",
      body: JSON.stringify({ permission }),
    },
  );
  if (!res.ok && res.status !== 204 && res.status !== 422) {
    const text = await res.text();
    throw new UpstreamError(text || res.statusText, res.status);
  }
}

export async function giteaAddOrgMember(
  orgName: string,
  username: string,
): Promise<void> {
  // Gitea manages org membership through teams — PUT /orgs/{org}/members/{user} is not supported.
  const teamsRes = await adminFetch(
    `/orgs/${encodeURIComponent(orgName)}/teams`,
  );
  if (!teamsRes.ok) {
    const text = await teamsRes.text();
    throw new UpstreamError(text || teamsRes.statusText, teamsRes.status);
  }

  const teams = z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        includes_all_repositories: z.boolean().optional(),
      }),
    )
    .parse(await teamsRes.json());

  const team =
    teams.find((t) => t.name.toLowerCase() === "owners") ??
    teams.find((t) => t.includes_all_repositories) ??
    teams[0];

  if (!team) {
    throw new UpstreamError(
      `No team found for organization ${orgName}`,
      404,
    );
  }

  const res = await adminFetch(
    `/teams/${team.id}/members/${encodeURIComponent(username)}`,
    { method: "PUT" },
  );
  if (!res.ok && res.status !== 204 && res.status !== 422) {
    const text = await res.text();
    throw new UpstreamError(text || res.statusText, res.status);
  }
}

/**
 * Gitea rejects API tokens on /users/:name/tokens (401). Admin must use Basic Auth.
 * @see https://docs.gitea.com/development/api-usage#generating-and-listing-api-tokens
 */
async function adminUserTokenFetch(
  targetUsername: string,
  suffix = "",
  init?: RequestInit,
): Promise<Response> {
  const adminLogin = await resolveAdminLogin();
  const password = getOneworkVcAdminPassword();
  const sudo = encodeURIComponent(targetUsername);
  const path = `/users/${encodeURIComponent(targetUsername)}/tokens${suffix}`;
  const url = `${giteaBase()}/api/v1${path}?sudo=${sudo}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(adminLogin, password),
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw formatFetchFailure(url, error);
  }
}

export async function giteaCreateUserToken(
  username: string,
  name: string,
  scopes: string[] = ["all"],
): Promise<string> {
  const res = await adminUserTokenFetch(username, "", {
    method: "POST",
    body: JSON.stringify({ name, scopes }),
  });
  const data = z
    .object({ sha1: z.string() })
    .parse(await giteaJsonOrThrow(res));
  return data.sha1;
}

/** Read-only token for Vercel to clone a private repo over HTTPS. */
export async function giteaEnsureRepoDeployToken(
  repoOwner: string,
  repoName: string,
): Promise<string> {
  const password = process.env.ONEWORK_VC_ADMIN_PASSWORD?.trim();
  if (password) {
    const tokenName = `onework-vercel-deploy-${repoName}`.slice(0, 50);
    const listRes = await adminUserTokenFetch(repoOwner);
    if (listRes.ok) {
      const tokens = giteaUserTokenListSchema.parse(await listRes.json());
      for (const entry of tokens) {
        if (entry.name !== tokenName) continue;
        await adminUserTokenFetch(repoOwner, `/${entry.id}`, {
          method: "DELETE",
        });
      }
    }
    return giteaCreateUserToken(repoOwner, tokenName, ["read:repository"]);
  }

  // Gitea only allows creating user tokens via Basic Auth (admin password).
  // Fall back to the platform admin API token so CI/CD setup still works in
  // environments where ONEWORK_VC_ADMIN_PASSWORD is not configured.
  console.warn(
    "[onework-vc] ONEWORK_VC_ADMIN_PASSWORD unset — using admin API token for Vercel GIT_CREDENTIALS. Set the password to issue scoped read-only deploy tokens instead.",
  );
  return getOneworkVcAdminToken();
}

const giteaUserTokenListSchema = z.array(
  z.object({ id: z.number(), name: z.string() }),
);

/** Issue or re-issue a stable per-user API token (admin API only). */
export async function giteaEnsureUserApiToken(
  username: string,
  tokenName: string,
): Promise<string> {
  const listRes = await adminUserTokenFetch(username);
  if (listRes.ok) {
    const tokens = giteaUserTokenListSchema.parse(await listRes.json());
    for (const entry of tokens) {
      if (entry.name !== tokenName) continue;
      await adminUserTokenFetch(username, `/${entry.id}`, { method: "DELETE" });
    }
  }
  return giteaCreateUserToken(username, tokenName);
}

export async function giteaFetchViewerLogin(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${giteaBase()}/api/v1/user`, {
      headers: { Authorization: `token ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = z.object({ login: z.string() }).parse(await res.json());
    return data.login.trim() || null;
  } catch {
    return null;
  }
}

export async function giteaEnsureOrgWebhook(params: {
  orgName: string;
  webhookUrl: string;
  secret: string;
}): Promise<void> {
  const listRes = await adminFetch(
    `/orgs/${encodeURIComponent(params.orgName)}/hooks?limit=50`,
  );
  if (listRes.ok) {
    const hooks = z
      .array(
        z.object({
          id: z.number(),
          config: z
            .object({ url: z.string().optional() })
            .passthrough()
            .optional(),
        }),
      )
      .parse(await listRes.json());
    if (hooks.some((h) => h.config?.url === params.webhookUrl)) {
      return;
    }
  }

  const res = await adminFetch(
    `/orgs/${encodeURIComponent(params.orgName)}/hooks`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "gitea",
        active: true,
        events: [
          "push",
          "pull_request",
          "pull_request_comment",
          "issue_comment",
          "release",
          "status",
        ],
        config: {
          url: params.webhookUrl,
          content_type: "json",
          secret: params.secret,
          http_method: "post",
        },
      }),
    },
  );
  if (!res.ok && res.status !== 422) {
    const text = await res.text();
    throw new UpstreamError(text || res.statusText, res.status);
  }
}

export async function giteaCreateOrgRepo(params: {
  orgName: string;
  repoName: string;
  description?: string;
  autoInit?: boolean;
}): Promise<{
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}> {
  const res = await adminFetch(
    `/orgs/${encodeURIComponent(params.orgName)}/repos`,
    {
      method: "POST",
      body: JSON.stringify({
        name: params.repoName,
        description: params.description ?? "",
        private: true,
        auto_init: params.autoInit ?? true,
        default_branch: "main",
        readme: "Default",
      }),
    },
  );
  if (res.status === 422) {
    const existing = await adminFetch(
      `/repos/${encodeURIComponent(params.orgName)}/${encodeURIComponent(params.repoName)}`,
    );
    if (existing.ok) {
      const r = z
        .object({
          id: z.number(),
          name: z.string(),
          full_name: z.string(),
          default_branch: z.string().optional(),
          private: z.boolean(),
        })
        .parse(await existing.json());
      return {
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch || "main",
        private: r.private,
      };
    }
  }
  const r = z
    .object({
      id: z.number(),
      name: z.string(),
      full_name: z.string(),
      default_branch: z.string().optional(),
      private: z.boolean(),
    })
    .parse(await giteaJsonOrThrow(res));
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch || "main",
    private: r.private,
  };
}
