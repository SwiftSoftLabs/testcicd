import { NextResponse } from 'next/server';

import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { getChatPluginHandler, isChatPluginProvider } from '@/lib/plugins/chat/registry';
import { decryptInstallationToken, findChatPluginInstallation } from '@/lib/plugins/chat/repository';
import { validChatPluginAccessToken } from '@/lib/plugins/chat/tokens';
import type { ChatPluginProvider } from '@/lib/plugins/chat/types';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    try {
        const { provider: providerParam } = await params;
        if (!isChatPluginProvider(providerParam)) {
            return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
        }
        const provider = providerParam as ChatPluginProvider;
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireManageBotIntegrations(workspaceId, user.id);
        const installation = await findChatPluginInstallation(workspaceId, provider);
        if (!installation) {
            return NextResponse.json({ error: `${provider} not connected` }, { status: 404 });
        }
        const token =
            provider === 'slack'
                ? decryptInstallationToken(installation)
                : await validChatPluginAccessToken(installation);
        const handler = getChatPluginHandler(provider);
        const channels = await handler.listChannels(installation, token);
        return NextResponse.json({ channels });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to list channels' },
            { status: 500 },
        );
    }
}
