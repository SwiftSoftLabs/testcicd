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

interface ZoomTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type: string;
}

interface ZoomUser {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

interface ZoomMeeting {
  id: number | string;
  join_url?: string;
  start_url?: string;
  uuid?: string;
}

function zoomAuthHeader(): string {
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret)
    throw new Error("Zoom OAuth is not configured");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeZoomCode(
  code: string,
): Promise<ZoomTokenResponse> {
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: zoomAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: calendarOAuthCallbackUrl("zoom"),
    }).toString(),
  });
  const data = (await res.json()) as ZoomTokenResponse & {
    reason?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(data.reason || data.error || "Zoom token exchange failed");
  return data;
}

async function refreshZoomToken(row: CalendarIntegrationRow): Promise<string> {
  const refreshToken = decryptRefreshToken(row);
  if (!refreshToken) throw new Error("Reconnect Zoom to refresh access");
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: zoomAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = (await res.json()) as ZoomTokenResponse & {
    reason?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(data.reason || data.error || "Zoom token refresh failed");
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

async function validAccessToken(row: CalendarIntegrationRow): Promise<string> {
  if (
    row.token_expires_at &&
    new Date(row.token_expires_at).getTime() < Date.now() + 120_000
  ) {
    return refreshZoomToken(row);
  }
  return decryptAccessToken(row);
}

export async function fetchZoomUser(
  accessToken: string,
): Promise<{ id: string; email: string | null; name: string | null }> {
  const res = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as ZoomUser & { message?: string };
  if (!res.ok) throw new Error(data.message || "Could not read Zoom user");
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || null;
  return { id: data.id, email: data.email ?? null, name };
}

function zoomMeetingPayload(
  event: Pick<
    CalendarEventDTO,
    "title" | "description" | "startTime" | "timezone"
  >,
) {
  return {
    topic: event.title,
    type: 2,
    start_time: event.startTime,
    timezone: event.timezone,
    agenda: event.description ?? undefined,
    settings: {
      join_before_host: false,
      waiting_room: true,
      approval_type: 2,
    },
  };
}

export async function createZoomConference(
  userId: string,
  event: Pick<
    CalendarEventDTO,
    "title" | "description" | "startTime" | "timezone"
  >,
) {
  const integration = await findCalendarIntegration(userId, "zoom");
  if (!integration) throw new Error("Connect Zoom to generate meeting links");
  const token = await validAccessToken(integration);
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(zoomMeetingPayload(event)),
  });
  const data = (await res.json()) as ZoomMeeting & { message?: string };
  if (!res.ok) throw new Error(data.message || "Zoom meeting creation failed");
  if (!data.join_url) throw new Error("Zoom did not return a join URL");
  await markIntegrationUsed(integration.id);
  return {
    integrationId: integration.id,
    provider: "zoom" as const,
    joinUrl: data.join_url,
    externalEventId: null,
    externalMeetingId: String(data.id),
    metadata: { uuid: data.uuid ?? null },
  };
}

export async function updateZoomConference(
  userId: string,
  meetingId: string,
  event: Pick<
    CalendarEventDTO,
    "title" | "description" | "startTime" | "timezone"
  >,
): Promise<void> {
  const integration = await findCalendarIntegration(userId, "zoom");
  if (!integration) throw new Error("Connect Zoom to update meeting links");
  const token = await validAccessToken(integration);
  const res = await fetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(zoomMeetingPayload(event)),
    },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || "Zoom meeting update failed");
  }
  await markIntegrationUsed(integration.id);
}

export async function deleteZoomConference(
  userId: string,
  meetingId: string,
): Promise<void> {
  const integration = await findCalendarIntegration(userId, "zoom");
  if (!integration) return;
  const token = await validAccessToken(integration);
  const res = await fetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || "Zoom meeting delete failed");
  }
}
