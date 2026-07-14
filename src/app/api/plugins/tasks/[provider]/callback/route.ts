import { NextResponse } from 'next/server';

import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import { exchangeAsanaCode } from '@/lib/plugins/tasks/asana';
import { exchangeClickUpCode, fetchClickUpUser } from '@/lib/plugins/tasks/clickup';
import { exchangeJiraCode } from '@/lib/plugins/tasks/jira';
import { verifyTaskPluginOAuthState, safeReturnTo } from '@/lib/plugins/tasks/oauth';
import { isTaskPluginProvider } from '@/lib/plugins/tasks/registry';
import { upsertTaskPluginInstallation } from '@/lib/plugins/tasks/repository';
import { fetchTrelloMember } from '@/lib/plugins/tasks/trello';
import type { TaskPluginProvider } from '@/lib/plugins/tasks/types';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

const TASK_PLUGIN_OAUTH_SOURCE = 'onework-task-plugin-oauth';

function popupResponse(payload: {
    status: 'connected' | 'error';
    error?: string;
    provider?: string;
}): NextResponse {
    const body = `<!DOCTYPE html><html><body><script>
(function(){var m=${JSON.stringify({ source: TASK_PLUGIN_OAUTH_SOURCE, ...payload })};
try{if(window.opener&&!window.opener.closed)window.opener.postMessage(m,location.origin);}catch(e){}
window.close();})();</script></body></html>`;
    return new NextResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function completeOAuth(
    provider: TaskPluginProvider,
    request: Request,
    code: string | null,
    tokenFromQuery: string | null,
) {
    if (provider === 'trello') {
        const token = tokenFromQuery;
        if (!token) throw new Error('Missing Trello token');
        const member = await fetchTrelloMember(token);
        return {
            accountId: member.id,
            accountName: member.fullName ?? member.username ?? 'Trello',
            accountEmail: member.email ?? null,
            accessToken: token,
            refreshToken: null as string | null,
            settings: {} as Record<string, unknown>,
        };
    }
    if (provider === 'clickup') {
        if (!code) throw new Error('Missing authorization code');
        const accessToken = await exchangeClickUpCode(code);
        const user = await fetchClickUpUser(accessToken);
        return {
            accountId: user.id,
            accountName: user.name,
            accountEmail: user.email,
            accessToken,
            refreshToken: null,
            settings: {},
        };
    }
    if (provider === 'asana') {
        if (!code) throw new Error('Missing authorization code');
        const asana = await exchangeAsanaCode(code);
        if (!asana.workspaceGid) throw new Error('No Asana workspace found for this account');
        return {
            accountId: asana.accountId,
            accountName: asana.accountName,
            accountEmail: asana.accountEmail,
            accessToken: asana.accessToken,
            refreshToken: asana.refreshToken,
            settings: {
                workspaceGid: asana.workspaceGid,
                workspaceName: asana.workspaceName,
                tokenExpiresAt: new Date(Date.now() + asana.expiresIn * 1000).toISOString(),
            },
        };
    }
    if (!code) throw new Error('Missing authorization code');
    const jira = await exchangeJiraCode(code);
    return {
        accountId: jira.accountId,
        accountName: jira.accountName,
        accountEmail: jira.accountEmail,
        accessToken: jira.accessToken,
        refreshToken: jira.refreshToken,
        settings: {
            cloudId: jira.cloudId,
            siteUrl: jira.siteUrl,
            tokenExpiresAt: new Date(Date.now() + jira.expiresIn * 1000).toISOString(),
        },
    };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ provider: string }> },
) {
    const { provider: providerParam } = await params;
    if (!isTaskPluginProvider(providerParam)) {
        return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }
    const provider = providerParam;

    const { searchParams, pathname } = new URL(request.url);
    const state = searchParams.get('state') ?? '';
    const code = searchParams.get('code');
    let token = searchParams.get('token');
    const oauthError = searchParams.get('error');

    if (provider === 'trello' && !token && !oauthError) {
        const bridge = `<!DOCTYPE html><html><body><script>
(function(){
  var params=new URLSearchParams(location.hash.replace(/^#/,''));
  var t=params.get('token');
  var s=${JSON.stringify(state)}||new URLSearchParams(location.search).get('state');
  if(!t){document.body.textContent='Trello authorization failed — no token.';return;}
  var q=new URLSearchParams({token:t});
  if(s) q.set('state',s);
  location.replace(${JSON.stringify(pathname)}+'?'+q.toString());
})();</script></body></html>`;
        return new NextResponse(bridge, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    let payload;
    try {
        payload = verifyTaskPluginOAuthState(state);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Invalid OAuth state';
        return NextResponse.redirect(
            safeReturnTo(request, '/settings/plugins') + `?taskPluginOAuth=error&error=${encodeURIComponent(msg)}`,
        );
    }

    if (payload.provider !== provider) {
        return NextResponse.redirect(
            `${payload.returnTo}?taskPluginOAuth=error&error=${encodeURIComponent('Provider mismatch')}`,
        );
    }

    const fail = (message: string) => {
        if (payload.popup) return popupResponse({ status: 'error', error: message, provider });
        return NextResponse.redirect(
            `${payload.returnTo}?taskPluginOAuth=error&provider=${provider}&error=${encodeURIComponent(message)}`,
        );
    };

    if (oauthError) return fail(oauthError);

    const user = await requireSessionUser(request);
    if (!user || user.id !== payload.userId) return fail('Session mismatch');

    try {
        await requireWorkspaceTasksWrite(payload.workspaceId, user.id);
        const creds = await completeOAuth(provider, request, code, token);
        await upsertTaskPluginInstallation({
            workspaceId: payload.workspaceId,
            installedBy: user.id,
            provider,
            accountId: creds.accountId,
            accountName: creds.accountName,
            accountEmail: creds.accountEmail,
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            settings: creds.settings,
        });
        if (payload.popup) return popupResponse({ status: 'connected', provider });
        return NextResponse.redirect(`${payload.returnTo}?taskPluginOAuth=connected&provider=${provider}`);
    } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : 'Connection failed');
    }
}
