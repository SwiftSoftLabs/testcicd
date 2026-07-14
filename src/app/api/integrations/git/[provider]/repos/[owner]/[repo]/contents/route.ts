import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  contentsQuerySchema,
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
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ provider: string; owner: string; repo: string }>;
  },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { provider: p, owner: o, repo: rname } = await context.params;
    const provider = parseProviderParam(p);
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);

    ownerRepoParamsSchema.parse({ owner, repo });

    const { searchParams } = new URL(request.url);
    const q = contentsQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(q.workspaceId, user.id, provider);
    const tree = await client.getTree(
      owner,
      repo,
      q.path ?? "",
      q.ref ?? undefined,
    );
    return NextResponse.json(tree);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
