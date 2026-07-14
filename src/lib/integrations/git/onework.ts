import { z } from "zod";

import type {
  GitRepo,
  GitTreeEntry,
  GitBranchInfo,
  GitCommitListItem,
  GitCommitDetail,
  GitPullCreateHint,
} from "@/types/git";
import type {
  PullRequest,
  PullRequestActivity,
  PullRequestActivityCheck,
  PullRequestActivityComment,
  PullRequestActivityReview,
  DiffFile,
} from "@/types";
import { unifiedPatchToDiffFile, splitUnifiedDiffByFile, mapGiteaFileStatus } from "./parse-patch";
import type {
  GitProviderClient,
  ListCommitsOpts,
  ListPullsOpts,
  CreatePullRequestInput,
  AddRepoCollaboratorInput,
  AddRepoCollaboratorResult,
  RepoCollaborator,
  RepoCollaboratorPermission,
  PostPullRequestReviewCommentInput,
  UpdatePullRequestInput,
} from "./provider";
import { UpstreamError, UpstreamRateLimitError } from "./errors";
import { isSameVcLogin } from "./pr-reviews";
import { parseGitHubJsonErrorBody } from "./github-errors";
import { parseCheckRunsJson, parseCommitStatusesJson } from "./pr-checks";
import { mapGiteaMergeable } from "./pr-merge";
import { buildVcPullId } from "./vc-pull-id";
import {
  applyGiteaDraftPrefix,
  displayGiteaPullTitle,
  stripGiteaDraftPrefix,
} from "./gitea-draft";

function oneworkApiBase(): string {
  const raw = process.env.ONEWORK_VC_GITEA_URL?.trim();
  if (!raw) throw new Error("ONEWORK_VC_GITEA_URL is not configured");
  return `${raw.replace(/\/$/, "")}/api/v1`;
}

export function isOneworkVcConfigured(): boolean {
  return Boolean(
    process.env.ONEWORK_VC_GITEA_URL?.trim() &&
      process.env.ONEWORK_VC_ADMIN_TOKEN?.trim(),
  );
}

const githubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  avatar_url: z.string().nullable().optional(),
});

const githubRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().optional().default("main"),
  description: z.string().nullable().optional(),
  html_url: z.string(),
  clone_url: z.string().optional(),
  ssh_url: z.string().optional(),
  stargazers_count: z.number().optional().default(0),
  updated_at: z.string().optional().default(""),
  owner: z.object({ login: z.string() }),
  license: z.object({ name: z.string().optional() }).nullable().optional(),
  homepage: z.string().nullable().optional(),
});

async function owFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${oneworkApiBase()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `token ${token}`,
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 429) {
    const retry = res.headers.get("retry-after");
    const sec = retry ? parseInt(retry, 10) : undefined;
    throw new UpstreamRateLimitError(
      "OneWork Version Control rate limit",
      Number.isFinite(sec) ? sec : undefined,
    );
  }
  return res;
}

function mapRepo(r: z.infer<typeof githubRepoSchema>): GitRepo {
  const parts = r.full_name.split("/");
  const owner = r.owner?.login || parts[0] || "";
  const name = parts.length > 1 ? parts.slice(1).join("/") : r.name;
  return {
    id: String(r.id),
    provider: "onework",
    owner,
    name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description ?? null,
    homepage: r.homepage ?? null,
    license: r.license?.name ?? null,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url ?? `${r.html_url}.git`,
    sshUrl: r.ssh_url ?? "",
    stargazersCount: r.stargazers_count,
    updatedAt: r.updated_at || new Date().toISOString(),
  };
}

async function safeResponseJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Gitea often sends `null` for array fields; Zod `.default([])` only handles undefined. */
function giteaJsonArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (val) => (Array.isArray(val) ? val : []),
    z.array(item),
  );
}

function giteaCollaboratorPermission(
  permission: RepoCollaboratorPermission | string,
): "read" | "write" | "admin" {
  switch (permission) {
    case "admin":
      return "admin";
    case "push":
    case "maintain":
      return "write";
    default:
      return "read";
  }
}

const giteaUserRefSchema = z
  .object({
    login: z.string().optional(),
    username: z.string().optional(),
    avatar_url: z.string().nullable().optional(),
  })
  .passthrough()
  .transform((u) => ({
    login: u.login ?? u.username ?? "unknown",
    avatar_url: u.avatar_url ?? null,
  }));

const giteaPullFileSchema = z.object({
  filename: z.string(),
  patch: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  status: z.string().optional(),
});

function mapPullFilesToDiff(
  files: z.infer<typeof giteaPullFileSchema>[],
): DiffFile[] {
  return files.map((f) => {
    const df = unifiedPatchToDiffFile(f.filename, f.patch);
    if (typeof f.additions === "number") df.additions = f.additions;
    if (typeof f.deletions === "number") df.deletions = f.deletions;
    df.status = mapGiteaFileStatus(f.status);
    return df;
  });
}

