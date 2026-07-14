import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  mergePullBodySchema,
  ownerRepoParamsSchema,
} from "@/lib/integrations/git/schemas";
import {
  jsonError,
  mapUpstreamError,
  parseProviderParam,
  parseZodError,
  rateLimitGit,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { getWorkspaceMembership } from "@/lib/rbac/workspace-access";

const bodySchema = mergePullBodySchema.pick({ workspaceId: true });

export async function POST(
  request: Request,
  context: {
    params: Promise<{ provider: string; owner: string; repo: string; number: string }>;
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
    if (!Number.isFinite(n) || n < 1) {
      return jsonError(400, "Invalid pull request number");
    }

    const body = bodySchema.parse(await request.json());
    const membership = await getWorkspaceMembership(body.workspaceId, user.id);
    if (!membership) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(body.workspaceId, user.id, provider);
    if (!client.enablePullRequestAutoMerge) {
      return jsonError(400, "Auto-merge is not supported for this provider");
    }

    await client.enablePullRequestAutoMerge(owner, repo, n);
    return NextResponse.json({ ok: true as const });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e) {
      return jsonError(400, parseZodError(e));
    }
    return mapUpstreamError(e);
  }
}
