import { NextResponse } from 'next/server';

import { query, SCHEMA } from '@/lib/db';
import { syncTaskPluginInstallation } from '@/lib/plugins/tasks/sync-engine';
import type { TaskPluginInstallationRow } from '@/lib/plugins/tasks/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const secret = process.env.TASK_PLUGIN_CRON_SECRET?.trim();
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<TaskPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.task_plugin_installations
         WHERE status = 'connected'
         ORDER BY last_synced_at ASC NULLS FIRST
         LIMIT 50`,
    );

    const summaries = [];
    for (const installation of result.rows) {
        summaries.push(await syncTaskPluginInstallation(installation));
    }

    return NextResponse.json({ ok: true, synced: summaries.length, results: summaries });
}
