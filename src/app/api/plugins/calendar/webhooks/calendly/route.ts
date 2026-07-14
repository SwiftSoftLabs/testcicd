import { NextResponse } from 'next/server';

import { query, SCHEMA } from '@/lib/db';
import { syncCalendarPluginInstallationById } from '@/lib/plugins/calendar/sync-engine';
import type { CalendarPluginInstallationRow } from '@/lib/plugins/calendar/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    let payload: { event?: string; payload?: { scheduled_event?: { uri?: string } } };
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const eventType = payload.event ?? '';
    if (!eventType.startsWith('invitee.')) {
        return NextResponse.json({ ok: true });
    }

    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations
         WHERE provider = 'calendly' AND status = 'connected'`,
    );

    for (const installation of result.rows) {
        try {
            await syncCalendarPluginInstallationById(installation.id);
        } catch {
            /* continue */
        }
    }

    return NextResponse.json({ ok: true });
}
