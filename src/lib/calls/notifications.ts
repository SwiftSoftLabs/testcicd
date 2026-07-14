import { query, SCHEMA } from "@/lib/db";
import { canReceiveCallNotification } from "@/lib/notification-preferences";

export async function notifyCallParticipants(
  userIds: string[],
  title: string,
  content: string,
  type:
    | "call_invite"
    | "call_reminder"
    | "call_summary"
    | "meeting_tasks_review",
  refId: string,
  prefKey:
    | "callInvites"
    | "callReminders"
    | "callSummaries"
    | "callMeetingTasksReview",
  excludeUserId?: string,
): Promise<void> {
  for (const userId of userIds) {
    if (excludeUserId && userId === excludeUserId) continue;
    const can = await canReceiveCallNotification(userId, prefKey);
    if (!can) continue;
    await query(
      `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, content, type, refId],
    );
  }
}
