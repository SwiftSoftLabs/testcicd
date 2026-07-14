import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  postPullReviewCommentBodySchema,
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

    const body = postPullReviewCommentBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    if (!client.postPullRequestReviewComment) {
      return jsonError(
        400,
        "Line comments are not supported for this provider",
      );
    }

    const comment = await client.postPullRequestReviewComment(
      owner,
      repo,
      n,
      {
        body: body.body,
        path: body.path,
        line: body.line,
        side: body.side,
      },
    );
    return NextResponse.json({ comment });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
