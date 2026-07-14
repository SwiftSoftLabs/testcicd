import { calendarPluginOAuthCallbackUrl } from './oauth';
import { markPluginInstallationUsed } from './repository';
import type { CalendarPluginInstallationRow } from './types';
import type { CalendarPluginProviderHandler } from './provider';
import type {
    NormalizedPluginEvent,
    PluginEventLinkRow,
    PluginEventSnapshot,
    PullChangesResult,
} from './types';
import { validPluginAccessToken } from './tokens';

interface CalendlyScheduledEvent {
    uri: string;
    name?: string;
    status?: string;
    start_time?: string;
    end_time?: string;
    event_type?: string;
    location?: { type?: string; location?: string };
    updated_at?: string;
}

function uriToId(uri: string): string {
    const parts = uri.split('/');
    return parts[parts.length - 1] ?? uri;
}

function normalizeCalendlyEvent(event: CalendlyScheduledEvent): NormalizedPluginEvent | null {
    if (!event.uri || !event.start_time || !event.end_time) return null;
    const id = uriToId(event.uri);
    const location =
        typeof event.location === 'object' && event.location
            ? event.location.location ?? event.location.type ?? null
            : null;
    return {
        externalEventId: id,
        externalCalendarId: null,
        title: event.name?.trim() || 'Calendly booking',
        description: event.event_type ?? null,
        location,
        startTime: new Date(event.start_time).toISOString(),
        endTime: new Date(event.end_time).toISOString(),
        timezone: 'UTC',
        isAllDay: false,
        status: event.status === 'canceled' ? 'cancelled' : 'confirmed',
        externalUpdatedAt: event.updated_at ? new Date(event.updated_at).toISOString() : null,
        externalEtag: null,
        metadata: { uri: event.uri },
    };
}

export async function exchangeCalendlyPluginCode(code: string) {
    const clientId = process.env.CALENDLY_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.CALENDLY_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Calendly OAuth is not configured');
    const res = await fetch('https://auth.calendly.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: calendarPluginOAuthCallbackUrl('calendly'),
            client_id: clientId,
            client_secret: clientSecret,
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
    if (!res.ok) throw new Error(data.error_description || data.error || 'Calendly token exchange failed');
    return data;
}

export async function fetchCalendlyPluginUser(accessToken: string) {
    const res = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as {
        resource?: { uri?: string; email?: string; name?: string };
        error?: string;
    };
    if (!res.ok || !data.resource?.uri) throw new Error(data.error || 'Could not read Calendly account');
    return {
        id: uriToId(data.resource.uri),
        email: data.resource.email ?? null,
        name: data.resource.name ?? null,
        userUri: data.resource.uri,
    };
}

async function getCalendlyUserUri(installation: CalendarPluginInstallationRow, token: string): Promise<string> {
    const settings = installation.settings as { userUri?: string };
    if (settings.userUri) return settings.userUri;
    const user = await fetchCalendlyPluginUser(token);
    return user.userUri;
}

export const calendlyCalendarPlugin: CalendarPluginProviderHandler = {
    capabilities: {
        canCreateArbitraryEvents: false,
        canUpdateEvents: false,
        canDeleteEvents: true,
        supportsWebhooks: true,
    },

    async listCalendars() {
        return [{ id: 'calendly', name: 'Calendly bookings', primary: true }];
    },

    async pullChanges(installation): Promise<PullChangesResult> {
        const token = await validPluginAccessToken(installation);
        const userUri = await getCalendlyUserUri(installation, token);
        const cursor = installation.sync_cursor ?? {};
        const pageToken = typeof cursor.pageToken === 'string' ? cursor.pageToken : undefined;
        const params = new URLSearchParams({
            user: userUri,
            status: 'active',
            count: '100',
            sort: 'start_time:asc',
        });
        if (pageToken) params.set('page_token', pageToken);

        const minStart = new Date();
        minStart.setFullYear(minStart.getFullYear() - 1);
        params.set('min_start_time', minStart.toISOString());

        const res = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
            collection?: CalendlyScheduledEvent[];
            pagination?: { next_page_token?: string };
            error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Calendly sync failed');

        const events: NormalizedPluginEvent[] = [];
        for (const item of data.collection ?? []) {
            const normalized = normalizeCalendlyEvent(item);
            if (normalized) events.push(normalized);
        }

        await markPluginInstallationUsed(installation.id);
        return {
            events,
            deletedExternalIds: [],
            nextCursor: { pageToken: data.pagination?.next_page_token ?? null, userUri },
        };
    },

    async pushCreate() {
        throw new Error('Calendly does not support creating arbitrary calendar events from OneWork. Bookings sync inbound only.');
    },

    async pushUpdate(_installation, _link, _event) {
        throw new Error('Calendly bookings cannot be edited from OneWork. Update the booking in Calendly.');
    },

    async pushDelete(installation, link) {
        const token = await validPluginAccessToken(installation);
        const uri =
            typeof link.metadata === 'object' && link.metadata && 'uri' in link.metadata
                ? String((link.metadata as { uri?: string }).uri)
                : `https://api.calendly.com/scheduled_events/${link.external_event_id}`;
        const res = await fetch(`${uri}/cancellation`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reason: 'Cancelled from OneWork' }),
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { message?: string; title?: string };
            throw new Error(data.message || data.title || 'Calendly cancellation failed');
        }
        await markPluginInstallationUsed(installation.id);
    },
};