export function createOneworkClient(accessToken: string): GitProviderClient {
  const token = accessToken;

  async function jsonOrThrow<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text();
      throw new UpstreamError(
        parseGitHubJsonErrorBody(text) || res.statusText,
        res.status,
      );
    }
    return res.json() as Promise<T>;
  }

  return {
    async getViewer() {
      const res = await owFetch("/user", token);
      const data = githubUserSchema.parse(await jsonOrThrow(res));
      return {
        id: String(data.id),
        login: data.login,
        avatarUrl: data.avatar_url ?? null,
      };
    },

    async listRepos({ q, page = 1, perPage = 30 }) {
      const res = await owFetch(
        `/user/repos?per_page=${perPage}&page=${page}&sort=updated&type=all`,
        token,
      );
      const arr = z.array(githubRepoSchema).parse(await jsonOrThrow(res));
      let repos = arr.map(mapRepo);
      if (q?.trim()) {
        const ql = q.trim().toLowerCase();
        repos = repos.filter(
          (r) =>
            r.fullName.toLowerCase().includes(ql) ||
            r.name.toLowerCase().includes(ql) ||
            r.owner.toLowerCase().includes(ql) ||
            r.fullName
              .toLowerCase()
              .split("/")
              .some((seg) => seg.includes(ql)),
        );
      }
      return repos;
    },

    async getReadme(owner, repo, ref) {
      const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const decodeReadmeContent = (data: {
        content?: string;
        encoding?: string;
      }) => {
        if (!data.content) return null;
        if (data.encoding === "base64") {
          const buf = Buffer.from(data.content.replace(/\n/g, ""), "base64");
          return { content: buf.toString("utf8"), encoding: "utf-8" as const };
        }
        return { content: data.content, encoding: "utf-8" as const };
      };

      // Prefer dedicated endpoint when available (GitHub-compatible).
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme${refQ}`,
        token,
      );
      if (res.ok) {
        const decoded = decodeReadmeContent(
          (await res.json()) as { content?: string; encoding?: string },
        );
        if (decoded) return decoded;
      }

      // Gitea 1.22 often 404s /readme — fall back to common README filenames.
      for (const file of ["README.md", "readme.md", "Readme.md"]) {
        const fileRes = await owFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(file)}${refQ}`,
          token,
        );
        if (!fileRes.ok) continue;
        const decoded = decodeReadmeContent(
          (await fileRes.json()) as { content?: string; encoding?: string },
        );
        if (decoded) return decoded;
      }
      return null;
    },

    async getTree(owner, repo, path, ref) {
      const pathSeg = path
        ? `/${path
            .split("/")
            .filter(Boolean)
            .map(encodeURIComponent)
            .join("/")}`
        : "";
      // Always use ?ref= — using & without a preceding ? appended ref to the path segment (404 → empty tree).
      const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${pathSeg}${refQ}`,
        token,
      );
      if (res.status === 404) return [];
      const data = await jsonOrThrow<unknown>(res);
      const items = Array.isArray(data) ? data : [data];
      const out: GitTreeEntry[] = [];
      for (const item of items) {
        const o = item as { name?: string; path?: string; type?: string };
        if (!o.name || !o.path || !o.type) continue;
        out.push({
          name: o.name,
          path: o.path,
          type: o.type === "dir" ? "folder" : "file",
        });
      }
      out.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    },

    async getFileText(owner, repo, filepath, ref) {
      const trimmed = filepath.replace(/^\/+/, "");
      const pathSeg = trimmed
        ? `/${trimmed
            .split("/")
            .filter(Boolean)
            .map(encodeURIComponent)
            .join("/")}`
        : "";
      const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${pathSeg}${refQ}`,
        token,
      );
      if (res.status === 404) return null;
      const data = await jsonOrThrow<unknown>(res);
      if (Array.isArray(data)) return null;

      const obj = z
        .object({
          type: z.string(),
          encoding: z.string().optional(),
          content: z.string().optional(),
          html_url: z.string().optional().nullable(),
        })
        .parse(data);

      if (obj.type !== "file") return null;

      if (!obj.encoding || obj.encoding !== "base64" || !obj.content) {
        return { text: null, isBinary: true, htmlUrl: obj.html_url ?? null };
      }
      const buf = Buffer.from(obj.content.replace(/\n/g, ""), "base64");
      if (buf.includes(0) || buf.length > 900_000) {
        return { text: null, isBinary: true, htmlUrl: obj.html_url ?? null };
      }
      const text = buf.toString("utf8");
      return { text, isBinary: false, htmlUrl: obj.html_url ?? null };
    },

    async listBranches(owner, repo) {
      const resRepo = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        token,
      );
      const repoData = z
        .object({ default_branch: z.string().optional() })
        .parse(await jsonOrThrow(resRepo));
      const def = repoData.default_branch || "main";
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
        token,
      );
      // Gitea returns commit.id; GitHub-compatible responses may use commit.sha.
      const arr = z
        .array(
          z.object({
            name: z.string(),
            commit: z.object({
              id: z.string().optional(),
              sha: z.string().optional(),
            }),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((b): GitBranchInfo => {
        const sha = b.commit.sha || b.commit.id || "";
        return {
          name: b.name,
          isDefault: b.name === def,
          lastCommitSha: sha,
        };
      });
    },

    async listCommits(owner, repo, opts: ListCommitsOpts) {
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 30;
      const shaQ = opts.ref ? `&sha=${encodeURIComponent(opts.ref)}` : "";
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=${perPage}&page=${page}${shaQ}`,
        token,
      );
      const arr = z
        .array(
          z.object({
            sha: z.string(),
            commit: z.object({
              message: z.string(),
              author: z
                .object({
                  name: z.string().optional(),
                  date: z.string().optional(),
                })
                .nullable()
                .optional(),
            }),
            author: z
              .object({
                login: z.string().optional(),
                avatar_url: z.string().optional(),
              })
              .nullable()
              .optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((c): GitCommitListItem => {
        const lines = c.commit.message.split("\n");
        const title = lines[0] ?? c.commit.message;
        const rest = lines.slice(1).join("\n").trim();
        return {
          id: c.sha,
          message: title,
          description: rest || undefined,
          created_at: c.commit.author?.date || new Date().toISOString(),
          author: c.author?.login
            ? {
                full_name: c.author.login,
                avatar_url: c.author.avatar_url || "",
              }
            : {
                full_name: c.commit.author?.name || "Unknown",
                avatar_url: "",
              },
        };
      });
    },

    async getCommit(owner, repo, sha) {
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}`,
        token,
      );
      const c = z
        .object({
          sha: z.string(),
          html_url: z.string().optional(),
          commit: z.object({
            message: z.string(),
            author: z
              .object({
                name: z.string().optional(),
                date: z.string().optional(),
              })
              .nullable()
              .optional(),
          }),
          author: z
            .object({
              login: z.string().optional(),
              avatar_url: z.string().optional(),
            })
            .nullable()
            .optional(),
          stats: z
            .object({
              total: z.number().optional(),
              additions: z.number().optional(),
              deletions: z.number().optional(),
            })
            .optional(),
          files: z
            .array(
              z.object({
                filename: z.string(),
                status: z.string(),
                patch: z.string().optional(),
                additions: z.number().optional(),
                deletions: z.number().optional(),
              }),
            )
            .optional(),
        })
        .parse(await jsonOrThrow(res));
      const lines = c.commit.message.split("\n");
      const title = lines[0] ?? c.commit.message;
      const rest = lines.slice(1).join("\n").trim();
      const diffFiles =
        c.files?.map((f) => {
          const st: "added" | "removed" | "modified" =
            f.status === "added"
              ? "added"
              : f.status === "removed"
                ? "removed"
                : "modified";
          return unifiedPatchToDiffFile(f.filename, f.patch, {
            status: st,
            additions: f.additions,
            deletions: f.deletions,
          });
        }) ?? [];
      return {
        id: c.sha,
        message: title,
        description: rest || undefined,
        created_at: c.commit.author?.date || new Date().toISOString(),
        author: c.author?.login
          ? {
              full_name: c.author.login,
              avatar_url: c.author.avatar_url || "",
            }
          : {
              full_name: c.commit.author?.name || "Unknown",
              avatar_url: "",
            },
        files_changed: c.files?.length ?? 0,
        insertions: c.stats?.additions ?? 0,
        deletions: c.stats?.deletions ?? 0,
        diffFiles,
        commitHtmlUrl: c.html_url ?? null,
      } satisfies GitCommitDetail;
    },

    async listPullRequests(owner, repo, opts: ListPullsOpts) {
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 30;
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${opts.state}&per_page=${perPage}&page=${page}`,
        token,
      );
      const arr = z
        .array(
          z.object({
            number: z.number(),
            title: z.string(),
            body: z.string().nullable().optional(),
            state: z.string(),
            draft: z.boolean().optional(),
            head: z.object({ ref: z.string() }),
            base: z.object({ ref: z.string() }),
            user: z
              .object({
                login: z.string(),
                avatar_url: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
            created_at: z.string(),
            labels: giteaJsonArray(
              z.object({ name: z.string() }).passthrough(),
            ),
            merged: z.boolean().optional(),
            merged_at: z.string().nullable().optional(),
            mergeable: z.boolean().nullish(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((pr): PullRequest => {
        const isOpen = pr.state === "open";
        const merged = pr.merged === true || Boolean(pr.merged_at);
        const fullName = `${owner}/${repo}`;
        const mergeMeta = mapGiteaMergeable(pr.mergeable);
        const isDraft = pr.draft === true;
        return {
          id: buildVcPullId("onework", fullName, pr.number),
          project_id: "",
          author_id: pr.user?.login || "",
          title: displayGiteaPullTitle(pr.title, isDraft),
          description: pr.body || "",
          status: merged
            ? "Merged"
            : isOpen
              ? "In Review"
              : "Changes Requested",
          base_branch: pr.base.ref,
          compare_branch: pr.head.ref,
          is_open: isOpen && !merged,
          is_draft: isDraft,
          mergeable: mergeMeta.mergeable,
          mergeable_state: mergeMeta.mergeable_state,
          labels: (pr.labels ?? []).map((l) => l.name),
          created_at: pr.created_at,
          author: pr.user
            ? {
                full_name: pr.user.login,
                avatar_url: pr.user.avatar_url || "",
              }
            : undefined,
          commits_count: 0,
          files_changed_count: 0,
        };
      });
    },

    async createPullRequest(owner, repo, input: CreatePullRequestInput) {
      const createAsDraft = input.draft === true;
      const giteaTitle = createAsDraft
        ? applyGiteaDraftPrefix(input.title)
        : input.title;
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: giteaTitle,
            body: input.body.trim() ? input.body : undefined,
            head: input.head,
            base: input.base,
          }),
        },
      );
      const pr = z
        .object({
          number: z.number(),
          title: z.string(),
          body: z.string().nullable().optional(),
          state: z.string(),
          draft: z.boolean().optional(),
          head: z.object({ ref: z.string() }),
          base: z.object({ ref: z.string() }),
          user: z
            .object({
              login: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          created_at: z.string(),
          labels: giteaJsonArray(z.object({ name: z.string() })),
          html_url: z.string().optional(),
          merged_at: z.string().nullable().optional(),
        })
        .parse(await jsonOrThrow(res));
      const isOpen = pr.state === "open";
      const merged = Boolean(pr.merged_at);
      const isDraft = pr.draft === true || createAsDraft;
      const fullName = `${owner}/${repo}`;
      return {
        id: buildVcPullId("onework", fullName, pr.number),
        project_id: "",
        author_id: pr.user?.login || "",
        title: displayGiteaPullTitle(pr.title, isDraft),
        description: pr.body || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: pr.base.ref,
        compare_branch: pr.head.ref,
        is_open: isOpen && !merged,
        is_draft: isDraft,
        labels: (pr.labels ?? []).map((l) => l.name),
        created_at: pr.created_at,
        author: pr.user
          ? {
              full_name: pr.user.login,
              avatar_url: pr.user.avatar_url || "",
            }
          : undefined,
        commits_count: 0,
        files_changed_count: 0,
        html_url: pr.html_url ?? null,
      } satisfies PullRequest;
    },

    async getPullCreateHint(owner, repo, baseIn, compareIn) {
      const base = baseIn.trim();
      const compare = compareIn.trim();
      const none = (): GitPullCreateHint => ({
        show: false,
        baseBranch: base,
        compareBranch: compare,
        commitsAhead: 0,
        lastActivityAt: null,
      });
      if (!base || !compare || base === compare) return none();

      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);

      const prsRes = await owFetch(
        `/repos/${e}/${r}/pulls?state=open&head=${encodeURIComponent(`${owner}:${compare}`)}&per_page=1`,
        token,
      );
      if (!prsRes.ok) return none();
      const prs = z.array(z.unknown()).parse(await prsRes.json());
      if (prs.length > 0) return none();

      const cmpSeg = encodeURIComponent(`${base}...${compare}`);
      const cmpRes = await owFetch(`/repos/${e}/${r}/compare/${cmpSeg}`, token);
      if (!cmpRes.ok) return none();
      const data = z
        .object({
          ahead_by: z.number(),
          commits: z
            .array(
              z.object({
                commit: z
                  .object({
                    committer: z.object({ date: z.string() }).optional(),
                    author: z.object({ date: z.string() }).optional(),
                  })
                  .optional(),
              }),
            )
            .optional()
            .default([]),
        })
        .parse(await jsonOrThrow(cmpRes));

      if (data.ahead_by <= 0) return none();

      const commits = data.commits ?? [];
      const tip =
        commits.length > 0 ? commits[commits.length - 1]?.commit : undefined;
      const lastActivityAt = tip?.committer?.date ?? tip?.author?.date ?? null;

      return {
        show: true,
        baseBranch: base,
        compareBranch: compare,
        commitsAhead: data.ahead_by,
        lastActivityAt,
      };
    },

    async addRepositoryCollaborator(
      owner,
      repo,
      input: AddRepoCollaboratorInput,
    ): Promise<AddRepoCollaboratorResult> {
      const username = input.username.trim().replace(/^@/, "");
      if (!username) {
        throw new UpstreamError("Username is required", 400);
      }
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permission: giteaCollaboratorPermission(input.permission),
          }),
        },
      );
      if (res.status === 204) {
        return {
          ok: true,
          alreadyCollaborator: true,
          message: `${username} already has access to this repository.`,
        };
      }
      if (res.status === 201) {
        return {
          ok: true,
          invitationPending: true,
          message: `Invitation sent to ${username}. They will appear under Collaborators after they accept.`,
        };
      }
      const text = await res.text();
      const parsed = parseGitHubJsonErrorBody(text);
      const detail =
        res.status === 404
          ? `${parsed} Check the username, repository owner/name, and that your account has permission to manage collaborators.`
          : parsed;
      throw new UpstreamError(detail || res.statusText, res.status);
    },

    async listRepositoryCollaborators(
      owner,
      repo,
    ): Promise<RepoCollaborator[]> {
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?per_page=100`,
        token,
      );
      const arr = z
        .array(
          z.object({
            id: z.number(),
            login: z.string(),
            avatar_url: z.string().nullable().optional(),
            html_url: z.string().optional(),
            permissions: z
              .object({
                admin: z.boolean().optional(),
                push: z.boolean().optional(),
                pull: z.boolean().optional(),
              })
              .optional(),
            permission: z.string().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((u) => {
        let permission: RepoCollaboratorPermission | string =
          u.permission || "pull";
        if (!u.permission && u.permissions) {
          if (u.permissions.admin) permission = "admin";
          else if (u.permissions.push) permission = "push";
          else permission = "pull";
        }
        return {
          id: String(u.id),
          login: u.login,
          avatarUrl: u.avatar_url ?? null,
          permission,
          htmlUrl: u.html_url ?? null,
        };
      });
    },

    async removeRepositoryCollaborator(owner, repo, username) {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new UpstreamError("Username is required", 400);
      const res = await owFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(u)}`,
        token,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        const text = await res.text();
        throw new UpstreamError(text || res.statusText, res.status);
      }
    },

    async getPullRequestDetail(owner, repo, number) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(`/repos/${e}/${r}/pulls/${number}`, token);
      const prRaw = await jsonOrThrow<unknown>(res);
      const prParsed = z
        .object({
          number: z.number(),
          title: z.string(),
          body: z.string().nullish(),
          state: z.string(),
          merged: z.boolean().optional(),
          merged_at: z.string().nullable().optional(),
          draft: z.boolean().optional(),
          mergeable: z.boolean().nullish(),
          head: z
            .object({
              ref: z.string(),
              sha: z.string().optional().default(""),
            })
            .passthrough(),
          base: z.object({ ref: z.string() }).passthrough(),
          user: giteaUserRefSchema.nullish(),
          created_at: z.string(),
          labels: giteaJsonArray(
            z
              .object({ name: z.string().optional() })
              .passthrough()
              .transform((l) => ({ name: l.name ?? "" })),
          ),
          commits: z.number().optional(),
          changed_files: z.number().optional(),
          html_url: z.string().optional(),
          requested_reviewers: giteaJsonArray(z.unknown()),
          reviewers: giteaJsonArray(z.unknown()),
        })
        .safeParse(prRaw);
      if (!prParsed.success) {
        throw new UpstreamError(
          `Failed to parse pull request from OneWork VC: ${prParsed.error.message}`,
          502,
        );
      }
      const pr = prParsed.data;

      const mapReviewer = (raw: unknown) => {
        const parsed = giteaUserRefSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      };
      const authorLogin = pr.user?.login ?? "";
      const reviewerLogins = [
        ...(pr.requested_reviewers ?? []).map(mapReviewer),
        ...(pr.reviewers ?? []).map(mapReviewer),
      ]
        .filter(
          (u): u is { login: string; avatar_url: string | null } =>
            u != null && u.login !== "unknown",
        )
        .filter((u) => !isSameVcLogin(u.login, authorLogin))
        .filter(
          (u, idx, arr) => arr.findIndex((x) => x.login === u.login) === idx,
        );

      const [filesRes, commentsRes, reviewsRes, checksRes, statusesRes] =
        await Promise.all([
          owFetch(`/repos/${e}/${r}/pulls/${number}/files?per_page=100`, token),
          owFetch(
            `/repos/${e}/${r}/issues/${number}/comments?per_page=100`,
            token,
          ),
          owFetch(
            `/repos/${e}/${r}/pulls/${number}/reviews?per_page=100`,
            token,
          ),
          pr.head.sha
            ? owFetch(
                `/repos/${e}/${r}/commits/${pr.head.sha}/check-runs?per_page=100`,
                token,
              )
            : Promise.resolve(new Response(null, { status: 404 })),
          pr.head.sha
            ? owFetch(
                `/repos/${e}/${r}/statuses/${pr.head.sha}?per_page=100`,
                token,
              )
            : Promise.resolve(new Response(null, { status: 404 })),
        ]);

      let fileRows: z.infer<typeof giteaPullFileSchema>[] = [];
      if (filesRes.ok) {
        const parsed = z
          .array(giteaPullFileSchema)
          .safeParse(await safeResponseJson(filesRes));
        if (parsed.success) fileRows = parsed.data;
      }

      const patchesMissing =
        fileRows.length === 0 ||
        fileRows.every((f) => !f.patch?.trim());

      if (patchesMissing) {
        const cmpSeg = encodeURIComponent(`${pr.base.ref}...${pr.head.ref}`);
        const cmpRes = await owFetch(`/repos/${e}/${r}/compare/${cmpSeg}`, token);
        if (cmpRes.ok) {
          const cmp = z
            .object({
              files: giteaJsonArray(giteaPullFileSchema),
            })
            .safeParse(await safeResponseJson(cmpRes));
          const cmpFiles = cmp.success ? (cmp.data.files ?? []) : [];
          if (cmpFiles.length > 0) {
            fileRows = cmpFiles;
          }
        }
      }

      if (
        fileRows.length === 0 ||
        fileRows.every((f) => !f.patch?.trim())
      ) {
        const diffRes = await owFetch(
          `/repos/${e}/${r}/pulls/${number}.diff`,
          token,
          { headers: { Accept: "text/plain" } },
        );
        if (diffRes.ok) {
          const diffText = await diffRes.text();
          const byFile = splitUnifiedDiffByFile(diffText);
          if (byFile.size > 0) {
            fileRows = [...byFile.entries()].map(([filename, patch]) => ({
              filename,
              patch,
              status: "changed",
            }));
          }
        }
      }

      const diffFiles = mapPullFilesToDiff(fileRows);

      const isOpen = pr.state === "open";
      const merged = pr.merged === true || Boolean(pr.merged_at);
      const repoFullName = `${owner}/${repo}`;
      const mergeMeta = mapGiteaMergeable(pr.mergeable);
      const isDraft = pr.draft === true;
      const pull: PullRequest = {
        id: buildVcPullId("onework", repoFullName, pr.number),
        project_id: "",
        author_id: pr.user?.login || "",
        title: displayGiteaPullTitle(pr.title, isDraft),
        description: pr.body || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: pr.base.ref,
        compare_branch: pr.head.ref,
        is_open: isOpen && !merged,
        is_draft: isDraft,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
        labels: (pr.labels ?? []).map((l) => l.name).filter(Boolean),
        created_at: pr.created_at,
        author: pr.user
          ? {
              full_name: pr.user.login,
              avatar_url: pr.user.avatar_url || "",
            }
          : undefined,
        commits_count: pr.commits,
        files_changed_count: pr.changed_files ?? diffFiles.length,
        diffFiles,
        html_url: pr.html_url ?? null,
      };

      let comments: PullRequestActivityComment[] = [];
      if (commentsRes.ok) {
        const raw = z
          .array(
            z.object({
              id: z.number(),
              body: z.string(),
              user: z
                .object({
                  login: z.string().optional(),
                  username: z.string().optional(),
                  avatar_url: z.string().nullable().optional(),
                })
                .passthrough()
                .nullable()
                .optional(),
              created_at: z.string(),
              html_url: z.string().optional(),
            }),
          )
          .safeParse(await safeResponseJson(commentsRes));
        if (raw.success) {
          comments = raw.data.map((c) => ({
            id: String(c.id),
            body: c.body,
            author_login:
              c.user?.login ?? c.user?.username ?? "unknown",
            author_avatar_url: c.user?.avatar_url || "",
            created_at: c.created_at,
            html_url: c.html_url ?? null,
          }));
        }
      }

      let reviews: PullRequestActivityReview[] = [];
      if (reviewsRes.ok) {
        const raw = z
          .array(
            z.object({
              id: z.number(),
              user: z
                .object({
                  login: z.string().optional(),
                  username: z.string().optional(),
                })
                .passthrough()
                .optional(),
              state: z.string(),
              body: z.string().nullable().optional(),
              submitted_at: z.string().nullable().optional(),
            }),
          )
          .safeParse(await safeResponseJson(reviewsRes));
        if (raw.success) {
          reviews = raw.data.map((rv) => ({
            id: String(rv.id),
            author_login: rv.user?.login ?? rv.user?.username ?? "unknown",
            state: rv.state,
            body: rv.body || "",
            submitted_at: rv.submitted_at ?? null,
          }));
        }
      }

      let checks: PullRequestActivityCheck[] = [];
      if (checksRes.ok) {
        checks = parseCheckRunsJson(await safeResponseJson(checksRes));
      }
      if (checks.length === 0 && statusesRes.ok) {
        checks = parseCommitStatusesJson(await safeResponseJson(statusesRes));
      }

      const activity: PullRequestActivity = {
        comments,
        reviews,
        checks,
        head_sha: pr.head.sha || null,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
        requested_reviewers: reviewerLogins.map((u) => ({
          login: u.login,
          avatar_url: u.avatar_url,
        })),
      };
      pull.activity = activity;

      return { pull, diffFiles };
    },

    async postPullRequestComment(owner, repo, number, body) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/issues/${number}/comments`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      const c = z
        .object({
          id: z.number(),
          body: z.string(),
          user: z
            .object({
              login: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          created_at: z.string(),
          html_url: z.string().optional(),
        })
        .parse(await jsonOrThrow(res));
      return {
        id: String(c.id),
        body: c.body,
        author_login: c.user?.login || "unknown",
        author_avatar_url: c.user?.avatar_url || "",
        created_at: c.created_at,
        html_url: c.html_url ?? null,
      };
    },

    async mergePullRequest(owner, repo, number, input) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const mergeStyle =
        input?.mergeMethod === "squash"
          ? "squash"
          : input?.mergeMethod === "rebase"
            ? "rebase"
            : "merge";
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/merge`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Do: mergeStyle }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async closePullRequest(owner, repo, number) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async submitPullRequestReview(owner, repo, number, input) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/reviews`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: input.event,
            body: input.body?.trim() ? input.body : undefined,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async requestPullRequestReviewers(owner, repo, number, reviewers) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const names = reviewers
        .map((u) => u.trim().replace(/^@/, ""))
        .filter(Boolean);
      if (names.length === 0) {
        throw new UpstreamError("At least one reviewer is required", 400);
      }
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/requested_reviewers`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewers: names }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async reopenPullRequest(owner, repo, number) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "open" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async updatePullRequest(
      owner,
      repo,
      number,
      input: UpdatePullRequestInput,
    ) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const payload: Record<string, unknown> = {};
      if (input.body != null) payload.body = input.body;

      if (input.title != null || input.draft != null) {
        const currentRes = await owFetch(`/repos/${e}/${r}/pulls/${number}`, token);
        const current = z
          .object({
            title: z.string(),
            draft: z.boolean().optional(),
          })
          .parse(await jsonOrThrow(currentRes));
        let title = input.title ?? current.title;
        const makeDraft =
          input.draft === true
            ? true
            : input.draft === false
              ? false
              : current.draft === true;
        title = makeDraft
          ? applyGiteaDraftPrefix(title)
          : stripGiteaDraftPrefix(title);
        payload.title = title;
      }

      const res = await owFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async updatePullRequestBranch(owner, repo, number) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/update`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async postPullRequestReviewComment(
      owner,
      repo,
      number,
      input: PostPullRequestReviewCommentInput,
    ) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/reviews`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: input.body,
            event: "COMMENT",
            comments: [
              {
                body: input.body,
                path: input.path,
                new_position: input.line,
              },
            ],
          }),
        },
      );
      const c = z
        .object({
          id: z.number(),
          body: z.string().nullable().optional(),
          user: z
            .object({
              login: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          submitted_at: z.string().nullable().optional(),
          comments: z
            .array(
              z.object({
                id: z.number(),
                body: z.string(),
                path: z.string().nullable().optional(),
                line: z.number().nullable().optional(),
                diff_hunk: z.string().nullable().optional(),
                created_at: z.string().optional(),
              }),
            )
            .optional(),
        })
        .parse(await jsonOrThrow(res));
      const lineComment = c.comments?.[0];
      return {
        id: String(lineComment?.id ?? c.id),
        body: lineComment?.body ?? c.body ?? input.body,
        author_login: c.user?.login || "unknown",
        author_avatar_url: c.user?.avatar_url || "",
        created_at: lineComment?.created_at ?? c.submitted_at ?? new Date().toISOString(),
        html_url: null,
        path: lineComment?.path ?? input.path,
        line: lineComment?.line ?? input.line,
        diff_hunk: lineComment?.diff_hunk ?? null,
      };
    },

    async deleteBranch(owner, repo, branch) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/branches/${encodeURIComponent(branch)}`,
        token,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },

    async enablePullRequestAutoMerge(owner, repo, number) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await owFetch(
        `/repos/${e}/${r}/pulls/${number}/merge`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Do: "merge",
            merge_when_checks_succeed: true,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(
          parseGitHubJsonErrorBody(text) || res.statusText,
          res.status,
        );
      }
    },
  };
}

