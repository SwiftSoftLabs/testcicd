import type { DiffFile, PullRequest } from "@/types";

export type GitProvider = "github" | "gitlab" | "onework";

export interface GitSshKey {
    id: string;
    provider: GitProvider;
    title: string;
    fingerprint: string;
    keyPreview?: string;
    createdAt: string;
    readOnly?: boolean;
}

export interface GitIntegrationAccount {
  provider: GitProvider;
  authMethod: "oauth" | "pat" | "platform";
  accountLogin: string;
  accountAvatarUrl: string | null;
  status: "connected" | "error" | "revoked";
  scopes: string[];
  connectedAt: string;
}

export interface GitIntegrationStatusResponse {
  onework: GitIntegrationAccount | null;
  github: GitIntegrationAccount | null;
  gitlab: GitIntegrationAccount | null;
  /** Server has OneWork VC (Gitea) configured */
  oneworkVcConfigured: boolean;
  /** Server has GitHub OAuth client id + secret configured */
  oauthGithubConfigured: boolean;
  /** Server has GitLab OAuth client id + secret configured */
  oauthGitlabConfigured: boolean;
  /** Provisioning failed for this user/workspace (retry via status reload) */
  oneworkProvisionError?: string | null;
  /** Gitea SSH host when OneWork VC is configured */
  oneworkSshHost?: string | null;
  /** Gitea SSH port when OneWork VC is configured */
  oneworkSshPort?: string | null;
}

export interface GitRepo {
  id: string;
  provider: GitProvider;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  license: string | null;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  stargazersCount: number;
  updatedAt: string;
}

export interface GitTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  lastCommitMessage?: string;
  lastCommitTime?: string;
}

/** Result of fetching a single file for preview (not used for directories). */
export interface GitFileTextResult {
  text: string | null;
  isBinary: boolean;
  htmlUrl?: string | null;
}

export interface GitBranchInfo {
  name: string;
  isDefault: boolean;
  lastCommitSha: string;
}

/** Commit list item for Version Control commits tab */
export interface GitCommitListItem {
  id: string;
  message: string;
  description?: string;
  created_at: string;
  author?: {
    full_name: string;
    avatar_url: string;
  };
}

/** Detail for selected commit */
export interface GitCommitDetail extends GitCommitListItem {
  files_changed: number;
  insertions: number;
  deletions: number;
  /** Parsed unified diffs per file (when the provider returns patch data). */
  diffFiles?: DiffFile[];
  /** Open this commit on GitHub/GitLab in the browser. */
  commitHtmlUrl?: string | null;
}

export interface GitReadmeResponse {
  content: string;
  encoding: "utf-8" | "base64";
}

/** Pull request list item mapped for UI (extends domain PullRequest where needed) */
export type GitPullRequestView = PullRequest;

export interface GitPullRequestDetailResponse {
  pullRequest: GitPullRequestView;
  diffFiles: DiffFile[];
}

/** Server-computed: compare branch is ahead of base and has no open PR/MR from that branch. */
export interface GitPullCreateHint {
  show: boolean;
  baseBranch: string;
  compareBranch: string;
  commitsAhead: number;
  /** Tip commit date on the compare side (ISO), when the provider returns it */
  lastActivityAt: string | null;
}

export type VercelDeploymentState =
  | "BUILDING"
  | "ERROR"
  | "INITIALIZING"
  | "QUEUED"
  | "READY"
  | "CANCELED"
  | "BLOCKED";

export interface GitRepoVercelDeploymentLink {
  id: string;
  project_id: string;
  workspace_id: string;
  git_provider: "onework";
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  vercel_project_id: string;
  vercel_project_name: string;
  production_branch: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GitRepoVercelDeploymentStatus {
  configured: boolean;
  vercelConnected: boolean;
  link: GitRepoVercelDeploymentLink | null;
  recentDeployments: GitRepoVercelDeploymentItem[];
}

export interface GitRepoVercelDeploymentItem {
  id: string;
  url: string | null;
  state: VercelDeploymentState | string;
  target: "production" | "preview" | null;
  branch: string | null;
  sha: string | null;
  createdAt: string;
}

export interface GitIntegrationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: GitProvider;
  auth_method: "oauth" | "pat" | "platform";
  account_login: string;
  account_id: string;
  account_avatar_url: string | null;
  scopes: string[];
  encrypted_token: string;
  encrypted_refresh: string | null;
  token_expires_at: string | null;
  status: "connected" | "error" | "revoked";
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}
