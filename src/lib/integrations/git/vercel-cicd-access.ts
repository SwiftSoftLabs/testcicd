import { query, SCHEMA } from "@/lib/db";
import {
  WorkspaceAccessError,
  isWorkspaceAdmin,
  memberCan,
  requireWorkspaceMember,
  type WorkspaceMembership,
} from "@/lib/rbac/workspace-access";

/** Default: open to members with access_repositories (product request for now). */
export const DEFAULT_VERCEL_CICD_ALLOW_MEMBERS = true;

export async function getVercelCicdAllowMembers(
  workspaceId: string,
): Promise<boolean> {
  const res = await query<{ settings: Record<string, unknown> | null }>(
    `SELECT settings FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
    [workspaceId],
  );
  const settings = res.rows[0]?.settings ?? {};
  const value = settings.vercel_cicd_allow_members;
  if (typeof value === "boolean") return value;
  return DEFAULT_VERCEL_CICD_ALLOW_MEMBERS;
}

export async function setVercelCicdAllowMembers(
  workspaceId: string,
  allowMembers: boolean,
): Promise<boolean> {
  const res = await query<{ settings: Record<string, unknown> }>(
    `UPDATE ${SCHEMA}.workspaces
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING settings`,
    [
      workspaceId,
      JSON.stringify({ vercel_cicd_allow_members: allowMembers }),
    ],
  );
  const value = res.rows[0]?.settings?.vercel_cicd_allow_members;
  return typeof value === "boolean" ? value : allowMembers;
}

/**
 * Admin/owner always allowed.
 * Members allowed only when workspace setting vercel_cicd_allow_members is true
 * and they have access_repositories.
 */
export async function requireVercelCicdAccess(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMembership> {
  const membership = await requireWorkspaceMember(workspaceId, userId);
  if (isWorkspaceAdmin(membership)) return membership;

  const allowMembers = await getVercelCicdAllowMembers(workspaceId);
  if (allowMembers && memberCan(membership, "access_repositories")) {
    return membership;
  }

  throw new WorkspaceAccessError(
    allowMembers
      ? "You do not have permission to manage Version Control CI/CD."
      : "Admin or owner access required. A workspace admin can open this to members in Settings → Plugins → Vercel.",
    403,
  );
}
