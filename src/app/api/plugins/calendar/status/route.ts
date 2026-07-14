import { NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/db';
import { getCalendarPluginStatuses } from '@/lib/plugins/calendar/repository';

export async function GET(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const plugins = await getCalendarPluginStatuses(user.id);
        return NextResponse.json({
            googleConfigured: Boolean(
                process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim() &&
                process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim(),
            ),
            outlookConfigured: Boolean(
                process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() &&
                process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim(),
            ),
            calendlyConfigured: Boolean(
                process.env.CALENDLY_OAUTH_CLIENT_ID?.trim() &&
                process.env.CALENDLY_OAUTH_CLIENT_SECRET?.trim(),
            ),
            plugins,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to fetch plugin status';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
