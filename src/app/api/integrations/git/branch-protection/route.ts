import { NextResponse } from "next/server";

import { query, SCHEMA } from "@/lib/db";
import {
  branchProtectionPutBodySchema,
  branchProtectionQuerySchema,
} from "@/lib/integrations/git/schemas";
import { loadRules, saveRules } from "@/lib/integrations/git/branch-protection";
import {
  jsonError,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import {
  getWorkspaceMembership,
  isWorkspaceAdmin,
} from "@/lib/rbac/workspace-access";

async function assertProjectInWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const res = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.projects
     WHERE id = $1 AND workspace_id = $2
     LIMIT 1`,
    [projectId, workspaceId],
  );
  return Boolean(res.rows[0]);
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { searchParams } = new URL(request.url);
    const q = branchProtectionQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const ok = await assertProjectInWorkspace(q.projectId, q.workspaceId);
    if (!ok) return jsonError(404, "Project not found");

    const rules = await loadRules(q.projectId);
    return NextResponse.json({ rules });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(500, "Failed to load branch protection rules");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const body = branchProtectionPutBodySchema.parse(await request.json());

    const membership = await getWorkspaceMembership(body.workspaceId, user.id);
    if (!membership) return jsonError(404, "Workspace not found or access denied");
    if (!isWorkspaceAdmin(membership)) {
      return jsonError(403, "Only workspace admins can edit branch protection.");
    }

    const ok = await assertProjectInWorkspace(body.projectId, body.workspaceId);
    if (!ok) return jsonError(404, "Project not found");

    const rules = await saveRules(body.projectId, body.rules);
    return NextResponse.json({ rules });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(500, "Failed to save branch protection rules");
  }
}
