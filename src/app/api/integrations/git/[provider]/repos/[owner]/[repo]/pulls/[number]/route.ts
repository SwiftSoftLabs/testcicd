import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  updatePullBodySchema,
  workspaceIdQuerySchema,
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
import { enrichPullWithAuthorUserId } from "@/lib/integrations/git/vc-author";

export async function GET(
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

    const { searchParams } = new URL(request.url);
    const q = workspaceIdQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(q.workspaceId, user.id, provider);
    const { pull, diffFiles } = await client.getPullRequestDetail(
      owner,
      repo,
      n,
    );
    const pullRequest = await enrichPullWithAuthorUserId(pull, provider, {
      workspaceId: q.workspaceId,
      repoOwner: owner,
      repoName: repo,
    });
    return NextResponse.json({ pullRequest, diffFiles });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}

export async function PATCH(
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

    const body = updatePullBodySchema.parse(await request.json());
    if (
      body.title == null &&
      body.description == null &&
      body.draft == null
    ) {
      return jsonError(400, "No fields to update");
    }

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    if (!client.updatePullRequest) {
      return jsonError(400, "Updating pull requests is not supported for this provider");
    }

    await client.updatePullRequest(owner, repo, n, {
      title: body.title,
      body: body.description,
      draft: body.draft,
    });

    const { pull, diffFiles } = await client.getPullRequestDetail(owner, repo, n);
    const pullRequest = await enrichPullWithAuthorUserId(pull, provider, {
      workspaceId: body.workspaceId,
      repoOwner: owner,
      repoName: repo,
    });
    return NextResponse.json({ pullRequest, diffFiles });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
