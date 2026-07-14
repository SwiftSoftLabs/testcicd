import { NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/db';
import { checkSimpleRateLimit } from '@/lib/email/rateLimit';
import { syncAllCalendarPluginsForUser, syncCalendarPluginForUser } from '@/lib/plugins/calendar/sync-engine';
import type { CalendarPluginProvider } from '@/lib/plugins/calendar/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rate = checkSimpleRateLimit(`calendar-plugin-sync:${user.id}`, 5, 60_000);
    if (!rate.allowed) {
        return NextResponse.json(
            { error: 'Too many sync requests. Please retry.' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.retryAfterMs || 0) / 1000)) } },
        );
    }

    let provider: CalendarPluginProvider | undefined;
    try {
        const body = (await request.json().catch(() => ({}))) as { provider?: CalendarPluginProvider };
        provider = body.provider;
    } catch {
        provider = undefined;
    }

    try {
        const results = provider
            ? [await syncCalendarPluginForUser(user.id, provider)]
            : await syncAllCalendarPluginsForUser(user.id);
        return NextResponse.json({ ok: true, results });
    } catch (error: unknown) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Calendar plugin sync failed' },
            { status: 500 },
        );
    }
}
