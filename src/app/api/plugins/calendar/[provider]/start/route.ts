import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getUserFromRequest } from '@/lib/db';
import { calendarPluginOAuthCallbackUrl, parsePluginProviderParam, safeReturnTo, signCalendarPluginOAuthState } from '@/lib/plugins/calendar/oauth';
import type { CalendarPluginProvider } from '@/lib/plugins/calendar/types';

const querySchema = z.object({
    returnTo: z.string().optional(),
    popup: z.enum(['1', 'true', '0', 'false']).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
    try {
        const user = await getUserFromRequest(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const provider = parsePluginProviderParam((await context.params).provider);
        const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
        const popup = q.popup === '1' || q.popup === 'true';
        const returnTo = safeReturnTo(request, q.returnTo);
        const state = signCalendarPluginOAuthState({
            userId: user.id,
            provider,
            returnTo,
            popup,
            exp: Date.now() + 10 * 60 * 1000,
            nonce: randomBytes(16).toString('hex'),
        });

        const url = buildOAuthUrl(provider, state);
        return NextResponse.redirect(url);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Invalid request';
        return NextResponse.redirect(`${safeReturnTo(request, '/settings/plugins')}?pluginOAuth=error&error=${encodeURIComponent(msg)}`);
    }
}

function buildOAuthUrl(provider: CalendarPluginProvider, state: string): string {
    if (provider === 'google_calendar') {
        const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
        if (!clientId) throw new Error('Google Calendar OAuth is not configured');
        const auth = new URLSearchParams({
            client_id: clientId,
            redirect_uri: calendarPluginOAuthCallbackUrl(provider),
            response_type: 'code',
            scope: [
                'openid',
                'email',
                'profile',
                'https://www.googleapis.com/auth/calendar',
            ].join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state,
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${auth.toString()}`;
    }

    if (provider === 'outlook') {
        const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
        if (!clientId) throw new Error('Microsoft Outlook OAuth is not configured');
        const auth = new URLSearchParams({
            client_id: clientId,
            redirect_uri: calendarPluginOAuthCallbackUrl(provider),
            response_type: 'code',
            scope: [
                'openid',
                'email',
                'profile',
                'offline_access',
                'User.Read',
                'Calendars.ReadWrite',
            ].join(' '),
            state,
        });
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${auth.toString()}`;
    }

    const clientId = process.env.CALENDLY_OAUTH_CLIENT_ID?.trim();
    if (!clientId) throw new Error('Calendly OAuth is not configured');
    const auth = new URLSearchParams({
        client_id: clientId,
        redirect_uri: calendarPluginOAuthCallbackUrl(provider),
        response_type: 'code',
        state,
    });
    return `https://auth.calendly.com/oauth/authorize?${auth.toString()}`;
}
