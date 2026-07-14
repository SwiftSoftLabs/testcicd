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
} from "@/types";
import { unifiedPatchToDiffFile } from "./parse-patch";
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
import { parseGitHubJsonErrorBody } from "./github-errors";
import { oauthCallbackUrl } from "./oauth";
import { parseCheckRunsJson, parseCommitStatusesJson } from "./pr-checks";
import { mapGithubMergeableState } from "./pr-merge";
import { buildVcPullId } from "./vc-pull-id";

const GITHUB_API = "https://api.github.com";

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

async function ghFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 429) {
    const retry = res.headers.get("retry-after");
    const sec = retry ? parseInt(retry, 10) : undefined;
    throw new UpstreamRateLimitError(
      "GitHub rate limit",
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
    provider: "github",
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

export function createGitHubClient(accessToken: string): GitProviderClient {
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
      const res = await ghFetch("/user", token);
      const data = githubUserSchema.parse(await jsonOrThrow(res));
      return {
        id: String(data.id),
        login: data.login,
        avatarUrl: data.avatar_url ?? null,
      };
    },

    async listRepos({ q, page = 1, perPage = 30 }) {
      const res = await ghFetch(
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
      const res = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme${refQ}`,
        token,
      );
      if (res.status === 404) return null;
      const data = await jsonOrThrow<{ content?: string; encoding?: string }>(
        res,
      );
      if (!data.content) return null;
      if (data.encoding === "base64") {
        const buf = Buffer.from(data.content.replace(/\n/g, ""), "base64");
        return { content: buf.toString("utf8"), encoding: "utf-8" as const };
      }
      return { content: data.content, encoding: "utf-8" as const };
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
      const res = await ghFetch(
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
      const res = await ghFetch(
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
      const resRepo = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        token,
      );
      const repoData = z
        .object({ default_branch: z.string().optional() })
        .parse(await jsonOrThrow(resRepo));
      const def = repoData.default_branch || "main";
      const res = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
        token,
      );
      const arr = z
        .array(
          z.object({
            name: z.string(),
            commit: z.object({ sha: z.string() }),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map(
        (b): GitBranchInfo => ({
          name: b.name,
          isDefault: b.name === def,
          lastCommitSha: b.commit.sha,
        }),
      );
    },

    async listCommits(owner, repo, opts: ListCommitsOpts) {
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 30;
      const shaQ = opts.ref ? `&sha=${encodeURIComponent(opts.ref)}` : "";
      const res = await ghFetch(
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
      const res = await ghFetch(
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
      const res = await ghFetch(
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
            labels: z.array(z.object({ name: z.string() })),
            merged_at: z.string().nullable().optional(),
            mergeable: z.boolean().nullable().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((pr): PullRequest => {
        const isOpen = pr.state === "open";
        const merged = Boolean(pr.merged_at);
        const fullName = `${owner}/${repo}`;
        const mergeMeta = mapGithubMergeableState(pr.mergeable, null);
        return {
          id: buildVcPullId("github", fullName, pr.number),
          project_id: "",
          author_id: pr.user?.login || "",
          title: pr.title,
          description: pr.body || "",
          status: merged
            ? "Merged"
            : isOpen
              ? "In Review"
              : "Changes Requested",
          base_branch: pr.base.ref,
          compare_branch: pr.head.ref,
          is_open: isOpen && !merged,
          is_draft: pr.draft === true,
          mergeable: mergeMeta.mergeable,
          mergeable_state: mergeMeta.mergeable_state,
          labels: pr.labels.map((l) => l.name),
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
      const res = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: input.title,
            body: input.body.trim() ? input.body : undefined,
            head: input.head,
            base: input.base,
            draft: input.draft === true ? true : undefined,
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
          labels: z.array(z.object({ name: z.string() })),
          html_url: z.string().optional(),
          merged_at: z.string().nullable().optional(),
        })
        .parse(await jsonOrThrow(res));
      const isOpen = pr.state === "open";
      const merged = Boolean(pr.merged_at);
      const fullName = `${owner}/${repo}`;
      return {
        id: buildVcPullId("github", fullName, pr.number),
        project_id: "",
        author_id: pr.user?.login || "",
        title: pr.title,
        description: pr.body || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: pr.base.ref,
        compare_branch: pr.head.ref,
        is_open: isOpen && !merged,
        is_draft: pr.draft === true,
        labels: pr.labels.map((l) => l.name),
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

      const prsRes = await ghFetch(
        `/repos/${e}/${r}/pulls?state=open&head=${encodeURIComponent(`${owner}:${compare}`)}&per_page=1`,
        token,
      );
      if (!prsRes.ok) return none();
      const prs = z.array(z.unknown()).parse(await prsRes.json());
      if (prs.length > 0) return none();

      const cmpSeg = encodeURIComponent(`${base}...${compare}`);
      const cmpRes = await ghFetch(`/repos/${e}/${r}/compare/${cmpSeg}`, token);
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
      const res = await ghFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permission: input.permission }),
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
          message: `Invitation sent to ${username}. They will appear under Collaborators after they accept on GitHub.`,
        };
      }
      const text = await res.text();
      const parsed = parseGitHubJsonErrorBody(text);
      const detail =
        res.status === 404
          ? `${parsed} Check the GitHub username, repository owner/name, and that the connected account has permission to manage collaborators (GitHub often returns 404 instead of 403).`
          : parsed;
      throw new UpstreamError(detail || res.statusText, res.status);
    },

    async listRepositoryCollaborators(
      owner,
      repo,
    ): Promise<RepoCollaborator[]> {
      const res = await ghFetch(
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
                maintain: z.boolean().optional(),
                push: z.boolean().optional(),
                triage: z.boolean().optional(),
                pull: z.boolean().optional(),
              })
              .optional(),
            role_name: z.string().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((u) => {
        let permission: RepoCollaboratorPermission | string = "pull";
        if (u.role_name) permission = u.role_name;
        else if (u.permissions?.admin) permission = "admin";
        else if (u.permissions?.maintain) permission = "maintain";
        else if (u.permissions?.push) permission = "push";
        else if (u.permissions?.triage) permission = "triage";
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
      const res = await ghFetch(
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
      const res = await ghFetch(`/repos/${e}/${r}/pulls/${number}`, token);
      const pr = z
        .object({
          number: z.number(),
          title: z.string(),
          body: z.string().nullable().optional(),
          state: z.string(),
          merged: z.boolean().optional(),
          draft: z.boolean().optional(),
          mergeable: z.boolean().nullable().optional(),
          mergeable_state: z.string().nullable().optional(),
          head: z.object({ ref: z.string(), sha: z.string() }),
          base: z.object({ ref: z.string() }),
          user: z
            .object({
              login: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          created_at: z.string(),
          labels: z.array(z.object({ name: z.string() })),
          commits: z.number().optional(),
          changed_files: z.number().optional(),
          html_url: z.string().optional(),
          assignees: z
            .array(
              z.object({
                login: z.string(),
                avatar_url: z.string().nullable().optional(),
              }),
            )
            .optional(),
          milestone: z
            .object({
              title: z.string(),
              number: z.number().optional(),
            })
            .nullable()
            .optional(),
        })
        .parse(await jsonOrThrow(res));

      const [filesRes, commentsRes, reviewsRes, checksRes, statusRes] =
        await Promise.all([
          ghFetch(`/repos/${e}/${r}/pulls/${number}/files?per_page=100`, token),
          ghFetch(
            `/repos/${e}/${r}/issues/${number}/comments?per_page=100`,
            token,
          ),
          ghFetch(
            `/repos/${e}/${r}/pulls/${number}/reviews?per_page=100`,
            token,
          ),
          ghFetch(
            `/repos/${e}/${r}/commits/${pr.head.sha}/check-runs?per_page=100`,
            token,
          ),
          ghFetch(`/repos/${e}/${r}/commits/${pr.head.sha}/status`, token),
        ]);

      const filesArr = z
        .array(
          z.object({
            filename: z.string(),
            patch: z.string().optional(),
            additions: z.number().optional(),
            deletions: z.number().optional(),
            status: z.string().optional(),
          }),
        )
        .parse(await jsonOrThrow(filesRes));

      const diffFiles = filesArr.map((f) => {
        const df = unifiedPatchToDiffFile(f.filename, f.patch);
        if (typeof f.additions === "number") df.additions = f.additions;
        if (typeof f.deletions === "number") df.deletions = f.deletions;
        if (f.status === "added") df.status = "added";
        else if (f.status === "removed") df.status = "removed";
        else df.status = "modified";
        return df;
      });

      const isOpen = pr.state === "open";
      const merged = pr.merged === true;
      const ghFullName = `${owner}/${repo}`;
      const mergeMeta = mapGithubMergeableState(pr.mergeable, pr.mergeable_state);
      const pull: PullRequest = {
        id: buildVcPullId("github", ghFullName, pr.number),
        project_id: "",
        author_id: pr.user?.login || "",
        title: pr.title,
        description: pr.body || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: pr.base.ref,
        compare_branch: pr.head.ref,
        is_open: isOpen && !merged,
        is_draft: pr.draft === true,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
        labels: pr.labels.map((l) => l.name),
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
        assignees: (pr.assignees ?? []).map((a) => ({
          login: a.login,
          avatar_url: a.avatar_url ?? null,
        })),
        milestone: pr.milestone
          ? { title: pr.milestone.title, number: pr.milestone.number ?? null }
          : null,
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
                  login: z.string(),
                  avatar_url: z.string().nullable().optional(),
                })
                .nullable()
                .optional(),
              created_at: z.string(),
              html_url: z.string().optional(),
            }),
          )
          .safeParse(await commentsRes.json());
        if (raw.success) {
          comments = raw.data.map((c) => ({
            id: String(c.id),
            body: c.body,
            author_login: c.user?.login || "unknown",
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
              user: z.object({ login: z.string() }),
              state: z.string(),
              body: z.string().nullable().optional(),
              submitted_at: z.string().nullable().optional(),
            }),
          )
          .safeParse(await reviewsRes.json());
        if (raw.success) {
          reviews = raw.data.map((rv) => ({
            id: String(rv.id),
            author_login: rv.user.login,
            state: rv.state,
            body: rv.body || "",
            submitted_at: rv.submitted_at ?? null,
          }));
        }
      }

      let checks: PullRequestActivityCheck[] = [];
      if (checksRes.ok) {
        try {
          checks = parseCheckRunsJson(await checksRes.json());
        } catch {
          checks = [];
        }
      }
      if (checks.length === 0 && statusRes.ok) {
        try {
          const combined = z
            .object({ statuses: z.array(z.unknown()).optional() })
            .safeParse(await statusRes.json());
          if (combined.success) {
            checks = parseCommitStatusesJson(combined.data.statuses ?? []);
          }
        } catch {
          /* keep empty */
        }
      }

      const activity: PullRequestActivity = {
        comments,
        reviews,
        checks,
        head_sha: pr.head.sha,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
      };
      pull.activity = activity;

      return { pull, diffFiles };
    },

    async postPullRequestComment(owner, repo, number, body) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await ghFetch(
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
      const merge_method = input?.mergeMethod ?? "merge";
      const res = await ghFetch(
        `/repos/${e}/${r}/pulls/${number}/merge`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merge_method }),
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
      const res = await ghFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
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
      const res = await ghFetch(
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
      const res = await ghFetch(
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
      const res = await ghFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
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
      if (input.title != null) payload.title = input.title;
      if (input.body != null) payload.body = input.body;
      if (input.draft != null) payload.draft = input.draft;
      const res = await ghFetch(`/repos/${e}/${r}/pulls/${number}`, token, {
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
      const res = await ghFetch(
        `/repos/${e}/${r}/pulls/${number}/update-branch`,
        token,
        {
          method: "PUT",
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
      const res = await ghFetch(
        `/repos/${e}/${r}/pulls/${number}/comments`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: input.body,
            path: input.path,
            line: input.line,
            side: input.side ?? "RIGHT",
          }),
        },
      );
      const c = z
        .object({
          id: z.number(),
          body: z.string(),
          path: z.string().nullable().optional(),
          line: z.number().nullable().optional(),
          diff_hunk: z.string().nullable().optional(),
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
        path: c.path ?? null,
        line: c.line ?? null,
        diff_hunk: c.diff_hunk ?? null,
      };
    },

    async deleteBranch(owner, repo, branch) {
      const e = encodeURIComponent(owner);
      const r = encodeURIComponent(repo);
      const res = await ghFetch(
        `/repos/${e}/${r}/git/refs/heads/${encodeURIComponent(branch)}`,
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
      const res = await ghFetch(
        `/repos/${e}/${r}/pulls/${number}/merge`,
        token,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
          },
          body: JSON.stringify({ merge_method: "merge" }),
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

export async function exchangeGitHubOAuthCode(code: string): Promise<{
  access_token: string;
  token_type: string;
  scope?: string;
}> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth is not configured");
  }
  const redirectUri = oauthCallbackUrl("github");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "GitHub token exchange failed",
    );
  }
  return {
    access_token: data.access_token,
    token_type: data.token_type || "bearer",
    scope: data.scope,
  };
}
