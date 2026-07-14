import { NextResponse } from "next/server";
import { z } from "zod";

import { oneworkUploadReleaseAsset } from "@/lib/integrations/git/onework";
import {
  findIntegration,
  getAccessTokenForIntegration,
} from "@/lib/integrations/git/repository";
import { ownerRepoParamsSchema } from "@/lib/integrations/git/schemas";
import {
  jsonError,
  mapUpstreamError,
  parseProviderParam,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  releaseId: z.coerce.number().int().positive(),
});

export async function POST(
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
      return jsonError(400, "Release asset upload is only supported for OneWork VC");
    }

    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const { searchParams } = new URL(request.url);
    const q = querySchema.parse(Object.fromEntries(searchParams.entries()));
    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const integration = await findIntegration(q.workspaceId, user.id, "onework");
    if (!integration) return jsonError(404, "OneWork VC not connected");
    const token = await getAccessTokenForIntegration(integration);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "file is required");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await oneworkUploadReleaseAsset(token, owner, repo, q.releaseId, {
      name: file.name,
      data: buffer,
    });

    return NextResponse.json({ asset });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e) {
      return jsonError(400, parseZodError(e));
    }
    return mapUpstreamError(e);
  }
}
