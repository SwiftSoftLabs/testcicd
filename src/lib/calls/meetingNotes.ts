import { query, SCHEMA } from "@/lib/db";
import type { CallMeetingNotesPayload } from "@/types/calls";

const ACTIVE_CALL_STATUSES = new Set(["live", "lobby", "scheduled"]);

export async function assertActiveCallParticipant(
  callId: string,
  userId: string,
): Promise<boolean> {
  const res = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.call_participants
     WHERE call_session_id = $1 AND user_id = $2
       AND joined_at IS NOT NULL AND left_at IS NULL
     LIMIT 1`,
    [callId, userId],
  );
  return !!res.rows[0];
}

export async function loadCallMeetingNotes(
  callId: string,
  userId: string,
): Promise<CallMeetingNotesPayload> {
  const [publicRes, privateRes] = await Promise.all([
    query<{
      content: string;
      updated_at: string;
      updated_by: string | null;
    }>(
      `SELECT content, updated_at, updated_by
       FROM ${SCHEMA}.call_public_meeting_notes
       WHERE call_session_id = $1 LIMIT 1`,
      [callId],
    ),
    query<{ content: string }>(
      `SELECT content FROM ${SCHEMA}.call_private_meeting_notes
       WHERE call_session_id = $1 AND user_id = $2 LIMIT 1`,
      [callId, userId],
    ),
  ]);

  const pub = publicRes.rows[0];
  const priv = privateRes.rows[0];

  return {
    publicContent: pub?.content ?? "",
    privateContent: priv?.content ?? "",
    publicUpdatedAt: pub?.updated_at ?? null,
    publicUpdatedBy: pub?.updated_by ?? null,
  };
}

export async function upsertPublicMeetingNotes(
  callId: string,
  userId: string,
  content: string,
): Promise<{
  publicContent: string;
  updatedAt: string;
  updatedBy: string;
}> {
  const res = await query<{
    content: string;
    updated_at: string;
    updated_by: string;
  }>(
    `INSERT INTO ${SCHEMA}.call_public_meeting_notes
       (call_session_id, content, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (call_session_id) DO UPDATE SET
       content = EXCLUDED.content,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING content, updated_at, updated_by`,
    [callId, content, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to save public notes");
  return {
    publicContent: row.content,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function upsertPrivateMeetingNotes(
  callId: string,
  userId: string,
  content: string,
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.call_private_meeting_notes
       (call_session_id, user_id, content, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (call_session_id, user_id) DO UPDATE SET
       content = EXCLUDED.content,
       updated_at = NOW()`,
    [callId, userId, content],
  );
}

export function isCallActiveForNotes(status: string): boolean {
  return ACTIVE_CALL_STATUSES.has(status);
}
