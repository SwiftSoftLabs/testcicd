import { query, SCHEMA } from "@/lib/db";
import type { CalendarEventDTO, ConferenceProvider } from "@/types/calendar";
import {
  createGoogleMeetConference,
  deleteGoogleMeetConference,
  updateGoogleMeetConference,
} from "./google";
import {
  createZoomConference,
  deleteZoomConference,
  updateZoomConference,
} from "./zoom";

interface ProviderConferenceResult {
  integrationId: string;
  provider: "google_meet" | "zoom";
  joinUrl: string;
  externalEventId: string | null;
  externalMeetingId: string | null;
  metadata: Record<string, unknown>;
}

export type EventSnapshot = Pick<
  CalendarEventDTO,
  | "title"
  | "description"
  | "location"
  | "startTime"
  | "endTime"
  | "timezone"
  | "isAllDay"
>;

export async function createProviderConference(
  userId: string,
  provider: ConferenceProvider,
  event: EventSnapshot,
): Promise<ProviderConferenceResult | null> {
  if (provider === "none") return null;
  if (provider === "google_meet")
    return createGoogleMeetConference(userId, event);
  return createZoomConference(userId, event);
}

export async function persistEventConference(
  eventId: string,
  conference: ProviderConferenceResult,
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.event_conferences (
            event_id, integration_id, provider, join_url, external_event_id,
            external_meeting_id, metadata, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active')
         ON CONFLICT (event_id)
         DO UPDATE SET
            integration_id = EXCLUDED.integration_id,
            provider = EXCLUDED.provider,
            join_url = EXCLUDED.join_url,
            external_event_id = EXCLUDED.external_event_id,
            external_meeting_id = EXCLUDED.external_meeting_id,
            metadata = EXCLUDED.metadata,
            status = 'active',
            updated_at = NOW()`,
    [
      eventId,
      conference.integrationId,
      conference.provider,
      conference.joinUrl,
      conference.externalEventId,
      conference.externalMeetingId,
      JSON.stringify(conference.metadata),
    ],
  );
}

export async function deletePersistedConference(
  eventId: string,
): Promise<void> {
  await query(`DELETE FROM ${SCHEMA}.event_conferences WHERE event_id = $1`, [
    eventId,
  ]);
}

export async function syncConferenceUpdate(
  userId: string,
  existing: CalendarEventDTO,
  nextProvider: ConferenceProvider | undefined,
  nextEvent: EventSnapshot,
): Promise<ProviderConferenceResult | null | undefined> {
  const current = existing.conference;
  if (!nextProvider || nextProvider === current?.provider) {
    if (!current) return undefined;
    if (current.provider === "google_meet" && current.externalEventId) {
      await updateGoogleMeetConference(
        userId,
        current.externalEventId,
        nextEvent,
      );
    }
    if (current.provider === "zoom" && current.externalMeetingId) {
      await updateZoomConference(userId, current.externalMeetingId, nextEvent);
    }
    return undefined;
  }

  await syncConferenceDelete(userId, existing);
  if (nextProvider === "none") return null;
  return createProviderConference(userId, nextProvider, nextEvent);
}

export async function syncConferenceDelete(
  userId: string,
  event: CalendarEventDTO,
): Promise<void> {
  const conference = event.conference;
  if (!conference) return;
  if (conference.provider === "google_meet" && conference.externalEventId) {
    await deleteGoogleMeetConference(userId, conference.externalEventId);
  }
  if (conference.provider === "zoom" && conference.externalMeetingId) {
    await deleteZoomConference(userId, conference.externalMeetingId);
  }
}
