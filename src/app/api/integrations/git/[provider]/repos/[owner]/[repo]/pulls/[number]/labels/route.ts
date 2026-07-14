import { NextResponse } from "next/server";

import {
  ownerRepoParamsSchema,
  pullLabelsBodySchema,
  workspaceIdQuerySchema,
} from "@/lib/integrations/git/schemas";
import {
  jsonError,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";

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
    const owner = decodeURIComponent(params.owner);
    const repo = decodeURIComponent(params.repo);
    ownerRepoParamsSchema.parse({ owner, repo });

    const { searchParams } = new URL(request.url);
    const q = workspaceIdQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    return NextResponse.json({ labels: [], stub: true });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(500, "Failed to load labels");
  }
}

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
    const owner = decodeURIComponent(params.owner);
    const repo = decodeURIComponent(params.repo);
    ownerRepoParamsSchema.parse({ owner, repo });

    const body = pullLabelsBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    return NextResponse.json({
      ok: true,
      stub: true,
      labels: body.labels,
    });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(501, "Label management is not implemented yet");
  }
}
