import { query, SCHEMA } from '@/lib/db';
import { sendExternalEmail } from '@/lib/email/delivery';
import {
  canReceiveCalendarInviteEmail,
  canReceiveCalendarInviteInApp,
} from '@/lib/notification-preferences';
import { calendarEventDeepLink, formatEventRange } from '@/lib/calendar/event-format';
import type { CalendarEventDTO, UpdateEventInput } from '@/types/calendar';
import type { Notification } from '@/types';

export type InviteNotifyAction = 'invited' | 'updated' | 'cancelled' | 'removed';

type InviteeProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
};

export interface NotifyEventInviteesInput {
  action: InviteNotifyAction;
  event: Pick<
    CalendarEventDTO,
    'id' | 'title' | 'startTime' | 'endTime' | 'isAllDay' | 'timezone' | 'seriesId'
  >;
  attendeeIds: string[];
  actorUserId: string;
  actorName: string;
  revisionKey: string;
}

function notificationTypeForAction(action: InviteNotifyAction): Notification['type'] {
  if (action === 'invited') return 'calendar_invite';
  if (action === 'cancelled') return 'calendar_cancel';
  return 'calendar_update';
}

function anchorId(event: Pick<CalendarEventDTO, 'id' | 'seriesId'>): string {
  return event.seriesId ?? event.id;
}

function buildDedupeKey(
  event: Pick<CalendarEventDTO, 'id' | 'seriesId'>,
  action: InviteNotifyAction,
  revisionKey: string,
): string {
  return `${anchorId(event)}:${action}:${revisionKey}`;
}

function buildCopy(
  action: InviteNotifyAction,
  actorName: string,
  event: Pick<CalendarEventDTO, 'title' | 'startTime' | 'endTime' | 'isAllDay'>,
): { title: string; content: string } {
  const timeRange = formatEventRange(event);
  const eventLabel = event.title.trim() || 'Calendar event';

  if (action === 'invited') {
    return {
      title: 'Calendar invitation',
      content: `${actorName} invited you to ${eventLabel} — ${timeRange}`,
    };
  }
  if (action === 'cancelled') {
    return {
      title: 'Calendar event cancelled',
      content: `${actorName} cancelled ${eventLabel} — ${timeRange}`,
    };
  }
  if (action === 'removed') {
    return {
      title: 'Removed from calendar event',
      content: `${actorName} removed you from ${eventLabel}`,
    };
  }
  return {
    title: 'Calendar event updated',
    content: `${actorName} updated ${eventLabel} — ${timeRange}`,
  };
}

async function resolveInviteeProfiles(userIds: string[]): Promise<InviteeProfile[]> {
  if (userIds.length === 0) return [];
  const result = await query<InviteeProfile>(
    `SELECT id, email, full_name AS "fullName"
     FROM ${SCHEMA}.profiles
     WHERE id = ANY($1::uuid[])`,
    [userIds],
  );
  return result.rows;
}

async function tryClaimDelivery(
  userId: string,
  dedupeKey: string,
  channel: 'in_app' | 'email',
  eventId: string,
  seriesId: string | null,
): Promise<boolean> {
  const result = await query<{ user_id: string }>(
    `INSERT INTO ${SCHEMA}.event_invite_notification_deliveries
       (user_id, dedupe_key, channel, event_id, series_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, dedupe_key, channel) DO NOTHING
     RETURNING user_id`,
    [userId, dedupeKey, channel, eventId, seriesId],
  );
  return result.rows.length > 0;
}

async function sendInviteEmail(
  profile: InviteeProfile,
  copy: { title: string; content: string },
  eventId: string,
): Promise<void> {
  if (!profile.email?.trim()) return;

  const calendarUrl = calendarEventDeepLink(eventId);
  const html = `
    <p>${copy.content}</p>
    <p><a href="${calendarUrl}">View in OneWork Calendar</a></p>
  `;

  const result = await sendExternalEmail({
    to: [profile.email.trim()],
    subject: copy.title,
    html,
  });

  if (result.status === 'failed') {
    console.warn('[notifyEventInvitees] email failed:', result.error);
  }
}

