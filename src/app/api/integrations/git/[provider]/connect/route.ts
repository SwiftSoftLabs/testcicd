import { NextResponse } from "next/server";

import { upsertIntegration } from "@/lib/integrations/git/repository";
import { connectPatBodySchema } from "@/lib/integrations/git/schemas";
import { getProviderClient } from "@/lib/integrations/git/registry";
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
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const provider = parseProviderParam((await context.params).provider);
    if (provider === "onework") {
      return jsonError(403, "OneWork Version Control is platform-managed and does not use PAT connect");
    }
    const body = await request.json();
    const data = connectPatBodySchema.parse(body);

    const member = await isWorkspaceMember(data.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = getProviderClient(provider, data.token);
    const viewer = await client.getViewer();
    await upsertIntegration({
      workspaceId: data.workspaceId,
      userId: user.id,
      provider,
      authMethod: "pat",
      accountLogin: viewer.login,
      accountId: viewer.id,
      accountAvatarUrl: viewer.avatarUrl,
      scopes: [],
      accessToken: data.token.trim(),
      refreshToken: null,
      tokenExpiresAt: null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("GIT_INTEGRATION_TOKEN_KEY")) {
      return jsonError(500, "Server encryption key is not configured");
    }
    if (e && typeof e === "object" && "issues" in e) {
      return jsonError(400, parseZodError(e));
    }
    return mapUpstreamError(e);
  }
}
