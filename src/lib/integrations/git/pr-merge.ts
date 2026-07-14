import type {
  PullRequest,
  PullRequestActivity,
  PullRequestMergeableState,
} from "@/types";

export type PullMergeability = {
  state: PullRequestMergeableState;
  hasConflicts: boolean;
  isChecking: boolean;
  isBlocked: boolean;
  canAttemptMerge: boolean;
};

function resolveMergeableState(
  pr: Pick<PullRequest, "mergeable" | "mergeable_state"> & {
    activity?: PullRequestActivity | null;
  },
): PullRequestMergeableState {
  const explicit = pr.mergeable_state ?? pr.activity?.mergeable_state ?? null;
  if (explicit) return explicit;

  const mergeable = pr.mergeable ?? pr.activity?.mergeable ?? null;
  if (mergeable === true) return "mergeable";
  if (mergeable === false) return "conflicting";
  return "unknown";
}

export function getPullMergeability(
  pr: Pick<PullRequest, "mergeable" | "mergeable_state" | "is_open" | "status"> & {
    activity?: PullRequestActivity | null;
  },
): PullMergeability {
  const state = resolveMergeableState(pr);
  const hasConflicts = state === "conflicting";
  const isChecking = state === "unknown" || state === "checking";
  const isBlocked = state === "blocked";
  const mergeClosed =
    pr.is_open === false || pr.status === "Merged";

  return {
    state,
    hasConflicts,
    isChecking,
    isBlocked,
    canAttemptMerge: !mergeClosed && !hasConflicts && !isChecking && !isBlocked,
  };
}

export function pullRequestHasMergeConflicts(
  pr:
    | (Pick<PullRequest, "mergeable" | "mergeable_state" | "activity" | "is_open" | "status"> & {
        activity?: PullRequestActivity | null;
      })
    | PullRequestActivity
    | null
    | undefined,
): boolean {
  if (!pr) return false;
  if ("comments" in pr) {
    return getPullMergeability({
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      is_open: true,
      status: "In Review",
      activity: pr,
    }).hasConflicts;
  }
  return getPullMergeability({
    mergeable: pr.mergeable,
    mergeable_state: pr.mergeable_state,
    is_open: pr.is_open ?? true,
    status: pr.status ?? "In Review",
    activity: pr.activity,
  }).hasConflicts;
}

export function pullRequestIsMergeBlockedByConflicts(
  pr: Parameters<typeof getPullMergeability>[0] | null | undefined,
): boolean {
  if (!pr) return false;
  const m = getPullMergeability(pr);
  return m.hasConflicts || m.isChecking || m.isBlocked;
}

export function mapGithubMergeableState(
  mergeable: boolean | null | undefined,
  mergeableState: string | null | undefined,
): {
  mergeable: boolean | null;
  mergeable_state: PullRequestMergeableState;
} {
  const raw = (mergeableState ?? "").toLowerCase();
  if (raw === "dirty") {
    return { mergeable: false, mergeable_state: "conflicting" };
  }
  if (raw === "blocked") {
    return { mergeable: false, mergeable_state: "blocked" };
  }
  if (raw === "clean") {
    return { mergeable: true, mergeable_state: "mergeable" };
  }
  if (raw === "unknown" || raw === "has_higher_priority") {
    return {
      mergeable: typeof mergeable === "boolean" ? mergeable : null,
      mergeable_state: "checking",
    };
  }
  if (typeof mergeable === "boolean") {
    return {
      mergeable,
      mergeable_state: mergeable ? "mergeable" : "conflicting",
    };
  }
  return { mergeable: null, mergeable_state: "unknown" };
}

export function mapGitlabMergeStatus(status: string | null | undefined): {
  mergeable: boolean | null;
  mergeable_state: PullRequestMergeableState;
} {
  const s = (status ?? "").toLowerCase();
  if (s === "can_be_merged") {
    return { mergeable: true, mergeable_state: "mergeable" };
  }
  if (s === "cannot_be_merged") {
    return { mergeable: false, mergeable_state: "conflicting" };
  }
  if (s === "checking" || s === "unchecked") {
    return { mergeable: null, mergeable_state: "checking" };
  }
  return { mergeable: null, mergeable_state: "unknown" };
}

export function mapGiteaMergeable(mergeable: boolean | null | undefined): {
  mergeable: boolean | null;
  mergeable_state: PullRequestMergeableState;
} {
  if (typeof mergeable === "boolean") {
    return {
      mergeable,
      mergeable_state: mergeable ? "mergeable" : "conflicting",
    };
  }
  return { mergeable: null, mergeable_state: "unknown" };
}