/** Create a branch from an existing ref (OneWork VC / Gitea). */
export async function oneworkCreateBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromRef: string,
): Promise<void> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const res = await owFetch(`/repos/${e}/${r}/branches`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_branch_name: branchName, old_branch_name: fromRef }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
}

/** Commit file create/update via Gitea contents API. */
export async function oneworkCommitFile(
  token: string,
  owner: string,
  repo: string,
  filepath: string,
  content: string,
  message: string,
  branch: string,
  sha?: string | null,
): Promise<void> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const pathSeg = filepath
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const body: Record<string, unknown> = {
    content: Buffer.from(content, "utf8").toString("base64"),
    message,
    branch,
  };
  if (sha) body.sha = sha;
  const res = await owFetch(`/repos/${e}/${r}/contents/${pathSeg}`, token, {
    method: sha ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
}

export interface OneworkTag {
  name: string;
  commitSha: string;
  message: string | null;
  createdAt: string | null;
}

export interface OneworkRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  htmlUrl: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  assetCount: number;
}

export async function oneworkListTags(
  token: string,
  owner: string,
  repo: string,
): Promise<OneworkTag[]> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const res = await owFetch(`/repos/${e}/${r}/tags?limit=50`, token);
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
  const arr = z
    .array(
      z.object({
        name: z.string(),
        id: z.string().optional(),
        commit: z
          .object({
            sha: z.string().optional(),
            created: z.string().optional(),
          })
          .optional(),
        message: z.string().nullable().optional(),
      }),
    )
    .parse(await res.json());
  return arr.map((t) => ({
    name: t.name,
    commitSha: t.commit?.sha || t.id || "",
    message: t.message ?? null,
    createdAt: t.commit?.created ?? null,
  }));
}

