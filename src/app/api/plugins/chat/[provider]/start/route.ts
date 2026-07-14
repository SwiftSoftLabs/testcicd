import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { signChatPluginOAuthState, safeReturnTo } from '@/lib/plugins/chat/oauth';
import { isChatPluginProvider } from '@/lib/plugins/chat/registry';
import { discordOAuthAuthorizeUrl } from '@/lib/plugins/chat/discord';
import { slackOAuthAuthorizeUrl } from '@/lib/plugins/chat/slack';
import { teamsOAuthAuthorizeUrl } from '@/lib/plugins/chat/teams';
import type { ChatPluginProvider } from '@/lib/plugins/chat/types';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

const querySchema = z.object({
    workspaceId: z.string().uuid(),
    returnTo: z.string().optional(),
    popup: z.enum(['1', 'true', '0', 'false']).optional(),
});

function authorizeUrl(provider: ChatPluginProvider, state: string): string {
    if (provider === 'slack') return slackOAuthAuthorizeUrl(state);
    if (provider === 'teams') return teamsOAuthAuthorizeUrl(state);
    if (provider === 'discord') return discordOAuthAuthorizeUrl(state);
    throw new Error('Unsupported provider');
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    try {
        const { provider: providerParam } = await params;
        if (!isChatPluginProvider(providerParam)) {
            return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
        }
        const provider = providerParam;
        const user = await requireSessionUser(request);
        const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
        await requireManageBotIntegrations(q.workspaceId, user.id);
        const popup = q.popup === '1' || q.popup === 'true';
        const state = signChatPluginOAuthState({
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
        return NextResponse.redirect(`${safeReturnTo(request)}?chatPluginOAuth=error&error=${encodeURIComponent(msg)}`);
    }
}
