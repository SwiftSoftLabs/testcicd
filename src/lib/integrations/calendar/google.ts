import crypto from "crypto";

import type { CalendarEventDTO } from "@/types/calendar";
import { calendarOAuthCallbackUrl } from "./oauth";
import {
  decryptAccessToken,
  decryptRefreshToken,
  findCalendarIntegration,
  markIntegrationUsed,
  replaceAccessToken,
  type CalendarIntegrationRow,
} from "./repository";

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

interface GoogleUserInfo {
  id?: string;
  email?: string;
  name?: string;
  error?: { message?: string };
}

interface GoogleCalendarEvent {
  id: string;
  hangoutLink?: string;
  htmlLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  error?: { message?: string };
}

export async function exchangeGoogleCalendarCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret)
    throw new Error("Google Calendar OAuth is not configured");
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: calendarOAuthCallbackUrl("google_calendar"),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as GoogleTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok)
    throw new Error(
      data.error_description || data.error || "Google token exchange failed",
    );
  return data;
}

export async function refreshGoogleCalendarToken(
  row: CalendarIntegrationRow,
): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = decryptRefreshToken(row);
  if (!clientId || !clientSecret)
    throw new Error("Google Calendar OAuth is not configured");
  if (!refreshToken)
    throw new Error("Reconnect Google Calendar to refresh access");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = (await res.json()) as GoogleTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok)
    throw new Error(
      data.error_description || data.error || "Google token refresh failed",
    );
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;
  await replaceAccessToken(
    row,
    data.access_token,
    data.refresh_token ?? null,
    expiresAt,
  );
  return data.access_token;
}

export async function fetchGoogleCalendarUser(
  accessToken: string,
): Promise<{ id: string; email: string | null; name: string | null }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as GoogleUserInfo;
  if (!res.ok || !data.id)
    throw new Error(data.error?.message || "Could not read Google account");
  return { id: data.id, email: data.email ?? null, name: data.name ?? null };
}

async function validAccessToken(row: CalendarIntegrationRow): Promise<string> {
  if (
    row.token_expires_at &&
    new Date(row.token_expires_at).getTime() < Date.now() + 120_000
  ) {
    return refreshGoogleCalendarToken(row);
  }
  return decryptAccessToken(row);
}

function googleDate(
  value: string,
  timezone: string,
  allDay: boolean,
  isEnd = false,
) {
  if (allDay) {
    const d = new Date(value);
    if (isEnd) d.setDate(d.getDate() + 1);
    return { date: d.toISOString().slice(0, 10) };
  }
  return { dateTime: value, timeZone: timezone };
}

function extractMeetUrl(event: GoogleCalendarEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  );
  return video?.uri ?? event.hangoutLink ?? null;
}

export async function createGoogleMeetConference(
  userId: string,
  event: Pick<
    CalendarEventDTO,
    | "title"
    | "description"
    | "location"
    | "startTime"
    | "endTime"
    | "timezone"
    | "isAllDay"
  >,
) {
  const integration = await findCalendarIntegration(userId, "google_calendar");
  if (!integration)
    throw new Error("Connect Google Calendar to generate Meet links");
  const token = await validAccessToken(integration);
  const requestId = `onework-${crypto.randomUUID()}`;
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: googleDate(event.startTime, event.timezone, event.isAllDay),
        end: googleDate(event.endTime, event.timezone, event.isAllDay, true),
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    },
  );
  const data = (await res.json()) as GoogleCalendarEvent;
  if (!res.ok)
    throw new Error(data.error?.message || "Google Meet creation failed");
  const joinUrl = extractMeetUrl(data);
  if (!joinUrl) throw new Error("Google did not return a Meet link");
  await markIntegrationUsed(integration.id);
  return {
    integrationId: integration.id,
    provider: "google_meet" as const,
    joinUrl,
    externalEventId: data.id,
    externalMeetingId: null,
    metadata: { htmlLink: data.htmlLink ?? null },
  };
}

export async function updateGoogleMeetConference(
  userId: string,
  externalEventId: string,
  event: Pick<
    CalendarEventDTO,
    | "title"
    | "description"
    | "location"
    | "startTime"
    | "endTime"
    | "timezone"
    | "isAllDay"
  >,
): Promise<void> {
  const integration = await findCalendarIntegration(userId, "google_calendar");
  if (!integration)
    throw new Error("Connect Google Calendar to update Meet links");
  const token = await validAccessToken(integration);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalEventId)}?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: googleDate(event.startTime, event.timezone, event.isAllDay),
        end: googleDate(event.endTime, event.timezone, event.isAllDay, true),
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!res.ok)
    throw new Error(data.error?.message || "Google Meet update failed");
  await markIntegrationUsed(integration.id);
}

export async function deleteGoogleMeetConference(
  userId: string,
  externalEventId: string,
): Promise<void> {
  const integration = await findCalendarIntegration(userId, "google_calendar");
  if (!integration) return;
  const token = await validAccessToken(integration);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(data.error?.message || "Google Meet delete failed");
  }
}
