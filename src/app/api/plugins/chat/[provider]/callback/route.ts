import { NextResponse } from 'next/server';

import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { verifyChatPluginOAuthState, safeReturnTo } from '@/lib/plugins/chat/oauth';
import { isChatPluginProvider } from '@/lib/plugins/chat/registry';
import { upsertChatPluginInstallation } from '@/lib/plugins/chat/repository';
import { exchangeDiscordOAuthCode } from '@/lib/plugins/chat/discord';
import { exchangeSlackOAuthCode } from '@/lib/plugins/chat/slack';
import { exchangeTeamsOAuthCode } from '@/lib/plugins/chat/teams';
import type { ChatPluginProvider } from '@/lib/plugins/chat/types';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

function popupResponse(payload: { status: 'connected' | 'error'; error?: string; provider?: string }): NextResponse {
    const body = `<!DOCTYPE html><html><body><script>
(function(){var m=${JSON.stringify({ source: 'onework-chat-plugin-oauth', ...payload })};
try{if(window.opener&&!window.opener.closed)window.opener.postMessage(m,location.origin);}catch(e){}
window.close();})();</script></body></html>`;
    return new NextResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function completeOAuth(provider: ChatPluginProvider, code: string, request: Request) {
    if (provider === 'slack') {
        const token = await exchangeSlackOAuthCode(code);
        return {
            teamId: token.teamId,
            teamName: token.teamName,
            botUserId: token.botUserId,
            accessToken: token.accessToken,
            refreshToken: null as string | null,
            tokenExpiresAt: null as Date | null,
        };
    }
    if (provider === 'discord') {
        const guildId = new URL(request.url).searchParams.get('guild_id');
        const token = await exchangeDiscordOAuthCode(code, guildId);
        return {
            teamId: token.teamId,
            teamName: token.teamName,
            botUserId: token.botUserId,
            accessToken: token.accessToken,
            refreshToken: null as string | null,
            tokenExpiresAt: null as Date | null,
        };
    }
    const token = await exchangeTeamsOAuthCode(code);
    return {
        teamId: token.teamId,
        teamName: token.teamName,
        botUserId: token.botUserId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
    };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    const { provider: providerParam } = await params;
    if (!isChatPluginProvider(providerParam)) {
        return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }
    const provider = providerParam;

    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') ?? '';
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');

    let payload;
    try {
        payload = verifyChatPluginOAuthState(state);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Invalid OAuth state';
        return NextResponse.redirect(
            safeReturnTo(request, '/settings/plugins') + `?chatPluginOAuth=error&error=${encodeURIComponent(msg)}`,
        );
    }

    if (payload.provider !== provider) {
        return NextResponse.redirect(
            `${payload.returnTo}?chatPluginOAuth=error&error=${encodeURIComponent('Provider mismatch')}`,
        );
    }

    const fail = (message: string) => {
        if (payload.popup) return popupResponse({ status: 'error', error: message, provider });
        return NextResponse.redirect(
            `${payload.returnTo}?chatPluginOAuth=error&provider=${provider}&error=${encodeURIComponent(message)}`,
        );
    };

    if (oauthError) return fail(oauthError);
    if (!code) return fail('Missing authorization code');

    const user = await requireSessionUser(request);
    if (!user || user.id !== payload.userId) return fail('Session mismatch');

    try {
        await requireManageBotIntegrations(payload.workspaceId, user.id);
        const token = await completeOAuth(provider, code, request);
        await upsertChatPluginInstallation({
            workspaceId: payload.workspaceId,
            installedBy: user.id,
            provider,
            teamId: token.teamId,
            teamName: token.teamName,
            botUserId: token.botUserId,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenExpiresAt: token.tokenExpiresAt,
        });
        if (payload.popup) return popupResponse({ status: 'connected', provider });
        return NextResponse.redirect(`${payload.returnTo}?chatPluginOAuth=connected&provider=${provider}`);
    } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : 'Connection failed');
    }
}
