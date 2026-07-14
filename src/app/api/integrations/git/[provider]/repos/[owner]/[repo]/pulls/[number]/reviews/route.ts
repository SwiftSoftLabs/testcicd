import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  submitPullReviewBodySchema,
} from "@/lib/integrations/git/schemas";
import {
  jsonError,
  mapUpstreamError,
  parseProviderParam,
  parseZodError,
  rateLimitGit,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import { notifyWorkspaceVcEvent } from "@/lib/integrations/git/vc-notifications";
import { isPrAuthorLogin } from "@/lib/integrations/git/pr-reviews";
import { findIntegration } from "@/lib/integrations/git/repository";
import {
  enrichPullWithAuthorUserId,
} from "@/lib/integrations/git/vc-author";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      provider: string;
      owner: string;
      repo: string;
      number: string;
    }>;
  },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const params = await context.params;
    const provider = parseProviderParam(params.provider);
    const owner = decodeURIComponent(params.owner);
    const repo = decodeURIComponent(params.repo);
    ownerRepoParamsSchema.parse({ owner, repo });

    const n = Number(params.number);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return jsonError(400, "Invalid pull request number");
    }

    const body = submitPullReviewBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );

    const { pull: rawPull } = await client.getPullRequestDetail(owner, repo, n);
    const pull = await enrichPullWithAuthorUserId(rawPull, provider, {
      workspaceId: body.workspaceId,
      repoOwner: owner,
      repoName: repo,
    });
    const integration = await findIntegration(body.workspaceId, user.id, provider);
    const accountLogin = integration?.account_login ?? null;
    if (body.event === "APPROVE") {
      if (pull.author_user_id && pull.author_user_id === user.id) {
        return jsonError(403, "You cannot approve your own pull request.");
      }
      if (
        isPrAuthorLogin(accountLogin, pull.author_id, pull.author?.full_name)
      ) {
        return jsonError(403, "You cannot approve your own pull request.");
      }
    }

    await client.submitPullRequestReview(owner, repo, n, {
      event: body.event,
      body: body.body,
    });
    void notifyWorkspaceVcEvent({
      workspaceId: body.workspaceId,
      actorUserId: user.id,
      type: "vc_pr_review",
      title: `Review on ${owner}/${repo} #${n}`,
      content: `${body.event}${body.body ? `: ${body.body.slice(0, 200)}` : ""}`,
      extra: `pr=${n}:review:${body.event}:${Date.now()}`,
    }).catch(() => {});
    return NextResponse.json({ ok: true as const });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
