import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import { signTaskPluginOAuthState, safeReturnTo } from '@/lib/plugins/tasks/oauth';
import { isTaskPluginProvider } from '@/lib/plugins/tasks/registry';
import { asanaOAuthAuthorizeUrl } from '@/lib/plugins/tasks/asana';
import { clickUpOAuthAuthorizeUrl } from '@/lib/plugins/tasks/clickup';
import { jiraOAuthAuthorizeUrl } from '@/lib/plugins/tasks/jira';
import { trelloAuthorizeUrl } from '@/lib/plugins/tasks/trello';
import type { TaskPluginProvider } from '@/lib/plugins/tasks/types';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

const querySchema = z.object({
    workspaceId: z.string().uuid(),
    returnTo: z.string().optional(),
    popup: z.enum(['1', 'true', '0', 'false']).optional(),
});

function authorizeUrl(provider: TaskPluginProvider, state: string): string {
    if (provider === 'trello') return trelloAuthorizeUrl(state);
    if (provider === 'jira') return jiraOAuthAuthorizeUrl(state);
    if (provider === 'clickup') return clickUpOAuthAuthorizeUrl(state);
    if (provider === 'asana') return asanaOAuthAuthorizeUrl(state);
    throw new Error('Unsupported provider');
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    try {
        const { provider: providerParam } = await params;
        if (!isTaskPluginProvider(providerParam)) {
            return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
        }
        const provider = providerParam;
        const user = await requireSessionUser(request);
        const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
        await requireWorkspaceTasksWrite(q.workspaceId, user.id);
        const popup = q.popup === '1' || q.popup === 'true';
        const state = signTaskPluginOAuthState({
            userId: user.id,
            workspaceId: q.workspaceId,
            provider,
            returnTo: safeReturnTo(request, q.returnTo),
            popup,
            exp: Date.now() + 10 * 60 * 1000,
            nonce: randomBytes(16).toString('hex'),
        });
        return NextResponse.redirect(authorizeUrl(provider, state));
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Invalid request';
        return NextResponse.redirect(`${safeReturnTo(request)}?taskPluginOAuth=error&error=${encodeURIComponent(msg)}`);
    }
}
