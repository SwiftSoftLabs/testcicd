import { decryptAccessToken, decryptRefreshToken, replaceAccessToken } from './repository';
import type { CalendarPluginInstallationRow } from './types';

export async function validPluginAccessToken(row: CalendarPluginInstallationRow): Promise<string> {
    if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now() + 120_000) {
        return refreshPluginToken(row);
    }
    return decryptAccessToken(row);
}

export async function refreshPluginToken(row: CalendarPluginInstallationRow): Promise<string> {
    const refreshToken = decryptRefreshToken(row);
    if (!refreshToken) throw new Error(`Reconnect ${row.provider} to refresh access`);

    if (row.provider === 'google_calendar') {
        const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
        const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) throw new Error('Google Calendar OAuth is not configured');
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'refresh_token',
            }).toString(),
        });
        const data = (await res.json()) as { access_token: string; expires_in?: number; error?: string; error_description?: string };
        if (!res.ok) throw new Error(data.error_description || data.error || 'Google token refresh failed');
        const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
        await replaceAccessToken(row, data.access_token, null, expiresAt);
        return data.access_token;
    }

    if (row.provider === 'outlook') {
        const { refreshMicrosoftAccessToken } = await import('@/lib/email/oauth/microsoft');
        const data = await refreshMicrosoftAccessToken(refreshToken);
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);
        await replaceAccessToken(row, data.access_token, data.refresh_token ?? null, expiresAt);
        return data.access_token;
    }

    if (row.provider === 'calendly') {
        const clientId = process.env.CALENDLY_OAUTH_CLIENT_ID?.trim();
        const clientSecret = process.env.CALENDLY_OAUTH_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) throw new Error('Calendly OAuth is not configured');
        const res = await fetch('https://auth.calendly.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
            }).toString(),
        });
        const data = (await res.json()) as {
            access_token: string;
            expires_in?: number;
            refresh_token?: string;
            error?: string;
            error_description?: string;
        };
        if (!res.ok) throw new Error(data.error_description || data.error || 'Calendly token refresh failed');
        const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
        await replaceAccessToken(row, data.access_token, data.refresh_token ?? null, expiresAt);
        return data.access_token;
    }

    throw new Error('Unsupported provider for token refresh');
}
