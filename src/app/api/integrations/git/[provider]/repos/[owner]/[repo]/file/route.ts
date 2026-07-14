import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import { oneworkCommitFile } from "@/lib/integrations/git/onework";
import {
  findIntegration,
  getAccessTokenForIntegration,
} from "@/lib/integrations/git/repository";
import {
  commitFileBodySchema,
  fileQuerySchema,
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
    const q = fileQuerySchema.parse(Object.fromEntries(searchParams.entries()));

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(q.workspaceId, user.id, provider);
    const data = await client.getFileText(
      owner,
      repo,
      q.path,
      q.ref ?? undefined,
    );
    if (!data) {
      return jsonError(404, "File not found");
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}

export async function PUT(
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
    if (provider !== "onework") {
      return jsonError(400, "Web commit is only supported for OneWork Version Control");
    }
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const body = await request.json();
    const data = commitFileBodySchema.parse(body);

    const member = await isWorkspaceMember(data.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const row = await findIntegration(data.workspaceId, user.id, provider);
    if (!row) return jsonError(400, "OneWork Version Control is not ready yet");
    const token = await getAccessTokenForIntegration(row);
    await oneworkCommitFile(
      token,
      owner,
      repo,
      data.path,
      data.content,
      data.message,
      data.branch,
      data.sha,
    );
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