export async function oneworkListReleases(
  token: string,
  owner: string,
  repo: string,
): Promise<OneworkRelease[]> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const res = await owFetch(`/repos/${e}/${r}/releases?limit=50`, token);
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
  const arr = z
    .array(
      z.object({
        id: z.number(),
        tag_name: z.string(),
        name: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        draft: z.boolean().optional(),
        prerelease: z.boolean().optional(),
        html_url: z.string().optional(),
        created_at: z.string().optional(),
        published_at: z.string().nullable().optional(),
        assets: z.array(z.unknown()).optional(),
      }),
    )
    .parse(await res.json());
  return arr.map((rel) => ({
    id: rel.id,
    tagName: rel.tag_name,
    name: rel.name?.trim() || rel.tag_name,
    body: rel.body || "",
    draft: rel.draft === true,
    prerelease: rel.prerelease === true,
    htmlUrl: rel.html_url ?? null,
    createdAt: rel.created_at ?? null,
    publishedAt: rel.published_at ?? null,
    assetCount: rel.assets?.length ?? 0,
  }));
}

export async function oneworkCreateRelease(
  token: string,
  owner: string,
  repo: string,
  input: {
    tagName: string;
    target: string;
    name: string;
    body: string;
    draft?: boolean;
    prerelease?: boolean;
  },
): Promise<OneworkRelease> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const res = await owFetch(`/repos/${e}/${r}/releases`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: input.tagName,
      target_commitish: input.target,
      name: input.name || input.tagName,
      body: input.body || "",
      draft: input.draft === true,
      prerelease: input.prerelease === true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
  const rel = z
    .object({
      id: z.number(),
      tag_name: z.string(),
      name: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      draft: z.boolean().optional(),
      prerelease: z.boolean().optional(),
      html_url: z.string().optional(),
      created_at: z.string().optional(),
      published_at: z.string().nullable().optional(),
      assets: z.array(z.unknown()).optional(),
    })
    .parse(await res.json());
  return {
    id: rel.id,
    tagName: rel.tag_name,
    name: rel.name?.trim() || rel.tag_name,
    body: rel.body || "",
    draft: rel.draft === true,
    prerelease: rel.prerelease === true,
    htmlUrl: rel.html_url ?? null,
    createdAt: rel.created_at ?? null,
    publishedAt: rel.published_at ?? null,
    assetCount: rel.assets?.length ?? 0,
  };
}

export async function oneworkUploadReleaseAsset(
  token: string,
  owner: string,
  repo: string,
  releaseId: number,
  input: { name: string; data: Buffer },
): Promise<{ id: number; name: string; size: number; downloadUrl: string | null }> {
  const e = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const form = new FormData();
  form.append(
    "attachment",
    new Blob([new Uint8Array(input.data)]),
    input.name,
  );
  const res = await owFetch(
    `/repos/${e}/${r}/releases/${releaseId}/assets?name=${encodeURIComponent(input.name)}`,
    token,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new UpstreamError(
      parseGitHubJsonErrorBody(text) || res.statusText,
      res.status,
    );
  }
  const asset = z
    .object({
      id: z.number(),
      name: z.string(),
      size: z.number().optional(),
      browser_download_url: z.string().nullable().optional(),
    })
    .parse(await res.json());
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size ?? input.data.length,
    downloadUrl: asset.browser_download_url ?? null,
  };
}
