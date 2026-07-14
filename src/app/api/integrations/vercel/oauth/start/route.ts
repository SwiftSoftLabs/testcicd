import { NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { getProjectWorkspaceId } from '@/lib/rbac/project-access';
import { signVercelOAuthState, getVercelOAuthAuthorizeUrl } from '@/lib/integrations/vercel/oauth';
import crypto from 'crypto';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');
        const returnTo = searchParams.get('returnTo') ?? '/settings/plugins';

        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        if (
            !process.env.VERCEL_CLIENT_ID?.trim() ||
            !process.env.VERCEL_CLIENT_SECRET?.trim() ||
            !process.env.VERCEL_INTEGRATION_SLUG?.trim()
        ) {
            return NextResponse.json(
                {
                    error:
                        'Vercel OAuth is not configured. Set VERCEL_CLIENT_ID, VERCEL_CLIENT_SECRET, and VERCEL_INTEGRATION_SLUG.',
                },
                { status: 503 },
            );
        }

        const state = signVercelOAuthState({
            userId: user.id,
            workspaceId,
            returnTo,
            exp: Date.now() + 10 * 60 * 1000,
            nonce: crypto.randomBytes(8).toString('hex'),
        });

        const authorizeUrl = getVercelOAuthAuthorizeUrl(state);
        return NextResponse.redirect(authorizeUrl);
    } catch (e) {
        console.error('[vercel/oauth/start]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
