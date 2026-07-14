import { NextResponse } from 'next/server';

import { getGitClientForUser } from '@/lib/integrations/git/client-factory';
import {
    assertMergeAllowed,
    findMatchingRule,
    loadRules,
    resolveProjectIdForRepo,
} from '@/lib/integrations/git/branch-protection';
import { mergePullBodySchema, ownerRepoParamsSchema } from '@/lib/integrations/git/schemas';
import { pullRequestChecksBlockMerge } from '@/lib/integrations/git/pr-checks';
import { pullRequestHasMergeConflicts } from '@/lib/integrations/git/pr-merge';
import { pullRequestIsMergeableByReview } from '@/lib/integrations/git/pr-reviews';
import {
    jsonError,
    mapUpstreamError,
    parseProviderParam,
    parseZodError,
    rateLimitGit,
    requireSessionUser,
} from '@/lib/integrations/git/route-helpers';
import { getWorkspaceMembership, memberCan } from '@/lib/rbac/workspace-access';
import { notifyWorkspaceVcEvent } from '@/lib/integrations/git/vc-notifications';

export async function POST(
    request: Request,
    context: { params: Promise<{ provider: string; owner: string; repo: string; number: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        if (!user) return jsonError(401, 'Unauthorized');

        const params = await context.params;
        const provider = parseProviderParam(params.provider);
        const owner = decodeURIComponent(params.owner);
        const repo = decodeURIComponent(params.repo);
        ownerRepoParamsSchema.parse({ owner, repo });

        const n = Number(params.number);
        if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
            return jsonError(400, 'Invalid pull request number');
        }

        const body = mergePullBodySchema.parse(await request.json());

        const membership = await getWorkspaceMembership(body.workspaceId, user.id);
        if (!membership) return jsonError(404, 'Workspace not found or access denied');
        if (!memberCan(membership, 'merge_pull_requests')) {
            return jsonError(403, 'You do not have permission to merge pull requests.');
        }

        const limited = await rateLimitGit(user.id, provider);
        if (limited) return limited;

        const client = await getGitClientForUser(body.workspaceId, user.id, provider);

        const { pull } = await client.getPullRequestDetail(owner, repo, n);
        if (!pull.is_open || pull.status === 'Merged') {
            return jsonError(409, 'This pull request is already closed or merged.');
        }
        if (pullRequestHasMergeConflicts(pull)) {
            return jsonError(
                409,
                'This pull request has merge conflicts and cannot be merged until they are resolved.',
            );
        }
        if (!pullRequestIsMergeableByReview(pull.activity, pull.author_id)) {
            return jsonError(
                409,
                'This pull request must be approved before it can be merged.',
            );
        }

        const projectId = await resolveProjectIdForRepo(
            body.workspaceId,
            owner,
            repo,
            body.projectId,
        );
        const rules = projectId ? await loadRules(projectId) : [];
        const matchingRule = findMatchingRule(rules, pull.base_branch);
        const requiredCheckNames =
            matchingRule?.require_status_checks &&
            matchingRule.required_check_names.length > 0
                ? matchingRule.required_check_names
                : undefined;
        const checksGate = pullRequestChecksBlockMerge(
            pull.activity?.checks ?? [],
            requiredCheckNames,
        );
        if (checksGate.blocked) {
            return jsonError(
                409,
                checksGate.reason ?? 'Required status checks have not passed.',
            );
        }

        const protectionGate = assertMergeAllowed({
            projectId,
            baseBranch: pull.base_branch,
            pull,
            membership,
            rules,
        });
        if (!protectionGate.allowed) {
            return jsonError(
                409,
                protectionGate.reason ?? 'Branch protection rules block this merge.',
            );
        }

        await client.mergePullRequest(owner, repo, n, {
            mergeMethod: body.mergeMethod,
            squash: body.squash,
            deleteBranchAfterMerge: body.deleteBranchAfterMerge,
        });

        if (body.deleteBranchAfterMerge && client.deleteBranch) {
            const headBranch = pull.compare_branch?.trim();
            if (headBranch && headBranch !== pull.base_branch) {
                try {
                    await client.deleteBranch(owner, repo, headBranch);
                } catch {
                    // branch may already be removed by provider merge
                }
            }
        }

        void notifyWorkspaceVcEvent({
            workspaceId: body.workspaceId,
            actorUserId: user.id,
            type: 'vc_pr_merged',
            title: `Merged ${owner}/${repo} #${n}`,
            content: `Pull request #${n} was merged.`,
            projectId,
            extra: `pr=${n}:merged`,
        }).catch(() => {});
        return NextResponse.json({ ok: true as const });
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'issues' in e) return jsonError(400, parseZodError(e));
        return mapUpstreamError(e);
    }
}
