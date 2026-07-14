import { z } from "zod";

import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitListItem,
  GitRepo,
  GitTreeEntry,
  GitPullCreateHint,
} from "@/types/git";
import type {
  DiffFile,
  PullRequest,
  PullRequestActivity,
  PullRequestActivityCheck,
  PullRequestActivityComment,
  PullRequestActivityReview,
} from "@/types";
import { oauthCallbackUrl } from "./oauth";
import { mapGitlabMergeStatus } from "./pr-merge";
import { unifiedPatchToDiffFile } from "./parse-patch";
import { buildVcPullId } from "./vc-pull-id";
import type {
  GitProviderClient,
  ListCommitsOpts,
  ListPullsOpts,
  CreatePullRequestInput,
  AddRepoCollaboratorInput,
  AddRepoCollaboratorResult,
  RepoCollaborator,
  RepoCollaboratorPermission,
  MergePullRequestInput,
  SubmitPullRequestReviewInput,
} from "./provider";
import { UpstreamError, UpstreamRateLimitError } from "./errors";

const GITLAB_API = "https://gitlab.com/api/v4";

function gitlabAccessLevelFromPermission(
  permission: RepoCollaboratorPermission,
): number {
  switch (permission) {
    case "pull":
      return 20;
    case "triage":
      return 20;
    case "push":
      return 30;
    case "maintain":
      return 40;
    case "admin":
      return 50;
    default:
      return 30;
  }
}

function permissionFromGitlabAccessLevel(
  level: number,
): RepoCollaboratorPermission | string {
  if (level >= 50) return "admin";
  if (level >= 40) return "maintain";
  if (level >= 30) return "push";
  if (level >= 20) return "pull";
  return "pull";
}

function labelStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const o = x as { title?: unknown; name?: unknown };
        if (typeof o.title === "string") return o.title;
        if (typeof o.name === "string") return o.name;
      }
      return "";
    })
    .filter(Boolean);
}

function glHeaders(tok: string): HeadersInit {
  if (tok.startsWith("glpat-")) {
    return { "PRIVATE-TOKEN": tok };
  }
  return { Authorization: `Bearer ${tok}` };
}

async function glFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GITLAB_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...glHeaders(token),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    const sec = retry ? parseInt(retry, 10) : undefined;
    throw new UpstreamRateLimitError(
      "GitLab rate limit",
      Number.isFinite(sec) ? sec : undefined,
    );
  }
  return res;
}

function projectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export function createGitLabClient(accessToken: string): GitProviderClient {
  const token = accessToken;

  async function jsonOrThrow<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text();
      throw new UpstreamError(text || res.statusText, res.status);
    }
    return res.json() as Promise<T>;
  }

  return {
    async getViewer() {
      const res = await glFetch(token, "/user");
      const u = z
        .object({
          id: z.number(),
          username: z.string(),
          avatar_url: z.string().nullable().optional(),
        })
        .parse(await jsonOrThrow(res));
      return {
        id: String(u.id),
        login: u.username,
        avatarUrl: u.avatar_url ?? null,
      };
    },

    async listRepos({ q, page = 1, perPage = 30 }) {
      const res = await glFetch(
        token,
        `/projects?membership=true&per_page=${perPage}&page=${page}&order_by=updated_at&simple=true`,
      );
      const arr = z
        .array(
          z.object({
            id: z.number(),
            path_with_namespace: z.string(),
            path: z.string(),
            default_branch: z.string().optional().nullable(),
            description: z.string().nullable().optional(),
            web_url: z.string(),
            http_url_to_repo: z.string().optional(),
            ssh_url_to_repo: z.string().optional(),
            star_count: z.number().optional(),
            visibility: z.string().optional(),
            updated_at: z.string().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      let repos: GitRepo[] = arr.map((p): GitRepo => {
        const parts = p.path_with_namespace.split("/");
        const ownerSeg = parts[0] ?? "";
        const name = parts.slice(1).join("/") || p.path;
        return {
          id: String(p.id),
          provider: "gitlab",
          owner: ownerSeg,
          name,
          fullName: p.path_with_namespace,
          private: p.visibility === "private",
          defaultBranch: p.default_branch || "main",
          description: p.description ?? null,
          homepage: p.web_url,
          license: null,
          htmlUrl: p.web_url,
          cloneUrl: p.http_url_to_repo ?? `${p.web_url}.git`,
          sshUrl: p.ssh_url_to_repo ?? "",
          stargazersCount: p.star_count ?? 0,
          updatedAt: p.updated_at || new Date().toISOString(),
        };
      });
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
      const id = projectPath(owner, repo);
      const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const tryPaths = ["README.md", "readme.md"];
      for (const file of tryPaths) {
        const res = await glFetch(
          token,
          `/projects/${id}/repository/files/${encodeURIComponent(file)}/raw${refParam}`,
        );
        if (res.ok) {
          const text = await res.text();
          return { content: text, encoding: "utf-8" as const };
        }
      }
      return null;
    },

    async getTree(owner, repo, path, ref?) {
      const id = projectPath(owner, repo);
      const pathQ = path ? `&path=${encodeURIComponent(path)}` : "";
      const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : "";
      const res = await glFetch(
        token,
        `/projects/${id}/repository/tree?per_page=100${pathQ}${refParam}`,
      );
      if (res.status === 404) return [];
      const arr = z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            path: z.string(),
            type: z.enum(["tree", "blob"]),
          }),
        )
        .parse(await jsonOrThrow(res));
      const out: GitTreeEntry[] = arr.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.type === "tree" ? "folder" : "file",
      }));
      out.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    },

    async getFileText(owner, repo, filepath, ref?) {
      const id = projectPath(owner, repo);
      const trimmed = filepath.replace(/^\/+/, "");
      if (!trimmed) return null;
      const encodedPath = encodeURIComponent(trimmed);
      const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const res = await glFetch(
        token,
        `/projects/${id}/repository/files/${encodedPath}/raw${refParam}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new UpstreamError(text || res.statusText, res.status);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.includes(0) || buf.length > 900_000) {
        return { text: null, isBinary: true, htmlUrl: null };
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("image/") || ct === "application/octet-stream") {
        return { text: null, isBinary: true, htmlUrl: null };
      }
      const text = buf.toString("utf8");
      return { text, isBinary: false, htmlUrl: null };
    },

    async listBranches(owner, repo) {
      const id = projectPath(owner, repo);
      const resProj = await glFetch(token, `/projects/${id}`);
      const proj = z
        .object({ default_branch: z.string().optional().nullable() })
        .parse(await jsonOrThrow(resProj));
      const def = proj.default_branch || "main";
      const res = await glFetch(
        token,
        `/projects/${id}/repository/branches?per_page=100`,
      );
      const arr = z
        .array(
          z.object({
            name: z.string(),
            commit: z.object({ id: z.string() }),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map(
        (b): GitBranchInfo => ({
          name: b.name,
          isDefault: b.name === def,
          lastCommitSha: b.commit.id,
        }),
      );
    },

    async listCommits(owner, repo, opts: ListCommitsOpts) {
      const id = projectPath(owner, repo);
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 30;
      const refQ = opts.ref ? `&ref_name=${encodeURIComponent(opts.ref)}` : "";
      const res = await glFetch(
        token,
        `/projects/${id}/repository/commits?per_page=${perPage}&page=${page}${refQ}`,
      );
      const arr = z
        .array(
          z.object({
            id: z.string(),
            title: z.string().optional(),
            message: z.string(),
            authored_date: z.string().optional(),
            author_name: z.string().optional(),
            author_email: z.string().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map(
        (c): GitCommitListItem => ({
          id: c.id,
          message: c.title || c.message.split("\n")[0] || c.message,
          description: c.message.includes("\n")
            ? c.message.split("\n").slice(1).join("\n").trim()
            : undefined,
          created_at: c.authored_date || new Date().toISOString(),
          author: {
            full_name: c.author_name || c.author_email || "Unknown",
            avatar_url: "",
          },
        }),
      );
    },

    async getCommit(owner, repo, sha) {
      const id = projectPath(owner, repo);
      const shaEnc = encodeURIComponent(sha);
      const res = await glFetch(
        token,
        `/projects/${id}/repository/commits/${shaEnc}`,
      );
      const c = z
        .object({
          id: z.string(),
          title: z.string().optional(),
          message: z.string(),
          authored_date: z.string().optional(),
          author_name: z.string().optional(),
          stats: z
            .object({
              additions: z.number().optional(),
              deletions: z.number().optional(),
              total: z.number().optional(),
            })
            .optional(),
          web_url: z.string().optional(),
        })
        .parse(await jsonOrThrow(res));
      const lines = c.message.split("\n");

      let diffFiles: DiffFile[] = [];
      try {
        const diffRes = await glFetch(
          token,
          `/projects/${id}/repository/commits/${shaEnc}/diff`,
        );
        const diffs = z
          .array(
            z.object({
              old_path: z.string().nullable().optional(),
              new_path: z.string().nullable().optional(),
              diff: z.string().optional(),
              new_file: z.boolean().optional(),
              deleted_file: z.boolean().optional(),
            }),
          )
          .parse(await jsonOrThrow(diffRes));
        diffFiles = diffs.map((ch) => {
          const name =
            (ch.new_path || ch.old_path || "file").replace(/^\//, "") || "file";
          const st: "added" | "removed" | "modified" = ch.new_file
            ? "added"
            : ch.deleted_file
              ? "removed"
              : "modified";
          return unifiedPatchToDiffFile(name, ch.diff, { status: st });
        });
      } catch {
        diffFiles = [];
      }

      return {
        id: c.id,
        message: c.title || lines[0] || c.message,
        description: lines.slice(1).join("\n").trim() || undefined,
        created_at: c.authored_date || new Date().toISOString(),
        author: {
          full_name: c.author_name || "Unknown",
          avatar_url: "",
        },
        files_changed:
          typeof c.stats?.total === "number"
            ? Math.max(c.stats.total, 0)
            : diffFiles.length,
        insertions: c.stats?.additions ?? 0,
        deletions: c.stats?.deletions ?? 0,
        diffFiles,
        commitHtmlUrl: c.web_url ?? null,
      } satisfies GitCommitDetail;
    },

    async listPullRequests(owner, repo, opts: ListPullsOpts) {
      const id = projectPath(owner, repo);
      const state = opts.state === "open" ? "opened" : "closed";
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 30;
      const res = await glFetch(
        token,
        `/projects/${id}/merge_requests?state=${state}&per_page=${perPage}&page=${page}`,
      );
      const arr = z
        .array(
          z.object({
            iid: z.number(),
            title: z.string(),
            description: z.string().nullable().optional(),
            state: z.string(),
            source_branch: z.string(),
            target_branch: z.string(),
            author: z
              .object({
                username: z.string(),
                avatar_url: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
            created_at: z.string(),
            labels: z.array(z.unknown()).optional(),
            merge_status: z.string().optional(),
            draft: z.boolean().optional(),
          }),
        )
        .parse(await jsonOrThrow(res));
      return arr.map((mr): PullRequest => {
        const fn = `${owner}/${repo}`;
        const mergeMeta = mapGitlabMergeStatus(mr.merge_status);
        return {
          id: buildVcPullId("gitlab", fn, mr.iid),
          project_id: "",
          author_id: mr.author?.username || "",
          title: mr.title,
          description: mr.description || "",
          status:
            mr.state === "merged"
              ? "Merged"
              : mr.state === "opened"
                ? "In Review"
                : "Changes Requested",
          base_branch: mr.target_branch,
          compare_branch: mr.source_branch,
          is_open: mr.state === "opened",
          is_draft: mr.draft === true,
          mergeable: mergeMeta.mergeable,
          mergeable_state: mergeMeta.mergeable_state,
          labels: labelStrings(mr.labels),
          created_at: mr.created_at,
          author: mr.author
            ? {
                full_name: mr.author.username,
                avatar_url: mr.author.avatar_url || "",
              }
            : undefined,
          commits_count: 0,
          files_changed_count: 0,
        };
      });
    },

    async createPullRequest(owner, repo, input: CreatePullRequestInput) {
      const id = projectPath(owner, repo);
      const res = await glFetch(token, `/projects/${id}/merge_requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          description: input.body || "",
          source_branch: input.head,
          target_branch: input.base,
        }),
      });
      const mr = z
        .object({
          iid: z.number(),
          title: z.string(),
          description: z.string().nullable().optional(),
          state: z.string(),
          source_branch: z.string(),
          target_branch: z.string(),
          author: z
            .object({
              username: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          created_at: z.string(),
          labels: z.array(z.unknown()).optional(),
          web_url: z.string().optional(),
        })
        .parse(await jsonOrThrow(res));
      const fn = `${owner}/${repo}`;
      const merged = mr.state === "merged";
      const isOpen = mr.state === "opened";
      return {
        id: buildVcPullId("gitlab", fn, mr.iid),
        project_id: "",
        author_id: mr.author?.username || "",
        title: mr.title,
        description: mr.description || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: mr.target_branch,
        compare_branch: mr.source_branch,
        is_open: isOpen,
        labels: labelStrings(mr.labels),
        created_at: mr.created_at,
        author: mr.author
          ? {
              full_name: mr.author.username,
              avatar_url: mr.author.avatar_url || "",
            }
          : undefined,
        commits_count: 0,
        files_changed_count: 0,
        html_url: mr.web_url ?? null,
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

      const id = projectPath(owner, repo);

      const mrsRes = await glFetch(
        token,
        `/projects/${id}/merge_requests?state=opened&source_branch=${encodeURIComponent(compare)}&per_page=1`,
      );
      if (!mrsRes.ok) return none();
      const mrs = z.array(z.unknown()).parse(await jsonOrThrow(mrsRes));
      if (mrs.length > 0) return none();

      const cmpRes = await glFetch(
        token,
        `/projects/${id}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(compare)}`,
      );
      if (!cmpRes.ok) return none();
      const data = z
        .object({
          commits: z
            .array(
              z.object({
                authored_date: z.string().optional(),
                committed_date: z.string().optional(),
                created_at: z.string().optional(),
              }),
            )
            .optional()
            .default([]),
        })
        .parse(await jsonOrThrow(cmpRes));

      const list = data.commits ?? [];
      if (list.length === 0) return none();

      const tip = list[list.length - 1];
      const lastActivityAt =
        tip.committed_date ?? tip.authored_date ?? tip.created_at ?? null;

      return {
        show: true,
        baseBranch: base,
        compareBranch: compare,
        commitsAhead: list.length,
        lastActivityAt,
      };
    },

    async addRepositoryCollaborator(
      owner,
      repo,
      input: AddRepoCollaboratorInput,
    ): Promise<AddRepoCollaboratorResult> {
      const username = input.username.trim().replace(/^@/, "");
      if (!username) throw new UpstreamError("Username is required", 400);

      const usersRes = await glFetch(
        token,
        `/users?username=${encodeURIComponent(username)}`,
      );
      if (!usersRes.ok) {
        const text = await usersRes.text();
        throw new UpstreamError(text || usersRes.statusText, usersRes.status);
      }
      const usersArr = z
        .array(z.object({ id: z.number(), username: z.string() }))
        .parse(await usersRes.json());
      const match = usersArr.find(
        (u) => u.username.toLowerCase() === username.toLowerCase(),
      );
      if (!match) {
        throw new UpstreamError(
          `No GitLab user found with username "${username}".`,
          404,
        );
      }

      const accessLevel = gitlabAccessLevelFromPermission(input.permission);
      const id = projectPath(owner, repo);
      const res = await glFetch(token, `/projects/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: match.id, access_level: accessLevel }),
      });

      if (res.status === 201) {
        return {
          ok: true,
          invitationPending: true,
          message: `Added ${match.username} to this project with the selected access level.`,
        };
      }
      if (res.status === 409) {
        const text = await res.text();
        return {
          ok: true,
          alreadyCollaborator: true,
          message:
            text && text.length < 400
              ? text
              : `${match.username} is already a project member or has a pending invitation.`,
        };
      }

      const text = await res.text();
      if (!res.ok) {
        throw new UpstreamError(text || res.statusText, res.status);
      }
      return {
        ok: true,
        invitationPending: true,
        message: `Added ${match.username} to this project.`,
      };
    },

    async listRepositoryCollaborators(
      owner,
      repo,
    ): Promise<RepoCollaborator[]> {
      const id = projectPath(owner, repo);
      const res = await glFetch(token, `/projects/${id}/members/all?per_page=100`);
      if (!res.ok) {
        const text = await res.text();
        throw new UpstreamError(text || res.statusText, res.status);
      }
      const arr = z
        .array(
          z.object({
            id: z.number(),
            username: z.string(),
            avatar_url: z.string().nullable().optional(),
            web_url: z.string().optional(),
            access_level: z.number(),
          }),
        )
        .parse(await res.json());
      return arr.map((u) => ({
        id: String(u.id),
        login: u.username,
        avatarUrl: u.avatar_url ?? null,
        permission: permissionFromGitlabAccessLevel(u.access_level),
        htmlUrl: u.web_url ?? null,
      }));
    },

    async removeRepositoryCollaborator(owner, repo, username) {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new UpstreamError("Username is required", 400);
      const usersRes = await glFetch(
        token,
        `/users?username=${encodeURIComponent(u)}`,
      );
      if (!usersRes.ok) {
        const text = await usersRes.text();
        throw new UpstreamError(text || usersRes.statusText, usersRes.status);
      }
      const usersArr = z
        .array(z.object({ id: z.number(), username: z.string() }))
        .parse(await usersRes.json());
      const match = usersArr.find(
        (x) => x.username.toLowerCase() === u.toLowerCase(),
      );
      if (!match) {
        throw new UpstreamError(`No GitLab user found with username "${u}".`, 404);
      }
      const id = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${id}/members/${match.id}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        const text = await res.text();
        throw new UpstreamError(text || res.statusText, res.status);
      }
    },

    async getPullRequestDetail(owner, repo, number) {
      const id = projectPath(owner, repo);
      const [resChanges, resMr, resNotes, resApprovals, resPipelines] =
        await Promise.all([
          glFetch(token, `/projects/${id}/merge_requests/${number}/changes`),
          glFetch(token, `/projects/${id}/merge_requests/${number}`),
          glFetch(
            token,
            `/projects/${id}/merge_requests/${number}/notes?per_page=100`,
          ),
          glFetch(token, `/projects/${id}/merge_requests/${number}/approvals`),
          glFetch(
            token,
            `/projects/${id}/merge_requests/${number}/pipelines?per_page=20`,
          ),
        ]);

      const data = z
        .object({
          title: z.string(),
          description: z.string().nullable().optional(),
          state: z.string(),
          source_branch: z.string(),
          target_branch: z.string(),
          author: z
            .object({
              username: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .nullable()
            .optional(),
          created_at: z.string(),
          labels: z.array(z.unknown()).optional(),
          changes: z.array(
            z.object({
              new_path: z.string(),
              old_path: z.string(),
              diff: z.string().optional(),
            }),
          ),
        })
        .parse(await jsonOrThrow(resChanges));

      let mrSha: string | null = null;
      let mergeStatus = "";
      let webUrl: string | null = null;
      let isDraft = false;
      let headPipeline: {
        id: number;
        status: string;
        web_url: string | null;
      } | null = null;
      if (resMr.ok) {
        const meta = z
          .object({
            sha: z.string(),
            merge_status: z.string(),
            web_url: z.string().optional(),
            work_in_progress: z.boolean().optional(),
            draft: z.boolean().optional(),
            head_pipeline: z
              .object({
                id: z.number(),
                status: z.string(),
                web_url: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
          })
          .safeParse(await resMr.json());
        if (meta.success) {
          mrSha = meta.data.sha;
          mergeStatus = meta.data.merge_status;
          webUrl = meta.data.web_url ?? null;
          isDraft =
            meta.data.draft === true || meta.data.work_in_progress === true;
          headPipeline = meta.data.head_pipeline
            ? {
                id: meta.data.head_pipeline.id,
                status: meta.data.head_pipeline.status,
                web_url: meta.data.head_pipeline.web_url ?? null,
              }
            : null;
        }
      }

      const diffFiles = data.changes.map((ch) => {
        const name =
          ch.new_path && ch.new_path !== ""
            ? ch.new_path
            : ch.old_path || "unknown";
        return unifiedPatchToDiffFile(name, ch.diff);
      });

      const merged = data.state === "merged";
      const isOpen = data.state === "opened";
      const mergeMeta = mapGitlabMergeStatus(mergeStatus);

      const pull: PullRequest = {
        id: buildVcPullId("gitlab", `${owner}/${repo}`, number),
        project_id: "",
        author_id: data.author?.username || "",
        title: data.title,
        description: data.description || "",
        status: merged ? "Merged" : isOpen ? "In Review" : "Changes Requested",
        base_branch: data.target_branch,
        compare_branch: data.source_branch,
        is_open: isOpen,
        is_draft: isDraft,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
        labels: labelStrings(data.labels),
        created_at: data.created_at,
        author: data.author
          ? {
              full_name: data.author.username,
              avatar_url: data.author.avatar_url || "",
            }
          : undefined,
        commits_count: 0,
        files_changed_count: diffFiles.length,
        diffFiles,
        html_url: webUrl,
      };

      const comments: PullRequestActivityComment[] = [];
      if (resNotes.ok) {
        const arr = z
          .array(
            z.object({
              id: z.number(),
              body: z.string(),
              system: z.boolean().optional(),
              author: z
                .object({
                  username: z.string(),
                  avatar_url: z.string().nullable().optional(),
                })
                .optional(),
              created_at: z.string(),
            }),
          )
          .safeParse(await resNotes.json());
        if (arr.success) {
          for (const n of arr.data) {
            if (n.system) continue;
            if (!n.body?.trim()) continue;
            comments.push({
              id: String(n.id),
              body: n.body,
              author_login: n.author?.username || "unknown",
              author_avatar_url: n.author?.avatar_url || "",
              created_at: n.created_at,
              html_url: null,
            });
          }
        }
      }

      const reviews: PullRequestActivityReview[] = [];
      if (resApprovals.ok) {
        const appr = z
          .object({
            approved_by: z
              .array(
                z.object({
                  user: z.object({ username: z.string() }),
                }),
              )
              .optional(),
          })
          .safeParse(await resApprovals.json());
        if (appr.success && appr.data.approved_by?.length) {
          for (const row of appr.data.approved_by) {
            reviews.push({
              id: `gl-approval-${row.user.username}`,
              author_login: row.user.username,
              state: "APPROVED",
              body: "",
              submitted_at: null,
            });
          }
        }
      }

      const checks: PullRequestActivityCheck[] = [];
      const pushPipelineCheck = (
        p: { id: number; status: string; web_url: string | null },
        name: string,
      ) => {
        const st = p.status.toLowerCase();
        let conclusion: string | null = null;
        if (st === "success") conclusion = "success";
        else if (st === "failed") conclusion = "failure";
        else if (st === "canceled" || st === "cancelled" || st === "skipped")
          conclusion = st;
        checks.push({
          id: String(p.id),
          name,
          status: p.status,
          conclusion,
          html_url: p.web_url,
        });
      };
      if (headPipeline) {
        pushPipelineCheck(headPipeline, "Pipeline (head)");
      }
      if (resPipelines.ok) {
        const pipes = z
          .array(
            z.object({
              id: z.number(),
              status: z.string(),
              web_url: z.string().nullable().optional(),
            }),
          )
          .safeParse(await resPipelines.json());
        if (pipes.success) {
          for (const p of pipes.data) {
            if (headPipeline && p.id === headPipeline.id) continue;
            pushPipelineCheck(
              { id: p.id, status: p.status, web_url: p.web_url ?? null },
              `Pipeline #${p.id}`,
            );
          }
        }
      }

      const activity: PullRequestActivity = {
        comments,
        reviews,
        checks,
        head_sha: mrSha,
        mergeable: mergeMeta.mergeable,
        mergeable_state: mergeMeta.mergeable_state,
      };
      pull.activity = activity;

      return { pull, diffFiles };
    },

    async postPullRequestComment(owner, repo, number, body) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      const n = z
        .object({
          id: z.number(),
          body: z.string(),
          author: z
            .object({
              username: z.string(),
              avatar_url: z.string().nullable().optional(),
            })
            .optional(),
          created_at: z.string(),
        })
        .parse(await jsonOrThrow(res));
      return {
        id: String(n.id),
        body: n.body,
        author_login: n.author?.username || "unknown",
        author_avatar_url: n.author?.avatar_url || "",
        created_at: n.created_at,
        html_url: null,
      };
    },

    async mergePullRequest(owner, repo, number, input?: MergePullRequestInput) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}/merge`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            squash: input?.squash === true,
            should_remove_source_branch: false,
          }),
        },
      );
      await jsonOrThrow(res);
    },

    async closePullRequest(owner, repo, number) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state_event: "close" }),
        },
      );
      await jsonOrThrow(res);
    },

    async submitPullRequestReview(
      owner,
      repo,
      number,
      input: SubmitPullRequestReviewInput,
    ) {
      const pid = projectPath(owner, repo);
      if (input.event === "APPROVE") {
        const res = await glFetch(
          token,
          `/projects/${pid}/merge_requests/${number}/approve`,
          {
            method: "POST",
          },
        );
        await jsonOrThrow(res);
        return;
      }
      const prefix =
        input.event === "REQUEST_CHANGES"
          ? "**Requested changes**\n\n"
          : input.event === "COMMENT"
            ? ""
            : "";
      const text = `${prefix}${input.body?.trim() ?? ""}`.trim();
      if (!text) {
        throw new UpstreamError("Review comment body is required", 400);
      }
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        },
      );
      await jsonOrThrow(res);
    },

    async requestPullRequestReviewers(owner, repo, number, reviewers) {
      const pid = projectPath(owner, repo);
      const usernames = reviewers
        .map((u) => u.trim().replace(/^@/, ""))
        .filter(Boolean);
      if (usernames.length === 0) {
        throw new UpstreamError("At least one reviewer is required", 400);
      }
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewer_usernames: usernames }),
        },
      );
      await jsonOrThrow(res);
    },

    async reopenPullRequest(owner, repo, number) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state_event: "reopen" }),
        },
      );
      await jsonOrThrow(res);
    },

    async updatePullRequest(
      owner,
      repo,
      number,
      input: import("./provider").UpdatePullRequestInput,
    ) {
      const pid = projectPath(owner, repo);
      const payload: Record<string, unknown> = {};
      if (input.title != null) payload.title = input.title;
      if (input.body != null) payload.description = input.body;
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      await jsonOrThrow(res);
    },

    async updatePullRequestBranch(owner, repo, number) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}/merge_ref`,
        { method: "PUT" },
      );
      await jsonOrThrow(res);
    },

    async postPullRequestReviewComment(
      owner,
      repo,
      number,
      input: import("./provider").PostPullRequestReviewCommentInput,
    ) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/merge_requests/${number}/discussions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: input.body,
            position: {
              base_sha: "",
              start_sha: "",
              head_sha: "",
              position_type: "text",
              new_path: input.path,
              new_line: input.line,
            },
          }),
        },
      );
      const data = z
        .object({
          id: z.string(),
          notes: z
            .array(
              z.object({
                id: z.number(),
                body: z.string(),
                created_at: z.string().optional(),
                position: z
                  .object({
                    new_path: z.string().nullable().optional(),
                    new_line: z.number().nullable().optional(),
                  })
                  .nullable()
                  .optional(),
              }),
            )
            .optional(),
        })
        .parse(await jsonOrThrow(res));
      const note = data.notes?.[0];
      return {
        id: String(note?.id ?? data.id),
        body: note?.body ?? input.body,
        author_login: "unknown",
        author_avatar_url: "",
        created_at: note?.created_at ?? new Date().toISOString(),
        html_url: null,
        path: note?.position?.new_path ?? input.path,
        line: note?.position?.new_line ?? input.line,
        diff_hunk: null,
      };
    },

    async deleteBranch(owner, repo, branch) {
      const pid = projectPath(owner, repo);
      const res = await glFetch(
        token,
        `/projects/${pid}/repository/branches/${encodeURIComponent(branch)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        await jsonOrThrow(res);
      }
    },
  };
}

export async function exchangeGitLabOAuthCode(code: string): Promise<{
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}> {
  const clientId = process.env.GITLAB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITLAB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GitLab OAuth is not configured");
  }
  const redirectUri = oauthCallbackUrl("gitlab");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://gitlab.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || "GitLab token exchange failed");
  }
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
  };
}
