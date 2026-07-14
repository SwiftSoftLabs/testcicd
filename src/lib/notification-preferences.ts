import { query, SCHEMA } from "@/lib/db";
import { NotificationPreferences } from "@/types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/constants/notification-preferences";

type NotificationPreferencesRow = {
  preferences: Partial<NotificationPreferences> | null;
};

export function mergeNotificationPreferences(
  incoming?: Partial<NotificationPreferences> | null,
): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(incoming ?? {}),
  };
}

export async function ensureNotificationPreferencesTable(): Promise<void> {
  await query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.notification_preferences (
            user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  await ensureNotificationPreferencesTable();
  const result = await query<NotificationPreferencesRow>(
    `SELECT preferences
         FROM ${SCHEMA}.notification_preferences
         WHERE user_id = $1
         LIMIT 1`,
    [userId],
  );
  return mergeNotificationPreferences(result.rows[0]?.preferences ?? null);
}

export async function saveNotificationPreferences(
  userId: string,
  preferences: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  await ensureNotificationPreferencesTable();
  const next = mergeNotificationPreferences(preferences);
  await query(
    `INSERT INTO ${SCHEMA}.notification_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET preferences = EXCLUDED.preferences,
             updated_at = NOW()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

export async function canReceiveTaskNotification(
  userId: string,
  key: "taskAssignments" | "taskComments" | "taskStatusChanges",
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs[key];
}

export async function canReceiveChatNotification(
  userId: string,
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs.browserNotifications;
}

export async function canReceiveFileNotification(
  userId: string,
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs.fileUploads;
}

export async function canReceiveCalendarNotification(
  userId: string,
  key: "calendarEmailEvents",
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs[key];
}

export async function canReceiveCalendarInviteInApp(userId: string): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs.calendarEventInvites;
}

export async function canReceiveCalendarInviteEmail(userId: string): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs.calendarEventInviteEmail;
}

export async function canReceiveVcNotification(
  userId: string,
  key: "pullRequestActivity" | "buildStatus",
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs[key];
}

export async function canReceiveCallNotification(
  userId: string,
  key:
    | "callInvites"
    | "callReminders"
    | "callSummaries"
    | "callMeetingTasksReview",
): Promise<boolean> {
  const prefs = await getNotificationPreferences(userId);
  return !prefs.globalDnd && prefs[key];
}
