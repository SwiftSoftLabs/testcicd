import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  postPullCommentBodySchema,
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

    const body = postPullCommentBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    const comment = await client.postPullRequestComment(
      owner,
      repo,
      n,
      body.body,
    );
    void notifyWorkspaceVcEvent({
      workspaceId: body.workspaceId,
      actorUserId: user.id,
      type: "vc_pr_comment",
      title: `New comment on ${owner}/${repo} #${n}`,
      content: comment.body.slice(0, 240),
      extra: `pr=${n}:comment:${comment.id}`,
    }).catch(() => {});
    return NextResponse.json({ comment });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
