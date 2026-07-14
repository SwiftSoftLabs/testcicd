import { NextResponse } from 'next/server';

import { query, SCHEMA } from '@/lib/db';
import { syncCalendarPluginInstallation } from '@/lib/plugins/calendar/sync-engine';
import type { CalendarPluginInstallationRow } from '@/lib/plugins/calendar/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const secret = process.env.CALENDAR_PLUGIN_CRON_SECRET?.trim();
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations
         WHERE status = 'connected'
         ORDER BY last_synced_at ASC NULLS FIRST
         LIMIT 50`,
    );

    const summaries = [];
    for (const installation of result.rows) {
        summaries.push(await syncCalendarPluginInstallation(installation));
    }

    return NextResponse.json({ ok: true, synced: summaries.length, results: summaries });
}