export async function resolveActorDisplayName(actorUserId: string): Promise<string> {
  const result = await query<{ full_name: string | null }>(
    `SELECT full_name FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
    [actorUserId],
  );
  const name = result.rows[0]?.full_name?.trim();
  return name || 'Someone';
}

function buildCreatorConfirmationCopy(
  event: Pick<CalendarEventDTO, 'title' | 'startTime' | 'endTime' | 'isAllDay'>,
): { title: string; content: string } {
  const timeRange = formatEventRange(event);
  const eventLabel = event.title.trim() || 'Calendar event';
  return {
    title: 'Event scheduled',
    content: `You scheduled ${eventLabel} — ${timeRange}`,
  };
}

function buildOrganizerConfirmationDedupeKey(
  event: Pick<CalendarEventDTO, 'id' | 'seriesId'>,
  revisionKey: string,
): string {
  return `${anchorId(event)}:organizer_confirmation:${revisionKey}`;
}

async function notifyCreatorAsAttendeeConfirmation(input: NotifyEventInviteesInput): Promise<void> {
  if (input.action !== 'invited' || !input.attendeeIds.includes(input.actorUserId)) return;

  const profiles = await resolveInviteeProfiles([input.actorUserId]);
  const profile = profiles[0] ?? { id: input.actorUserId, email: null, fullName: null };
  const copy = buildCreatorConfirmationCopy(input.event);
  const dedupeKey = buildOrganizerConfirmationDedupeKey(input.event, input.revisionKey);
  const refId = input.event.id;
  const seriesId = input.event.seriesId ?? null;
  const userId = input.actorUserId;

  const canInApp = await canReceiveCalendarInviteInApp(userId);
  if (canInApp) {
    const claimed = await tryClaimDelivery(userId, dedupeKey, 'in_app', refId, seriesId);
    if (claimed) {
      await query(
        `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, copy.title, copy.content, 'calendar_invite', refId],
      );
    }
  }

  const canEmail = await canReceiveCalendarInviteEmail(userId);
  if (canEmail) {
    const claimed = await tryClaimDelivery(userId, dedupeKey, 'email', refId, seriesId);
    if (claimed) {
      try {
        await sendInviteEmail(profile, copy, refId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[notifyEventInvitees] organizer confirmation email error:', message);
      }
    }
  }
}

