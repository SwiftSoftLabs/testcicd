import { NextResponse } from "next/server";

import { workspaceIdQuerySchema } from "@/lib/integrations/git/schemas";
import {
  jsonError,
  parseProviderParam,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { deleteIntegration } from "@/lib/integrations/git/repository";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const provider = parseProviderParam((await context.params).provider);
    if (provider === "onework") {
      return jsonError(403, "OneWork Version Control is included with your workspace and cannot be disconnected");
    }
    const { searchParams } = new URL(request.url);
    const q = workspaceIdQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    await deleteIntegration(q.workspaceId, user.id, provider);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return jsonError(400, parseZodError(e));
  }
}
