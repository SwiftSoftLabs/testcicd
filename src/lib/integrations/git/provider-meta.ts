import type { GitProvider } from "@/types/git";

export interface GitProviderMeta {
  slug: GitProvider;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  color: string;
  isPlatformManaged: boolean;
  supportsOAuth: boolean;
  supportsPAT: boolean;
  supportsDisconnect: boolean;
  usesMergeRequestNumber: boolean;
}

export const GIT_PROVIDER_META: Record<GitProvider, GitProviderMeta> = {
  onework: {
    slug: "onework",
    label: "OneWork Version Control",
    shortLabel: "OneWork",
    description:
      "Built-in Git for your workspace. Included with every project — no setup required.",
    icon: "account_tree",
    color: "6366f1",
    isPlatformManaged: true,
    supportsOAuth: false,
    supportsPAT: false,
    supportsDisconnect: false,
    usesMergeRequestNumber: true,
  },
  github: {
    slug: "github",
    label: "GitHub",
    shortLabel: "GitHub",
    description:
      "Sync repositories, track pull requests, and link commits directly to tasks.",
    icon: "github",
    color: "000000",
    isPlatformManaged: false,
    supportsOAuth: true,
    supportsPAT: true,
    supportsDisconnect: true,
    usesMergeRequestNumber: false,
  },
  gitlab: {
    slug: "gitlab",
    label: "GitLab",
    shortLabel: "GitLab",
    description:
      "Connect GitLab projects to Version Control: branches, commits, and merge requests.",
    icon: "gitlab",
    color: "FC6D26",
    isPlatformManaged: false,
    supportsOAuth: true,
    supportsPAT: true,
    supportsDisconnect: true,
    usesMergeRequestNumber: true,
  },
};

export function getProviderLabel(provider: GitProvider): string {
  return GIT_PROVIDER_META[provider].label;
}

export function getProviderShortLabel(provider: GitProvider): string {
  return GIT_PROVIDER_META[provider].shortLabel;
}

export function formatPullNumber(
  provider: GitProvider,
  number: number,
): string {
  return GIT_PROVIDER_META[provider].usesMergeRequestNumber
    ? `!${number}`
    : `#${number}`;
}

export function buildPullRequestWebUrl(
  provider: GitProvider,
  htmlUrl: string | null | undefined,
  owner: string,
  repo: string,
  number: number,
): string | null {
  if (htmlUrl) return htmlUrl;
  if (provider === "onework") {
    const base = process.env.ONEWORK_VC_GITEA_URL?.trim()?.replace(/\/$/, "");
    if (!base) return null;
    return `${base}/${owner}/${repo}/pulls/${number}`;
  }
  if (provider === "github") {
    return `https://github.com/${owner}/${repo}/pull/${number}`;
  }
  return `https://gitlab.com/${owner}/${repo}/-/merge_requests/${number}`;
}
