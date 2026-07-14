import type { PullRequestActivity, PullRequestActivityReview } from "@/types";

export function normalizeVcLogin(login: string | null | undefined): string {
  return (login ?? "").trim().toLowerCase();
}

export function isSameVcLogin(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeVcLogin(a);
  const nb = normalizeVcLogin(b);
  return na.length > 0 && na === nb;
}

export function isReviewApproved(state: string): boolean {
  const s = state.toUpperCase();
  return s === "APPROVED" || s === "APPROVE";
}

export function isReviewChangesRequested(state: string): boolean {
  const s = state.toUpperCase();
  return s === "REQUEST_CHANGES" || s === "CHANGES_REQUESTED";
}

export function summarizePullReviews(
  reviews: PullRequestActivityReview[],
  authorLogin?: string | null,
): { hasApproval: boolean; hasBlockingChanges: boolean } {
  const latest = new Map<string, PullRequestActivityReview>();
  const sorted = [...reviews].sort((a, b) => {
    const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    return ta - tb;
  });
  for (const review of sorted) {
    latest.set(normalizeVcLogin(review.author_login), review);
  }

  let hasApproval = false;
  let hasBlockingChanges = false;
  for (const [login, review] of latest) {
    if (authorLogin && isSameVcLogin(login, authorLogin)) continue;
    if (isReviewApproved(review.state)) hasApproval = true;
    if (isReviewChangesRequested(review.state)) hasBlockingChanges = true;
  }

  return { hasApproval, hasBlockingChanges };
}

export function isPrAuthorLogin(
  login: string | null | undefined,
  authorLogin?: string | null,
  authorDisplayName?: string | null,
): boolean {
  if (!login) return false;
  return (
    isSameVcLogin(login, authorLogin) ||
    isSameVcLogin(login, authorDisplayName)
  );
}

export function pullRequestIsMergeableByReview(
  activity: PullRequestActivity | null | undefined,
  authorLogin?: string | null,
): boolean {
  const { hasApproval, hasBlockingChanges } = summarizePullReviews(
    activity?.reviews ?? [],
    authorLogin,
  );
  return hasApproval && !hasBlockingChanges;
}
