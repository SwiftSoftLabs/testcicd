import { NextResponse } from 'next/server';

import { query, SCHEMA } from '@/lib/db';
import { syncChatPluginInstallation } from '@/lib/plugins/chat/sync-engine';
import { renewTeamsSubscriptions } from '@/lib/plugins/chat/teams-subscriptions';
import type { ChatPluginInstallationRow } from '@/lib/plugins/chat/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const secret = process.env.CHAT_PLUGIN_CRON_SECRET?.trim();
    const auth = request.headers.get('authorization');
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<ChatPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.chat_plugin_installations
         WHERE status = 'connected'
         ORDER BY last_synced_at ASC NULLS FIRST
         LIMIT 50`,
    );

    const summaries = [];
    for (const installation of result.rows) {
        if (installation.provider === 'teams') {
            try {
                await renewTeamsSubscriptions(installation);
            } catch (err) {
                console.error('[chat cron] teams subscription renew', err);
            }
        }
        summaries.push(await syncChatPluginInstallation(installation));
    }

    return NextResponse.json({ ok: true, synced: summaries.length, results: summaries });
}
