import { query, SCHEMA } from "@/lib/db";
import { isWorkspaceAdmin, type WorkspaceMembership } from "@/lib/rbac/workspace-access";
import { pullRequestChecksBlockMerge } from "@/lib/integrations/git/pr-checks";
import {
  isPrAuthorLogin,
  isReviewApproved,
  normalizeVcLogin,
} from "@/lib/integrations/git/pr-reviews";
import { resolvePlatformRepoContext } from "@/lib/integrations/git/vc-notifications";
import type { PullRequest, PullRequestActivityReview } from "@/types";

export type BranchProtectionRule = {
  id: string;
  project_id: string;
  branch_pattern: string;
  require_approval_count: number;
  require_status_checks: boolean;
  required_check_names: string[];
  block_force_push: boolean;
  allow_admin_bypass: boolean;
  created_at: string;
};

export type BranchProtectionRuleInput = Omit<
  BranchProtectionRule,
  "id" | "created_at"
>;

function mapRow(row: {
  id: string;
  project_id: string;
  branch_pattern: string;
  require_approval_count: number;
  require_status_checks: boolean;
  required_check_names: string[] | null;
  block_force_push: boolean;
  allow_admin_bypass: boolean;
  created_at: Date | string;
}): BranchProtectionRule {
  return {
    id: row.id,
    project_id: row.project_id,
    branch_pattern: row.branch_pattern,
    require_approval_count: row.require_approval_count,
    require_status_checks: row.require_status_checks,
    required_check_names: row.required_check_names ?? [],
    block_force_push: row.block_force_push,
    allow_admin_bypass: row.allow_admin_bypass,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export function branchMatchesPattern(
  branch: string,
  pattern: string,
): boolean {
  const b = branch.trim();
  const p = pattern.trim();
  if (!b || !p) return false;
  if (p === b) return true;
  if (p.endsWith("*")) {
    const prefix = p.slice(0, -1);
    return b.startsWith(prefix);
  }
  return false;
}

export async function loadRules(projectId: string): Promise<BranchProtectionRule[]> {
  const res = await query<{
    id: string;
    project_id: string;
    branch_pattern: string;
    require_approval_count: number;
    require_status_checks: boolean;
    required_check_names: string[] | null;
    block_force_push: boolean;
    allow_admin_bypass: boolean;
    created_at: Date | string;
  }>(
    `SELECT id, project_id, branch_pattern, require_approval_count,
            require_status_checks, required_check_names, block_force_push,
            allow_admin_bypass, created_at
     FROM ${SCHEMA}.vc_branch_protection_rules
     WHERE project_id = $1
     ORDER BY branch_pattern ASC`,
    [projectId],
  );
  return res.rows.map(mapRow);
}

export async function saveRules(
  projectId: string,
  rules: Omit<BranchProtectionRuleInput, "project_id">[],
): Promise<BranchProtectionRule[]> {
  await query(
    `DELETE FROM ${SCHEMA}.vc_branch_protection_rules WHERE project_id = $1`,
    [projectId],
  );
  for (const rule of rules) {
    await query(
      `INSERT INTO ${SCHEMA}.vc_branch_protection_rules (
         project_id, branch_pattern, require_approval_count,
         require_status_checks, required_check_names, block_force_push,
         allow_admin_bypass
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        projectId,
        rule.branch_pattern,
        rule.require_approval_count,
        rule.require_status_checks,
        rule.required_check_names ?? [],
        rule.block_force_push,
        rule.allow_admin_bypass,
      ],
    );
  }
  return loadRules(projectId);
}

function countApprovingReviews(
  reviews: PullRequestActivityReview[],
  authorLogin?: string | null,
): number {
  const latest = new Map<string, PullRequestActivityReview>();
  const sorted = [...reviews].sort((a, b) => {
    const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    return ta - tb;
  });
  for (const review of sorted) {
    latest.set(normalizeVcLogin(review.author_login), review);
  }
  let count = 0;
  for (const [login, review] of latest) {
    if (authorLogin && isPrAuthorLogin(login, authorLogin)) continue;
    if (isReviewApproved(review.state)) count += 1;
  }
  return count;
}

export function findMatchingRule(
  rules: BranchProtectionRule[],
  baseBranch: string,
): BranchProtectionRule | null {
  return (
    rules.find((rule) => branchMatchesPattern(baseBranch, rule.branch_pattern)) ??
    null
  );
}

export async function resolveProjectIdForRepo(
  workspaceId: string,
  owner: string,
  repo: string,
  projectIdFromRequest?: string | null,
): Promise<string | null> {
  if (projectIdFromRequest) return projectIdFromRequest;
  const fullName = `${owner}/${repo}`;
  const platform = await resolvePlatformRepoContext(fullName);
  if (platform) return platform.projectId;
  const linked = await query<{ project_id: string }>(
    `SELECT project_id
     FROM ${SCHEMA}.git_project_linked_repos
     WHERE workspace_id = $1 AND LOWER(repo_full_name) = LOWER($2)
     LIMIT 1`,
    [workspaceId, fullName],
  );
  return linked.rows[0]?.project_id ?? null;
}

export function assertMergeAllowed(params: {
  projectId: string | null;
  baseBranch: string;
  pull: PullRequest;
  membership: WorkspaceMembership;
  rules?: BranchProtectionRule[];
}): { allowed: boolean; reason?: string } {
  const { pull, membership, baseBranch } = params;
  const rules = params.rules ?? [];
  if (!params.projectId || rules.length === 0) {
    return { allowed: true };
  }

  const rule = findMatchingRule(rules, baseBranch);
  if (!rule) return { allowed: true };

  if (rule.allow_admin_bypass && isWorkspaceAdmin(membership)) {
    return { allowed: true };
  }

  const approvalCount = countApprovingReviews(
    pull.activity?.reviews ?? [],
    pull.author_id,
  );
  if (approvalCount < rule.require_approval_count) {
    return {
      allowed: false,
      reason: `Branch protection requires at least ${rule.require_approval_count} approving review(s); found ${approvalCount}.`,
    };
  }

  if (rule.require_status_checks) {
    const requiredNames =
      rule.required_check_names.length > 0
        ? rule.required_check_names
        : undefined;
    const checkGate = pullRequestChecksBlockMerge(
      pull.activity?.checks ?? [],
      requiredNames,
    );
    if (checkGate.blocked) {
      return {
        allowed: false,
        reason:
          checkGate.reason ??
          "Required status checks have not passed for this branch.",
      };
    }
  }

  return { allowed: true };
}
