import { NextResponse } from 'next/server';

import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { syncAllLinkedChannels } from '@/lib/plugins/chat/sync-engine';
import { formatSlackErrorForUser, isSlackMissingScopeError } from '@/lib/plugins/chat/slack';
import type { ChatPluginProvider } from '@/lib/plugins/chat/types';
import { isChatPluginProvider } from '@/lib/plugins/chat/registry';
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
        let provider: ChatPluginProvider | undefined;
        if (body.provider) {
            if (!isChatPluginProvider(body.provider)) {
                return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
            }
            provider = body.provider;
        }
        const rate = checkSimpleRateLimit(`chat-plugin-sync:${body.workspaceId}`, 5, 60_000);
        if (!rate.allowed) {
            return NextResponse.json({ error: 'Too many sync requests' }, { status: 429 });
        }
        await requireManageBotIntegrations(body.workspaceId, user.id);
        const result = await syncAllLinkedChannels(body.workspaceId, provider);
        return NextResponse.json({ ok: true, ...result });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg =
            error instanceof Error && isSlackMissingScopeError(error)
                ? formatSlackErrorForUser(error)
                : error instanceof Error
                  ? error.message
                  : 'Sync failed';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
