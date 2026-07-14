import { calendarPluginOAuthCallbackUrl } from './oauth';
import { markPluginInstallationUsed, updateInstallationSyncCursor } from './repository';
import type { CalendarPluginInstallationRow } from './types';
import type { CalendarPluginProviderHandler } from './provider';
import type {
    CalendarListItem,
    NormalizedPluginEvent,
    PluginEventLinkRow,
    PluginEventSnapshot,
    PullChangesResult,
} from './types';
import { validPluginAccessToken } from './tokens';

interface GoogleCalendarListEntry {
    id: string;
    summary?: string;
    primary?: boolean;
}

interface GoogleEventDate {
    date?: string;
    dateTime?: string;
    timeZone?: string;
}

interface GoogleCalendarEvent {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: GoogleEventDate;
    end?: GoogleEventDate;
    updated?: string;
    etag?: string;
}

function getSelectedCalendarIds(installation: CalendarPluginInstallationRow): string[] {
    const settings = installation.settings as { calendarIds?: string[] };
    if (settings.calendarIds?.length) return settings.calendarIds;
    return ['primary'];
}

function parseGoogleDateTime(
    start: GoogleEventDate | undefined,
    end: GoogleEventDate | undefined,
    fallbackTz: string,
): { startTime: string; endTime: string; timezone: string; isAllDay: boolean } {
    const isAllDay = Boolean(start?.date && !start?.dateTime);
    const tz = start?.timeZone || end?.timeZone || fallbackTz;
    if (isAllDay && start?.date) {
        const startDate = new Date(`${start.date}T00:00:00.000Z`);
        const endDate = end?.date
            ? new Date(`${end.date}T00:00:00.000Z`)
            : new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
        return {
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
            timezone: tz,
            isAllDay: true,
        };
    }
    return {
        startTime: start?.dateTime ? new Date(start.dateTime).toISOString() : new Date().toISOString(),
        endTime: end?.dateTime ? new Date(end.dateTime).toISOString() : new Date().toISOString(),
        timezone: tz,
        isAllDay: false,
    };
}

function normalizeGoogleEvent(event: GoogleCalendarEvent, calendarId: string): NormalizedPluginEvent | null {
    if (!event.id) return null;
    const { startTime, endTime, timezone, isAllDay } = parseGoogleDateTime(event.start, event.end, 'UTC');
    return {
        externalEventId: event.id,
        externalCalendarId: calendarId,
        title: event.summary?.trim() || '(No title)',
        description: event.description ?? null,
        location: event.location ?? null,
        startTime,
        endTime,
        timezone,
        isAllDay,
        status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
        externalUpdatedAt: event.updated ? new Date(event.updated).toISOString() : null,
        externalEtag: event.etag ?? null,
        metadata: { htmlLink: (event as { htmlLink?: string }).htmlLink ?? null },
    };
}

function googleApiDate(value: string, timezone: string, allDay: boolean, isEnd = false) {
    if (allDay) {
        const d = new Date(value);
        if (isEnd) d.setDate(d.getDate() + 1);
        return { date: d.toISOString().slice(0, 10) };
    }
    return { dateTime: value, timeZone: timezone };
}

export async function exchangeGooglePluginCode(code: string) {
    const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Google Calendar OAuth is not configured');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: calendarPluginOAuthCallbackUrl('google_calendar'),
            grant_type: 'authorization_code',
        }).toString(),
    });
    const data = (await res.json()) as {
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        error?: string;
        error_description?: string;
    };
    if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
    return data;
}

export async function fetchGooglePluginUser(accessToken: string) {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as { id?: string; email?: string; name?: string; error?: { message?: string } };
    if (!res.ok || !data.id) throw new Error(data.error?.message || 'Could not read Google account');
    return { id: data.id, email: data.email ?? null, name: data.name ?? null };
}

async function pullCalendarEvents(
    token: string,
    calendarId: string,
    cursor: Record<string, unknown>,
): Promise<{ events: NormalizedPluginEvent[]; deleted: string[]; nextCursor: Record<string, unknown> }> {
    const key = calendarId === 'primary' ? 'primary' : calendarId;
    const calCursor = (cursor[key] as { syncToken?: string; timeMin?: string }) ?? {};
    const params = new URLSearchParams({
        singleEvents: 'true',
        maxResults: '250',
    });
    if (calCursor.syncToken) {
        params.set('syncToken', calCursor.syncToken);
    } else {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        params.set('timeMin', calCursor.timeMin ?? oneYearAgo.toISOString());
    }

    const calendarPath = calendarId === 'primary' ? 'primary' : encodeURIComponent(calendarId);
    const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarPath}/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as {
        items?: GoogleCalendarEvent[];
        nextSyncToken?: string;
        error?: { message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message || 'Google Calendar list failed');

    const events: NormalizedPluginEvent[] = [];
    const deleted: string[] = [];
    for (const item of data.items ?? []) {
        if (item.status === 'cancelled') {
            if (item.id) deleted.push(item.id);
            continue;
        }
        const normalized = normalizeGoogleEvent(item, calendarId);
        if (normalized) events.push(normalized);
    }

    const next: Record<string, unknown> = { ...cursor };
    next[key] = { syncToken: data.nextSyncToken ?? calCursor.syncToken };
    return { events, deleted, nextCursor: next };
}

