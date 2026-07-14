import { query, SCHEMA } from "@/lib/db";
import {
  deleteCallRecordingRow,
  purgeCallRecordingStorage,
} from "@/lib/calls/purgeRecording";

type Retention = "forever" | "7_days" | "30_days" | "sprint_end";

function retentionFromMetadata(
  metadata: Record<string, unknown> | null,
): Retention {
  const r = metadata?.recording_retention;
  if (r === "7_days" || r === "30_days" || r === "sprint_end" || r === "forever")
    return r;
  return "forever";
}

function isOlderThanDays(endedAt: string | null, days: number): boolean {
  if (!endedAt) return false;
  const end = new Date(endedAt).getTime();
  return Date.now() - end > days * 86_400_000;
}

/**
 * Opportunistically removes recordings past retention (runs on workspace list calls).
 */
export async function expireCallRecordingRetention(
  workspaceId: string,
): Promise<void> {
  const rows = await query<{
    rec_id: string;
    call_id: string;
    ended_at: string | null;
    project_id: string | null;
    metadata: Record<string, unknown> | null;
    workspace_file_id: string | null;
    storage_key: string | null;
  }>(
    `SELECT cr.id AS rec_id,
            cs.id AS call_id,
            cs.ended_at,
            cs.project_id,
            cs.metadata,
            cr.workspace_file_id,
            cr.storage_key
     FROM ${SCHEMA}.call_recordings cr
     JOIN ${SCHEMA}.call_sessions cs ON cs.id = cr.call_session_id
     WHERE cs.workspace_id = $1
       AND cs.status = 'completed'
       AND cr.status = 'uploaded'
       AND (cr.workspace_file_id IS NOT NULL OR cr.storage_key IS NOT NULL)`,
    [workspaceId],
  );

  for (const row of rows.rows) {
    const ret = retentionFromMetadata(row.metadata);
    if (ret === "forever") continue;

    let shouldExpire = false;
    if (ret === "7_days") shouldExpire = isOlderThanDays(row.ended_at, 7);
    else if (ret === "30_days") shouldExpire = isOlderThanDays(row.ended_at, 30);
    else if (ret === "sprint_end") {
      if (!row.project_id) continue;
      const sprintRes = await query<{ ok: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM ${SCHEMA}.sprints s
           WHERE s.project_id = $1
             AND s.status = 'completed'
         ) AS ok`,
        [row.project_id],
      );
      shouldExpire = !!sprintRes.rows[0]?.ok;
    }

    if (!shouldExpire) continue;

    await purgeCallRecordingStorage(
      row.workspace_file_id,
      row.storage_key,
    );
    await deleteCallRecordingRow(row.rec_id);
  }
}
