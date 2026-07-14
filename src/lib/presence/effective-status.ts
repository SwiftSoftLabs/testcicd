import {
  PRESENCE_STALE_AWAY_SECONDS,
  PRESENCE_STALE_OFFLINE_SECONDS,
} from "@/lib/presence/constants";

/** SQL fragment for member-list effective presence (mirrors Slack-like stale rules). */
export function buildEffectivePresenceStatusSql(
  profileAlias = "p",
  workspacePresenceAlias = "wp",
): string {
  const updatedAt = `COALESCE(${workspacePresenceAlias}.updated_at, ${profileAlias}.updated_at)`;
  const storedStatus = `COALESCE(${workspacePresenceAlias}.status, ${profileAlias}.status)`;

  return `
            CASE
                WHEN ${profileAlias}.status = 'invited' THEN 'invited'
                WHEN ${workspacePresenceAlias}.is_manual THEN ${workspacePresenceAlias}.status
                WHEN ${updatedAt} < NOW() - INTERVAL '${PRESENCE_STALE_OFFLINE_SECONDS} seconds' THEN 'offline'
                WHEN ${updatedAt} < NOW() - INTERVAL '${PRESENCE_STALE_AWAY_SECONDS} seconds'
                     AND ${storedStatus} = 'online' THEN 'away'
                WHEN ${workspacePresenceAlias}.user_id IS NOT NULL THEN ${workspacePresenceAlias}.status
                WHEN ${profileAlias}.status IN ('away', 'offline') THEN ${profileAlias}.status
                ELSE 'online'
            END
        `;
}
