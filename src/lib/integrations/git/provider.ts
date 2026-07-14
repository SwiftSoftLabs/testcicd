import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitListItem,
  GitFileTextResult,
  GitProvider,
  GitPullCreateHint,
  GitReadmeResponse,
  GitRepo,
  GitTreeEntry,
} from "@/types/git";
import type {
  DiffFile,
  PullRequest,
  PullRequestActivityComment,
} from "@/types";

export type PullRequestReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface MergePullRequestInput {
  /** GitHub: merge | squash | rebase */
  mergeMethod?: "merge" | "squash" | "rebase";
  /** GitLab: squash merge */
  squash?: boolean;
  /** Delete head branch after a successful merge */
  deleteBranchAfterMerge?: boolean;
}

export interface UpdatePullRequestInput {
  title?: string;
  body?: string;
  draft?: boolean;
}

export interface PostPullRequestReviewCommentInput {
  body: string;
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
}

export interface SubmitPullRequestReviewInput {
  event: PullRequestReviewEvent;
  body?: string;
}

export interface ListCommitsOpts {
  ref?: string;
  page?: number;
  perPage?: number;
}

export interface ListPullsOpts {
  state: "open" | "closed";
  page?: number;
  perPage?: number;
}

export interface CreatePullRequestInput {
  title: string;
  body: string;
  base: string;
  head: string;
  draft?: boolean;
}

/** GitHub permission names; GitLab maps to access_level in the client. */
export type RepoCollaboratorPermission =
  | "pull"
  | "triage"
  | "push"
  | "maintain"
  | "admin";

export interface AddRepoCollaboratorInput {
  username: string;
  permission: RepoCollaboratorPermission;
}

export interface AddRepoCollaboratorResult {
  ok: true;
  /** True when GitHub returned 204 (user already had access). */
  alreadyCollaborator?: boolean;
  /** True when a pending invitation was created (GitHub 201). */
  invitationPending?: boolean;
  message: string;
}

export interface RepoCollaborator {
  id: string;
  login: string;
  avatarUrl: string | null;
  permission: RepoCollaboratorPermission | string;
  htmlUrl?: string | null;
}

export interface GitProviderClient {
  getViewer(): Promise<{ id: string; login: string; avatarUrl: string | null }>;
  listRepos(opts: {
    q?: string;
    page?: number;
    perPage?: number;
  }): Promise<GitRepo[]>;
  getReadme(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitReadmeResponse | null>;
  getTree(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitTreeEntry[]>;
  getFileText(
    owner: string,
    repo: string,
    filepath: string,
    ref?: string,
  ): Promise<GitFileTextResult | null>;
  listBranches(owner: string, repo: string): Promise<GitBranchInfo[]>;
  listCommits(
    owner: string,
    repo: string,
    opts: ListCommitsOpts,
  ): Promise<GitCommitListItem[]>;
  getCommit(owner: string, repo: string, sha: string): Promise<GitCommitDetail>;
  listPullRequests(
    owner: string,
    repo: string,
    opts: ListPullsOpts,
  ): Promise<PullRequest[]>;
  getPullRequestDetail(
    owner: string,
    repo: string,
    number: number,
  ): Promise<{
    pull: PullRequest;
    diffFiles: DiffFile[];
  }>;
  postPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<PullRequestActivityComment>;
  mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    input?: MergePullRequestInput,
  ): Promise<void>;
  closePullRequest(owner: string, repo: string, number: number): Promise<void>;
  submitPullRequestReview(
    owner: string,
    repo: string,
    number: number,
    input: SubmitPullRequestReviewInput,
  ): Promise<void>;
  requestPullRequestReviewers?(
    owner: string,
    repo: string,
    number: number,
    reviewers: string[],
  ): Promise<void>;
  createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequest>;
  getPullCreateHint(
    owner: string,
    repo: string,
    base: string,
    compare: string,
  ): Promise<GitPullCreateHint>;
  addRepositoryCollaborator(
    owner: string,
    repo: string,
    input: AddRepoCollaboratorInput,
  ): Promise<AddRepoCollaboratorResult>;
  listRepositoryCollaborators(
    owner: string,
    repo: string,
  ): Promise<RepoCollaborator[]>;
  removeRepositoryCollaborator?(
    owner: string,
    repo: string,
    username: string,
  ): Promise<void>;
  updatePullRequest?(
    owner: string,
    repo: string,
    number: number,
    input: UpdatePullRequestInput,
  ): Promise<void>;
  reopenPullRequest?(owner: string, repo: string, number: number): Promise<void>;
  updatePullRequestBranch?(
    owner: string,
    repo: string,
    number: number,
  ): Promise<void>;
  postPullRequestReviewComment?(
    owner: string,
    repo: string,
    number: number,
    input: PostPullRequestReviewCommentInput,
  ): Promise<PullRequestActivityComment>;
  deleteBranch?(owner: string, repo: string, branch: string): Promise<void>;
  enablePullRequestAutoMerge?(
    owner: string,
    repo: string,
    number: number,
  ): Promise<void>;
}

export type { GitProvider };
