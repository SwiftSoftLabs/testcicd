import { NextResponse } from "next/server";

import { query, SCHEMA } from "@/lib/db";
import {
  jsonError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import { isOneworkVcConfigured } from "@/lib/integrations/git/onework";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return jsonError(400, "workspaceId is required");

    const member = await isWorkspaceMember(workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    if (!isOneworkVcConfigured()) {
      return NextResponse.json([]);
    }

    const rows = await query<{
      user_id: string;
      email: string;
      full_name: string | null;
      gitea_username: string | null;
    }>(
      `SELECT wm.user_id, p.email, p.full_name, ova.gitea_username
       FROM ${SCHEMA}.workspace_members wm
       JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
       LEFT JOIN ${SCHEMA}.onework_vc_accounts ova ON ova.user_id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY COALESCE(p.full_name, p.email) ASC`,
      [workspaceId],
    );

    const handles = rows.rows
      .filter((row) => row.email)
      .map((row) => ({
        userId: row.user_id,
        name: row.full_name || row.email.split("@")[0] || row.email,
        email: row.email,
        giteaUsername: row.gitea_username,
      }));

    return NextResponse.json(handles);
  } catch (e: unknown) {
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to load workspace members",
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const body = (await request.json()) as {
      workspaceId?: string;
      userId?: string;
    };
    const workspaceId = body.workspaceId?.trim();
    const userId = body.userId?.trim();
    if (!workspaceId || !userId) {
      return jsonError(400, "workspaceId and userId are required");
    }

    const member = await isWorkspaceMember(workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    if (!isOneworkVcConfigured()) {
      return jsonError(400, "OneWork Version Control is not configured");
    }

    const target = await isWorkspaceMember(workspaceId, userId);
    if (!target) {
      return jsonError(404, "User is not a member of this workspace");
    }

    const profile = await query<{
      email: string;
      full_name: string | null;
      gitea_username: string | null;
    }>(
      `SELECT p.email, p.full_name, ova.gitea_username
       FROM ${SCHEMA}.profiles p
       LEFT JOIN ${SCHEMA}.onework_vc_accounts ova ON ova.user_id = p.id
       WHERE p.id = $1`,
      [userId],
    );
    const row = profile.rows[0];
    if (!row?.email) return jsonError(404, "User profile not found");

    if (!row.gitea_username) {
      const { ensureOneworkMemberIntegration } = await import(
        "@/lib/integrations/git/provisioning"
      );
      const result = await ensureOneworkMemberIntegration({
        workspaceId,
        userId,
        email: row.email,
        fullName: row.full_name || row.email.split("@")[0] || "OneWork User",
      });
      if (!result.ok) {
        return jsonError(502, result.error || "Failed to provision Version Control user");
      }
    }

    const account = await query<{ gitea_username: string }>(
      `SELECT gitea_username FROM ${SCHEMA}.onework_vc_accounts WHERE user_id = $1`,
      [userId],
    );
    const giteaUsername = account.rows[0]?.gitea_username;
    if (!giteaUsername) {
      return jsonError(502, "Failed to resolve Gitea username");
    }

    return NextResponse.json({
      userId,
      name: row.full_name || row.email.split("@")[0] || giteaUsername,
      email: row.email,
      giteaUsername,
    });
  } catch (e: unknown) {
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to provision workspace member",
    );
  }
}
