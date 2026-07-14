import { calendarEventDeepLink, formatEventRange } from "@/lib/calendar/event-format";
import { query, SCHEMA } from "@/lib/db";
import { sendExternalEmail } from "@/lib/email/delivery";
import { canReceiveCalendarNotification } from "@/lib/notification-preferences";
import type { CalendarEventDTO } from "@/types/calendar";

export interface NotifyEmailEventCreatedInput {
  userId: string;
  userEmail: string;
  event: CalendarEventDTO;
  sourceEmailSubject: string;
}

async function sendConfirmationEmail(
  input: NotifyEmailEventCreatedInput,
  timeRange: string,
): Promise<void> {
  if (!input.userEmail.trim()) return;

  const calendarUrl = calendarEventDeepLink(input.event.id);
  const subject = `Event added: ${input.event.title}`;
  const html = `
    <p>Your calendar event was created from an email.</p>
    <p><strong>${input.event.title}</strong></p>
    <p>${timeRange}</p>
    <p><em>From email:</em> ${input.sourceEmailSubject}</p>
    <p><a href="${calendarUrl}">View in OneWork Calendar</a></p>
  `;

  const result = await sendExternalEmail({
    to: [input.userEmail],
    subject,
    html,
  });

  if (result.status === "failed") {
    console.warn(
      "[notifyEmailEventCreated] confirmation email failed:",
      result.error,
    );
  }
}

export async function notifyEmailEventCreated(
  input: NotifyEmailEventCreatedInput,
): Promise<void> {
  const canNotify = await canReceiveCalendarNotification(
    input.userId,
    "calendarEmailEvents",
  );
  if (!canNotify) return;

  const timeRange = formatEventRange(input.event);
  const content = `${input.event.title} — ${timeRange}`;

  await query(
    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.userId,
      "Event added from email",
      content,
      "calendar_event",
      input.event.id,
    ],
  );

  try {
    await sendConfirmationEmail(input, timeRange);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[notifyEmailEventCreated] email send error:", message);
  }
}
