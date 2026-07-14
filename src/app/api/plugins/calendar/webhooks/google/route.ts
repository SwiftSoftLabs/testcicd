import { NextResponse } from 'next/server';

import { query, SCHEMA } from '@/lib/db';
import { syncCalendarPluginInstallationById } from '@/lib/plugins/calendar/sync-engine';
import type { CalendarPluginInstallationRow } from '@/lib/plugins/calendar/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const channelId = request.headers.get('x-goog-channel-id');
    const resourceState = request.headers.get('x-goog-resource-state');

    if (!channelId || resourceState === 'sync') {
        return NextResponse.json({ ok: true });
    }

    const installationId = channelId.replace(/^onework-/, '');
    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations WHERE id = $1 AND status = 'connected' LIMIT 1`,
        [installationId],
    );
    const installation = result.rows[0];
    if (!installation) return NextResponse.json({ ok: true });

    try {
        await syncCalendarPluginInstallationById(installation.id);
    } catch {
        /* webhook handler should not fail loudly */
    }

    return NextResponse.json({ ok: true });
}
