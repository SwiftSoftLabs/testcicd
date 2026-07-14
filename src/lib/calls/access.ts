import { query, SCHEMA } from "@/lib/db";
import type { CallSessionRow } from "@/types/calls";

export async function assertWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const res = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, userId],
  );
  return res.rows.length > 0;
}

export async function assertCanStartCall(
  workspaceId: string,
  userId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const member = await query<{ role: string }>(
    `SELECT role FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, userId],
  );
  if (!member.rows[0]) {
    return { allowed: false, reason: "Not a workspace member" };
  }

  let who = "all_members";
  try {
    const settingsRes = await query<{
      settings: { who_can_start_calls?: string };
    }>(`SELECT settings FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`, [
      workspaceId,
    ]);
    who = settingsRes.rows[0]?.settings?.who_can_start_calls ?? "all_members";
  } catch {
    // settings column not yet migrated — default to all_members
  }
  if (who === "admins_only") {
    const role = member.rows[0].role?.toLowerCase() ?? "";
    const isAdmin =
      role === "admin" ||
      (
        await query<{ ok: number }>(
          `SELECT 1 AS ok FROM ${SCHEMA}.workspaces
         WHERE id = $1 AND owner_id = $2 LIMIT 1`,
          [workspaceId, userId],
        )
      ).rows.length > 0;
    if (!isAdmin) {
      return {
        allowed: false,
        reason: "Only workspace admins can start calls",
      };
    }
  }
  return { allowed: true };
}

export async function getCallSession(
  callId: string,
): Promise<CallSessionRow | null> {
  const res = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  return res.rows[0] ?? null;
}

export async function getCallForMember(
  callId: string,
  userId: string,
): Promise<CallSessionRow | null> {
  const call = await getCallSession(callId);
  if (!call) return null;
  const ok = await assertWorkspaceMember(call.workspace_id, userId);
  return ok ? call : null;
}

/** Ensures every user id belongs to the workspace (for call invites). */
export async function filterWorkspaceMemberIds(
  workspaceId: string,
  userIds: string[],
): Promise<{ valid: string[]; invalid: string[] }> {
  if (userIds.length === 0) return { valid: [], invalid: [] };
  const res = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`,
    [workspaceId, userIds],
  );
  const validSet = new Set(res.rows.map((r) => r.user_id));
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of userIds) {
    if (validSet.has(id)) valid.push(id);
    else invalid.push(id);
  }
  return { valid, invalid };
}

export async function isCallHost(
  callId: string,
  userId: string,
): Promise<boolean> {
  const res = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.call_sessions
     WHERE id = $1 AND created_by = $2 LIMIT 1`,
    [callId, userId],
  );
  return res.rows.length > 0;
}
