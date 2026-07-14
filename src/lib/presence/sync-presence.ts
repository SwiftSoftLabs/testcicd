import { query, SCHEMA } from "@/lib/db";
import type { AutoPresenceStatus } from "@/lib/presence/constants";

/** Login / session restore: online everywhere, clear manual overrides. */
export async function activateUserPresence(userId: string): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.profiles
         SET status = 'online', updated_at = NOW()
         WHERE id = $1`,
    [userId],
  );

  await query(
    `INSERT INTO ${SCHEMA}.workspace_presence (workspace_id, user_id, status, is_manual, updated_at)
         SELECT wm.workspace_id, wm.user_id, 'online', FALSE, NOW()
         FROM ${SCHEMA}.workspace_members wm
         WHERE wm.user_id = $1
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET status = 'online',
             is_manual = FALSE,
             updated_at = NOW()`,
    [userId],
  );
}

/** Logout / session end / tab close: offline everywhere, clear manual overrides. */
export async function deactivateUserPresence(userId: string): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.profiles
         SET status = 'offline', updated_at = NOW()
         WHERE id = $1`,
    [userId],
  );

  await query(
    `INSERT INTO ${SCHEMA}.workspace_presence (workspace_id, user_id, status, is_manual, updated_at)
         SELECT wm.workspace_id, wm.user_id, 'offline', FALSE, NOW()
         FROM ${SCHEMA}.workspace_members wm
         WHERE wm.user_id = $1
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET status = 'offline',
             is_manual = FALSE,
             updated_at = NOW()`,
    [userId],
  );
}

/**
 * Auto (non-manual) presence across all workspace memberships.
 * Skips rows with is_manual = TRUE and skips profile update when any manual override exists.
 */
export async function syncAutoUserPresence(
  userId: string,
  status: AutoPresenceStatus,
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.workspace_presence (workspace_id, user_id, status, is_manual, updated_at)
         SELECT wm.workspace_id, wm.user_id, $2, FALSE, NOW()
         FROM ${SCHEMA}.workspace_members wm
         WHERE wm.user_id = $1
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET status = EXCLUDED.status,
             updated_at = NOW()
         WHERE ${SCHEMA}.workspace_presence.is_manual = FALSE`,
    [userId, status],
  );

  await query(
    `UPDATE ${SCHEMA}.profiles
         SET status = $2, updated_at = NOW()
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1
             FROM ${SCHEMA}.workspace_presence wp
             WHERE wp.user_id = $1
               AND wp.is_manual = TRUE
           )`,
    [userId, status],
  );
}
