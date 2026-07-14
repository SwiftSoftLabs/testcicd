import { calendarPluginOAuthCallbackUrl } from './oauth';
import { markPluginInstallationUsed } from './repository';
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

interface GraphEvent {
    id: string;
    subject?: string;
    bodyPreview?: string;
    location?: { displayName?: string };
    start?: { dateTime: string; timeZone: string };
    end?: { dateTime: string; timeZone: string };
    isAllDay?: boolean;
    lastModifiedDateTime?: string;
    '@odata.etag'?: string;
    isCancelled?: boolean;
}

function normalizeOutlookEvent(event: GraphEvent): NormalizedPluginEvent | null {
    if (!event.id || !event.start?.dateTime || !event.end?.dateTime) return null;
    return {
        externalEventId: event.id,
        externalCalendarId: null,
        title: event.subject?.trim() || '(No title)',
        description: event.bodyPreview ?? null,
        location: event.location?.displayName ?? null,
        startTime: new Date(event.start.dateTime + (event.start.dateTime.endsWith('Z') ? '' : 'Z')).toISOString(),
        endTime: new Date(event.end.dateTime + (event.end.dateTime.endsWith('Z') ? '' : 'Z')).toISOString(),
        timezone: event.start.timeZone || 'UTC',
        isAllDay: event.isAllDay ?? false,
        status: event.isCancelled ? 'cancelled' : 'confirmed',
        externalUpdatedAt: event.lastModifiedDateTime ? new Date(event.lastModifiedDateTime).toISOString() : null,
        externalEtag: event['@odata.etag'] ?? null,
    };
}

function outlookEventBody(event: PluginEventSnapshot) {
    return {
        subject: event.title,
        body: { contentType: 'text', content: event.description ?? '' },
        location: event.location ? { displayName: event.location } : undefined,
        start: {
            dateTime: event.startTime.replace(/\.\d{3}Z$/, '').replace('Z', ''),
            timeZone: event.timezone,
        },
        end: {
            dateTime: event.endTime.replace(/\.\d{3}Z$/, '').replace('Z', ''),
            timeZone: event.timezone,
        },
        isAllDay: event.isAllDay,
    };
}

export async function exchangeOutlookPluginCode(code: string) {
    const { exchangeMicrosoftAuthorizationCode } = await import('@/lib/email/oauth/microsoft');
    return exchangeMicrosoftAuthorizationCode(code, calendarPluginOAuthCallbackUrl('outlook'));
}

export async function fetchOutlookPluginUser(accessToken: string) {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as {
        id?: string;
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
        error?: { message?: string };
    };
    if (!res.ok || !data.id) throw new Error(data.error?.message || 'Could not read Microsoft account');
    return {
        id: data.id,
        email: data.mail ?? data.userPrincipalName ?? null,
        name: data.displayName ?? null,
    };
}

export const outlookCalendarPlugin: CalendarPluginProviderHandler = {
    capabilities: {
        canCreateArbitraryEvents: true,
        canUpdateEvents: true,
        canDeleteEvents: true,
        supportsWebhooks: true,
    },

    async listCalendars(installation) {
        const token = await validPluginAccessToken(installation);
        const res = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { value?: Array<{ id: string; name: string; isDefaultCalendar?: boolean }>; error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || 'Failed to list Outlook calendars');
        return (data.value ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            primary: c.isDefaultCalendar,
        }));
    },

    async pullChanges(installation): Promise<PullChangesResult> {
        const token = await validPluginAccessToken(installation);
        const cursor = installation.sync_cursor ?? {};
        const deltaLink = typeof cursor.deltaLink === 'string' ? cursor.deltaLink : null;
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const url =
            deltaLink ||
            `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${encodeURIComponent(oneYearAgo.toISOString())}&endDateTime=${encodeURIComponent(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString())}`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = (await res.json()) as {
            value?: GraphEvent[];
            '@odata.deltaLink'?: string;
            '@odata.nextLink'?: string;
            error?: { message?: string };
        };
        if (!res.ok) throw new Error(data.error?.message || 'Outlook calendar sync failed');

        const events: NormalizedPluginEvent[] = [];
        const deleted: string[] = [];
        for (const item of data.value ?? []) {
            if ((item as { '@removed'?: unknown })['@removed']) {
                deleted.push(item.id);
                continue;
            }
            const normalized = normalizeOutlookEvent(item);
            if (normalized) events.push(normalized);
        }

        await markPluginInstallationUsed(installation.id);
        return {
            events,
            deletedExternalIds: deleted,
            nextCursor: { deltaLink: data['@odata.deltaLink'] ?? cursor.deltaLink ?? null },
        };
    },

    async pushCreate(installation, event) {
        const token = await validPluginAccessToken(installation);
        const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(outlookEventBody(event)),
        });
        const data = (await res.json()) as GraphEvent & { error?: { message?: string } };
        if (!res.ok || !data.id) throw new Error(data.error?.message || 'Outlook event create failed');
        await markPluginInstallationUsed(installation.id);
        return {
            externalEventId: data.id,
            externalCalendarId: null,
            etag: data['@odata.etag'] ?? null,
        };
    },

    async pushUpdate(installation, link, event) {
        const token = await validPluginAccessToken(installation);
        const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(link.external_event_id)}`,
            {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(outlookEventBody(event)),
            },
        );
        const data = (await res.json()) as { error?: { message?: string } };
        if (!res.ok) throw new Error(data.error?.message || 'Outlook event update failed');
        await markPluginInstallationUsed(installation.id);
    },

    async pushDelete(installation, link) {
        const token = await validPluginAccessToken(installation);
        const res = await fetch(
            `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(link.external_event_id)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok && res.status !== 404) {
            const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new Error(data.error?.message || 'Outlook event delete failed');
        }
        await markPluginInstallationUsed(installation.id);
    },
};
