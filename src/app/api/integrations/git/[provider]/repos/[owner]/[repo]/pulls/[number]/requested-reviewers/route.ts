import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  requestPullReviewersBodySchema,
} from "@/lib/integrations/git/schemas";
import { isPrAuthorLogin } from "@/lib/integrations/git/pr-reviews";
import {
  enrichPullWithAuthorUserId,
  resolveOneworkUserIdInWorkspace,
} from "@/lib/integrations/git/vc-author";
import {
  jsonError,
  mapUpstreamError,
  parseProviderParam,
  parseZodError,
  rateLimitGit,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";

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

    const body = requestPullReviewersBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    if (!client.requestPullRequestReviewers) {
      return jsonError(
        400,
        "Requesting reviewers is not supported for this provider",
      );
    }

    const { pull: rawPull } = await client.getPullRequestDetail(owner, repo, n);
    const pull = await enrichPullWithAuthorUserId(rawPull, provider, {
      workspaceId: body.workspaceId,
      repoOwner: owner,
      repoName: repo,
    });
    for (const reviewer of body.reviewers) {
      if (isPrAuthorLogin(reviewer, pull.author_id, pull.author?.full_name)) {
        return jsonError(
          400,
          "The pull request author cannot be added as a reviewer.",
        );
      }
      if (provider === "onework" && pull.author_user_id) {
        const reviewerUserId = await resolveOneworkUserIdInWorkspace(
          body.workspaceId,
          reviewer,
        );
        if (reviewerUserId && reviewerUserId === pull.author_user_id) {
          return jsonError(
            400,
            "The pull request author cannot be added as a reviewer.",
          );
        }
      }
    }

    await client.requestPullRequestReviewers(owner, repo, n, body.reviewers);
    return NextResponse.json({ ok: true as const });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