export const googleCalendarPlugin: CalendarPluginProviderHandler = {
    capabilities: {
        canCreateArbitraryEvents: true,
        canUpdateEvents: true,
        canDeleteEvents: true,
        supportsWebhooks: true,
    },

    async listCalendars(installation) {
        const token = await validPluginAccessToken(installation);
        const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { items?: GoogleCalendarListEntry[]; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || 'Failed to list Google calendars');
        return (data.items ?? []).map((c) => ({
            id: c.id,
            name: c.summary || c.id,
            primary: c.primary,
        }));
    },

    async pullChanges(installation): Promise<PullChangesResult> {
        const token = await validPluginAccessToken(installation);
        const calendarIds = getSelectedCalendarIds(installation);
        let cursor = installation.sync_cursor ?? {};
        const allEvents: NormalizedPluginEvent[] = [];
        const allDeleted: string[] = [];

        for (const calendarId of calendarIds) {
            const result = await pullCalendarEvents(token, calendarId, cursor);
            cursor = result.nextCursor;
            allEvents.push(...result.events);
            allDeleted.push(...result.deleted);
        }

        await markPluginInstallationUsed(installation.id);
        return { events: allEvents, deletedExternalIds: allDeleted, nextCursor: cursor };
    },

    async pushCreate(installation, event) {
        const token = await validPluginAccessToken(installation);
        const calendarIds = getSelectedCalendarIds(installation);
        const calendarId = calendarIds[0] ?? 'primary';
        const calendarPath = calendarId === 'primary' ? 'primary' : encodeURIComponent(calendarId);
        const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarPath}/events?sendUpdates=none`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary: event.title,
                    description: event.description ?? undefined,
                    location: event.location ?? undefined,
                    start: googleApiDate(event.startTime, event.timezone, event.isAllDay),
                    end: googleApiDate(event.endTime, event.timezone, event.isAllDay, true),
                }),
            },
        );
        const data = (await res.json()) as GoogleCalendarEvent & { error?: { message?: string } };
        if (!res.ok || !data.id) throw new Error(data.error?.message || 'Google event create failed');
        await markPluginInstallationUsed(installation.id);
        return {
            externalEventId: data.id,
            externalCalendarId: calendarId,
            etag: data.etag ?? null,
        };
    },

    async pushUpdate(installation, link, event) {
        const token = await validPluginAccessToken(installation);
        const calendarId = link.external_calendar_id ?? getSelectedCalendarIds(installation)[0] ?? 'primary';
        const calendarPath = calendarId === 'primary' ? 'primary' : encodeURIComponent(calendarId);
        const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarPath}/events/${encodeURIComponent(link.external_event_id)}?sendUpdates=none`,
            {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary: event.title,
                    description: event.description ?? undefined,
                    location: event.location ?? undefined,
                    start: googleApiDate(event.startTime, event.timezone, event.isAllDay),
                    end: googleApiDate(event.endTime, event.timezone, event.isAllDay, true),
                }),
            },
        );
        const data = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || 'Google event update failed');
        await markPluginInstallationUsed(installation.id);
    },

    async pushDelete(installation, link) {
        const token = await validPluginAccessToken(installation);
        const calendarId = link.external_calendar_id ?? getSelectedCalendarIds(installation)[0] ?? 'primary';
        const calendarPath = calendarId === 'primary' ? 'primary' : encodeURIComponent(calendarId);
        const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarPath}/events/${encodeURIComponent(link.external_event_id)}?sendUpdates=none`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok && res.status !== 404 && res.status !== 410) {
            const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new Error(data.error?.message || 'Google event delete failed');
        }
        await markPluginInstallationUsed(installation.id);
    },

    async registerWebhook(installation) {
        const token = await validPluginAccessToken(installation);
        const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')}/api/plugins/calendar/webhooks/google`;
        const channelId = `onework-${installation.id}`;
        const res = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: channelId,
                    type: 'web_hook',
                    address: webhookUrl,
                }),
            },
        );
        const data = (await res.json()) as { resourceId?: string; expiration?: string; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || 'Google watch registration failed');
        await updateInstallationSyncCursor(installation.id, {
            ...installation.sync_cursor,
            watchResourceId: data.resourceId,
        });
    },
};

export function toPluginEventSnapshot(event: {
    title: string;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay: boolean;
    status: 'confirmed' | 'cancelled';
}): PluginEventSnapshot {
    return {
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        timezone: event.timezone,
        isAllDay: event.isAllDay,
        status: event.status,
    };
}
