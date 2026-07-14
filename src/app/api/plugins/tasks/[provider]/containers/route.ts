import { NextResponse } from 'next/server';

import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import { getTaskPluginHandler, isTaskPluginProvider } from '@/lib/plugins/tasks/registry';
import { findTaskPluginInstallation } from '@/lib/plugins/tasks/repository';
import { validTaskPluginAccessToken } from '@/lib/plugins/tasks/tokens';
import type { TaskPluginProvider } from '@/lib/plugins/tasks/types';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    try {
        const { provider: providerParam } = await params;
        if (!isTaskPluginProvider(providerParam)) {
            return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
        }
        const provider = providerParam as TaskPluginProvider;
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireWorkspaceTasksWrite(workspaceId, user.id);
        const installation = await findTaskPluginInstallation(workspaceId, provider);
        if (!installation) {
            return NextResponse.json({ error: `${provider} not connected` }, { status: 404 });
        }
        const token = await validTaskPluginAccessToken(installation);
        const handler = getTaskPluginHandler(provider);
        const containers = await handler.listContainers(installation, token);
        return NextResponse.json({ containers });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to list containers' },
            { status: 500 },
        );
    }
}
