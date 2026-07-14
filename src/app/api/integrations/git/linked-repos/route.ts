import { NextResponse } from "next/server";
import { assertProjectWritable } from "@/lib/billing/quota-locks";

import { findIntegration } from "@/lib/integrations/git/repository";
import {
  linkedReposListQuerySchema,
  linkedReposPutBodySchema,
} from "@/lib/integrations/git/schemas";
import {
  jsonError,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { toAccessResponse } from "@/lib/rbac/http";
import {
  isWorkspaceMember,
  isProjectInWorkspace,
} from "@/lib/integrations/git/workspace";
import {
  listLinkedReposForProject,
  replaceLinkedReposForProject,
} from "@/lib/integrations/git/linked-repos-repository";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { searchParams } = new URL(request.url);
    const q = linkedReposListQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const projectOk = await isProjectInWorkspace(q.projectId, q.workspaceId);
    if (!projectOk)
      return jsonError(404, "Project not found in this workspace");

    const repos = await listLinkedReposForProject(
      q.projectId,
      q.workspaceId,
      user.id,
      q.provider,
    );
    return NextResponse.json(repos);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to list linked repositories",
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const body = await request.json();
    const data = linkedReposPutBodySchema.parse(body);

    const member = await isWorkspaceMember(data.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const projectOk = await isProjectInWorkspace(
      data.projectId,
      data.workspaceId,
    );
    if (!projectOk)
      return jsonError(404, "Project not found in this workspace");
    await assertProjectWritable(data.projectId);

    const integration = await findIntegration(
      data.workspaceId,
      user.id,
      data.provider,
    );
    if (!integration) {
      return jsonError(
        400,
        "Connect GitHub or GitLab before selecting repositories",
      );
    }

    await replaceLinkedReposForProject({
      projectId: data.projectId,
      workspaceId: data.workspaceId,
      userId: user.id,
      provider: data.provider,
      repos: data.repos,
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) {
      const body = await access.json();
      return NextResponse.json(body, { status: access.status });
    }
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to save linked repositories",
    );
  }
}
