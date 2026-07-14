import { NextResponse } from 'next/server';

import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import { isTaskPluginProvider } from '@/lib/plugins/tasks/registry';
import { syncAllTaskPlugins } from '@/lib/plugins/tasks/sync-engine';
import type { TaskPluginProvider } from '@/lib/plugins/tasks/types';
import { checkSimpleRateLimit } from '@/lib/email/rateLimit';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = (await request.json().catch(() => ({}))) as {
            workspaceId?: string;
            provider?: string;
        };
        if (!body.workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        let provider: TaskPluginProvider | undefined;
        if (body.provider) {
            if (!isTaskPluginProvider(body.provider)) {
                return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
            }
            provider = body.provider;
        }
        const rate = checkSimpleRateLimit(`task-plugin-sync:${body.workspaceId}`, 5, 60_000);
        if (!rate.allowed) {
            return NextResponse.json({ error: 'Too many sync requests' }, { status: 429 });
        }
        await requireWorkspaceTasksWrite(body.workspaceId, user.id);
        const result = await syncAllTaskPlugins(body.workspaceId, provider);
        return NextResponse.json({ ok: true, ...result });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Sync failed' },
            { status: 500 },
        );
    }
}
