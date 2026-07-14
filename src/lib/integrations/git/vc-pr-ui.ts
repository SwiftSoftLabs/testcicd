import { parseVcPullId } from "@/lib/integrations/git/vc-pull-id";
import {
  buildPullRequestWebUrl,
  formatPullNumber,
} from "@/lib/integrations/git/provider-meta";
import type { PullRequest } from "@/types";
import type { GitProvider } from "@/types/git";

export type PRDetailTab = "conversation" | "files";

export function prLabel(pr: PullRequest): string {
  const parsed = parseVcPullId(pr.id);
  if (!parsed) return pr.id.slice(0, 12);
  return formatPullNumber(parsed.provider, parsed.number);
}

/** External provider URL (GitHub/GitLab only — not for onework). */
export function prExternalProviderUrl(pr: PullRequest): string | null {
  if (pr.html_url) return pr.html_url;
  const p = parseVcPullId(pr.id);
  if (!p || p.provider === "onework") return null;
  const slash = p.fullName.indexOf("/");
  if (slash < 0) return null;
  const o = p.fullName.slice(0, slash);
  const r = p.fullName.slice(slash + 1);
  return buildPullRequestWebUrl(p.provider, null, o, r, p.number);
}

export function resolvePrProvider(
  pr: PullRequest | null,
  fallback: GitProvider,
): GitProvider {
  const parsed = pr ? parseVcPullId(pr.id) : null;
  return parsed?.provider ?? fallback;
}

export function resolvePrNumber(pr: PullRequest | null): number | null {
  const parsed = pr ? parseVcPullId(pr.id) : null;
  return parsed?.number ?? null;
}
