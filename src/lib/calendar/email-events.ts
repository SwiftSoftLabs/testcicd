import { query, SCHEMA } from "@/lib/db";
import { type EventRow, mapEventRow } from "@/lib/calendar/db";
import type { CalendarEventDTO } from "@/types/calendar";

interface MailMessageEventSourceRow {
  id: string;
  mail_account_id: string;
  user_id: string;
  subject: string;
}

export interface CreateEmailCalendarEventInput {
  mailMessageId: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  isAllDay?: boolean;
  createdBy?: string | null;
}

export type CreateEmailCalendarEventResult = {
  event: CalendarEventDTO;
  isNew: boolean;
};

export async function createAccountScopedEventFromMailMessage(
  input: CreateEmailCalendarEventInput,
): Promise<CreateEmailCalendarEventResult> {
  const message = await query<MailMessageEventSourceRow>(
    `SELECT mm.id, mm.account_id AS mail_account_id, ma.user_id, mm.subject
         FROM ${SCHEMA}.mail_messages mm
         JOIN ${SCHEMA}.mail_accounts ma
           ON ma.id = mm.account_id
         WHERE mm.id = $1
         LIMIT 1`,
    [input.mailMessageId],
  );

  const sourceMessage = message.rows[0];
  if (!sourceMessage) {
    throw new Error("Mail message not found");
  }

  const result = await query<EventRow & { is_new: boolean }>(
    `INSERT INTO ${SCHEMA}.events
            (calendar_id, workspace_id, account_id, project_id, created_by, source, source_mail_account_id, source_message_id,
             title, description, location, start_time, end_time, timezone, is_all_day)
         VALUES
            (NULL, NULL, $1, NULL, $2, 'email', $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11)
         ON CONFLICT (account_id, source_message_id)
            WHERE source = 'email' AND source_message_id IS NOT NULL
         DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            location = EXCLUDED.location,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            timezone = EXCLUDED.timezone,
            is_all_day = EXCLUDED.is_all_day,
            status = 'confirmed',
            updated_at = NOW()
         RETURNING *, (xmax = 0) AS is_new`,
    [
      sourceMessage.user_id,
      input.createdBy ?? null,
      sourceMessage.mail_account_id,
      sourceMessage.id,
      input.title?.trim() || sourceMessage.subject || "Email event",
      input.description ?? null,
      input.location ?? null,
      input.startTime,
      input.endTime,
      input.timezone,
      input.isAllDay ?? false,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Failed to persist calendar event");
  const { is_new: isNew, ...eventRow } = row;
  return { event: mapEventRow(eventRow), isNew: Boolean(isNew) };
}
