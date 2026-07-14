import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';

import { signOAuthState, oauthCallbackUrl, getAppOrigin } from '@/lib/integrations/git/oauth';
import { oauthStartQuerySchema } from '@/lib/integrations/git/schemas';
import {
    jsonError,
    parseProviderParam,
    parseZodError,
    requireSessionUser,
} from '@/lib/integrations/git/route-helpers';
import { isWorkspaceMember, isProjectInWorkspace } from '@/lib/integrations/git/workspace';


export async function GET(
    request: Request,
    context: { params: Promise<{ provider: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const provider = parseProviderParam((await context.params).provider);
        if (provider === 'onework') {
            return jsonError(404, 'OneWork Version Control does not use OAuth');
        }
        const { searchParams } = new URL(request.url);
        const raw = Object.fromEntries(searchParams.entries());
        const q = oauthStartQuerySchema.parse(raw);

        const member = await isWorkspaceMember(q.workspaceId, user.id);
        if (!member) return jsonError(404, 'Workspace not found or access denied');

        const projectOk = await isProjectInWorkspace(q.projectId, q.workspaceId);
        if (!projectOk) return jsonError(404, 'Project not found in this workspace');

        const returnToAbsolute = safeReturnTo(q.returnTo ?? '/settings/git-ssh');

        const state = signOAuthState({
            workspaceId: q.workspaceId,
            projectId: q.projectId,
            userId: user.id,
            returnTo: returnToAbsolute,
            provider,
            exp: Date.now() + 10 * 60 * 1000,
            nonce: randomBytes(16).toString('hex'),
        });

        const redirectUri = oauthCallbackUrl(provider);

        if (provider === 'github') {
            const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
            if (!clientId) return jsonError(503, 'GitHub OAuth not configured');

            const scope = encodeURIComponent('repo read:user read:org read:public_key admin:public_key');
            const url =
                `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&scope=${scope}&state=${encodeURIComponent(state)}`;
            return NextResponse.redirect(url);
        }

        const clientId = process.env.GITLAB_OAUTH_CLIENT_ID?.trim();
        if (!clientId) return jsonError(503, 'GitLab OAuth not configured');

        const scope = encodeURIComponent('read_api read_repository read_user api');
        const url =
            `https://gitlab.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&response_type=code&scope=${scope}&state=${encodeURIComponent(state)}`;
        return NextResponse.redirect(url);
    } catch (e: unknown) {
        const msg = parseZodError(e);
        const origin = safeOrigin();
        return NextResponse.redirect(`${origin}/settings/git-ssh?error=${encodeURIComponent(msg)}`);
    }
}

function safeOrigin(): string {
    try {
        return getAppOrigin();
    } catch {
        return 'http://localhost:3000';
    }
}

function safeReturnTo(pathOrUrl: string): string {
    const origin = safeOrigin();
    if (pathOrUrl.startsWith('http')) {
        try {
            const u = new URL(pathOrUrl);
            const o = new URL(origin);
            if (u.origin === o.origin && u.pathname.startsWith('/')) {
                return pathOrUrl;
            }
        } catch {
            /* fallback */
        }
        return `${origin}/settings/git-ssh`;
    }
    if (pathOrUrl.startsWith('/')) return `${origin}${pathOrUrl}`;
    return `${origin}/settings/git-ssh`;
}
