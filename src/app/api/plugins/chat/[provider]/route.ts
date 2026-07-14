import { NextResponse } from 'next/server';

import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { deleteChatPluginInstallation } from '@/lib/plugins/chat/repository';
import { isChatPluginProvider } from '@/lib/plugins/chat/registry';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    try {
        const { provider: providerParam } = await params;
        if (!isChatPluginProvider(providerParam)) {
            return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
        }
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireManageBotIntegrations(workspaceId, user.id);
        await deleteChatPluginInstallation(workspaceId, providerParam);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
    }
}