export async function notifyEventInvitees(input: NotifyEventInviteesInput): Promise<void> {
  const recipients = [...new Set(input.attendeeIds)].filter((id) => id !== input.actorUserId);

  if (recipients.length === 0) {
    await notifyCreatorAsAttendeeConfirmation(input);
    return;
  }

  const profiles = await resolveInviteeProfiles(recipients);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const copy = buildCopy(input.action, input.actorName, input.event);
  const dedupeKey = buildDedupeKey(input.event, input.action, input.revisionKey);
  const notificationType = notificationTypeForAction(input.action);
  const refId = input.event.id;
  const seriesId = input.event.seriesId ?? null;
  const sendEmail = input.action !== 'removed';

  for (const userId of recipients) {
    const profile = profileById.get(userId) ?? { id: userId, email: null, fullName: null };

    const canInApp = await canReceiveCalendarInviteInApp(userId);
    if (canInApp) {
      const claimed = await tryClaimDelivery(userId, dedupeKey, 'in_app', refId, seriesId);
      if (claimed) {
        await query(
          `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, copy.title, copy.content, notificationType, refId],
        );
      }
    }

    if (sendEmail) {
      const canEmail = await canReceiveCalendarInviteEmail(userId);
      if (canEmail) {
        const claimed = await tryClaimDelivery(userId, dedupeKey, 'email', refId, seriesId);
        if (claimed) {
          try {
            await sendInviteEmail(profile, copy, refId);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[notifyEventInvitees] email send error:', message);
          }
        }
      }
    }
  }

  await notifyCreatorAsAttendeeConfirmation(input);
}

function metadataChanged(existing: CalendarEventDTO, saved: CalendarEventDTO): boolean {
  return (
    existing.title !== saved.title ||
    (existing.description ?? '') !== (saved.description ?? '') ||
    (existing.location ?? '') !== (saved.location ?? '') ||
    existing.startTime !== saved.startTime ||
    existing.endTime !== saved.endTime ||
    existing.timezone !== saved.timezone ||
    existing.isAllDay !== saved.isAllDay ||
    (existing.recurrenceUntil ?? '') !== (saved.recurrenceUntil ?? '')
  );
}

export function buildPatchInviteNotificationPlans(
  existing: CalendarEventDTO,
  saved: CalendarEventDTO,
  input: UpdateEventInput,
): Array<{ action: InviteNotifyAction; attendeeIds: string[] }> {
  if (saved.scope === 'account' || !saved.workspaceId) return [];

  const plans: Array<{ action: InviteNotifyAction; attendeeIds: string[] }> = [];

  if (saved.status === 'cancelled' && existing.status !== 'cancelled') {
    plans.push({ action: 'cancelled', attendeeIds: saved.attendeeIds });
    return plans;
  }

  const previousAttendees = new Set(existing.attendeeIds);
  const nextAttendees = new Set(saved.attendeeIds);
  const newAttendees = saved.attendeeIds.filter((id) => !previousAttendees.has(id));
  const removedAttendees = existing.attendeeIds.filter((id) => !nextAttendees.has(id));

  if (newAttendees.length > 0) {
    plans.push({ action: 'invited', attendeeIds: newAttendees });
  }

  if (removedAttendees.length > 0) {
    plans.push({ action: 'removed', attendeeIds: removedAttendees });
  }

  const inviteFieldsTouched =
    input.title !== undefined ||
    input.description !== undefined ||
    input.location !== undefined ||
    input.startTime !== undefined ||
    input.endTime !== undefined ||
    input.timezone !== undefined ||
    input.isAllDay !== undefined ||
    input.seriesRecurrenceUntil !== undefined;

  if (inviteFieldsTouched && metadataChanged(existing, saved)) {
    const updatedRecipients = saved.attendeeIds.filter(
      (id) => !newAttendees.includes(id),
    );
    if (updatedRecipients.length > 0) {
      plans.push({ action: 'updated', attendeeIds: updatedRecipients });
    }
  }

  return plans;
}

export async function dispatchPatchEventInviteNotifications(
  existing: CalendarEventDTO,
  saved: CalendarEventDTO,
  input: UpdateEventInput,
  actorUserId: string,
): Promise<void> {
  const plans = buildPatchInviteNotificationPlans(existing, saved, input);
  if (plans.length === 0) return;

  const actorName = await resolveActorDisplayName(actorUserId);
  const revisionKey = saved.updatedAt;

  for (const plan of plans) {
    await notifyEventInvitees({
      action: plan.action,
      event: saved,
      attendeeIds: plan.attendeeIds,
      actorUserId,
      actorName,
      revisionKey,
    });
  }
}

export async function collectAttendeeIdsForEvents(eventIds: string[]): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const result = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id::text AS user_id
     FROM ${SCHEMA}.event_attendees
     WHERE event_id = ANY($1::uuid[])`,
    [eventIds],
  );
  return result.rows.map((row) => row.user_id);
}

export async function dispatchDeleteEventInviteNotifications(
  targets: CalendarEventDTO[],
  actorUserId: string,
): Promise<void> {
  const workspaceTargets = targets.filter((target) => target.workspaceId);
  if (workspaceTargets.length === 0) return;

  const anchor = workspaceTargets[0];
  const attendeeIds = await collectAttendeeIdsForEvents(workspaceTargets.map((target) => target.id));
  if (attendeeIds.length === 0) return;

  const actorName = await resolveActorDisplayName(actorUserId);
  const revisionKey = new Date().toISOString();

  await notifyEventInvitees({
    action: 'cancelled',
    event: anchor,
    attendeeIds,
    actorUserId,
    actorName,
    revisionKey,
  });
}
