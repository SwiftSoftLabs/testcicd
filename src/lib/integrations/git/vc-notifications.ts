import { query, SCHEMA } from "@/lib/db";

import { canReceiveVcNotification } from "@/lib/notification-preferences";
import type { Notification } from "@/types";

export type VcNotificationType = Extract<
  Notification["type"],
  | "vc_pr_opened"
  | "vc_pr_comment"
  | "vc_pr_review"
  | "vc_pr_merged"
  | "vc_pr_closed"
  | "vc_collaborator"
  | "vc_release"
  | "vc_push"
  | "vc_check"
>;

function prefKeyForType(
  type: VcNotificationType,
): "pullRequestActivity" | "buildStatus" {
  return type === "vc_check" ? "buildStatus" : "pullRequestActivity";
}

export function buildVcNotificationRef(params: {
  workspaceId: string;
  projectId?: string | null;
  extra?: string;
}): string {
  return `vc:${params.workspaceId}:${params.projectId || "none"}:${params.extra || ""}`;
}

async function listWorkspaceMemberIds(workspaceId: string): Promise<string[]> {
  const res = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1`,
    [workspaceId],
  );
  return res.rows.map((r) => r.user_id);
}

export async function notifyWorkspaceVcEvent(params: {
  workspaceId: string;
  actorUserId?: string | null;
  type: VcNotificationType;
  title: string;
  content: string;
  projectId?: string | null;
  /** Stable suffix for dedupe, e.g. pr=12:opened or push:abc123 */
  extra?: string;
}): Promise<void> {
  const refId = buildVcNotificationRef({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    extra: params.extra,
  });

  const members = await listWorkspaceMemberIds(params.workspaceId);
  const prefKey = prefKeyForType(params.type);

  for (const userId of members) {
    if (params.actorUserId && userId === params.actorUserId) continue;
    try {
      const ok = await canReceiveVcNotification(userId, prefKey);
      if (!ok) continue;

      // Dedupe recent identical notifications (webhook retries / double emit)
      const existing = await query<{ id: string }>(
        `SELECT id FROM ${SCHEMA}.notifications
         WHERE user_id = $1 AND type = $2 AND ref_id = $3
           AND created_at > NOW() - INTERVAL '1 day'
         LIMIT 1`,
        [userId, params.type, refId],
      );
      if (existing.rows[0]) continue;

      await query(
        `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, params.title, params.content, params.type, refId],
      );
    } catch (e) {
      console.error("[vc-notifications] failed for", userId, e);
    }
  }
}

export async function resolvePlatformRepoContext(fullName: string): Promise<{
  workspaceId: string;
  projectId: string;
} | null> {
  const res = await query<{ workspace_id: string; project_id: string }>(
    `SELECT workspace_id, project_id
     FROM ${SCHEMA}.git_project_platform_repos
     WHERE LOWER(repo_full_name) = LOWER($1)
     LIMIT 1`,
    [fullName],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { workspaceId: row.workspace_id, projectId: row.project_id };
}

export async function claimWebhookDelivery(
  deliveryId: string,
  eventType: string,
): Promise<boolean> {
  try {
    await query(
      `INSERT INTO ${SCHEMA}.vc_webhook_deliveries (delivery_id, event_type)
       VALUES ($1, $2)`,
      [deliveryId, eventType],
    );
    return true;
  } catch {
    return false;
  }
}
