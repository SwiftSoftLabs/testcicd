import { NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { verifyVercelOAuthState, exchangeVercelCode, fetchVercelTeamName } from '@/lib/integrations/vercel/oauth';
import { encryptVercelToken } from '@/lib/integrations/vercel/crypto';
import { query, SCHEMA } from '@/lib/db';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const errorParam = searchParams.get('error');

    const redirectBase = '/settings/plugins';

    if (errorParam) {
        return NextResponse.redirect(
            new URL(`${redirectBase}?vercel=error&error=${encodeURIComponent(errorParam)}`, request.url)
        );
    }

    if (!code || !stateParam) {
        return NextResponse.redirect(
            new URL(`${redirectBase}?vercel=error&error=missing_params`, request.url)
        );
    }

    try {
        const user = await requireSessionUser(request);
        const state = verifyVercelOAuthState(stateParam);

        if (state.userId !== user.id) {
            return NextResponse.redirect(
                new URL(`${redirectBase}?vercel=error&error=user_mismatch`, request.url)
            );
        }

        const tokenResponse = await exchangeVercelCode(code);

        // V1: enforce team-only connections
        if (!tokenResponse.team_id) {
            return NextResponse.redirect(
                new URL(
                    `${redirectBase}?vercel=error&error=${encodeURIComponent('Please select a Vercel team during authorization. Personal account connections are not supported yet.')}`,
                    request.url
                )
            );
        }

        const teamName = await fetchVercelTeamName(tokenResponse.team_id, tokenResponse.access_token);
        const accessTokenEnc = encryptVercelToken(tokenResponse.access_token);
        const refreshTokenEnc = tokenResponse.refresh_token ? encryptVercelToken(tokenResponse.refresh_token) : null;

        await query(
            `INSERT INTO ${SCHEMA}.vercel_integrations
                (workspace_id, connected_by, connection_scope, target_id, target_name,
                 access_token_enc, refresh_token_enc, token_type, scope, updated_at)
             VALUES ($1, $2, 'team', $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (workspace_id, connection_scope, target_id) DO UPDATE SET
                connected_by      = EXCLUDED.connected_by,
                target_name       = EXCLUDED.target_name,
                access_token_enc  = EXCLUDED.access_token_enc,
                refresh_token_enc = EXCLUDED.refresh_token_enc,
                token_type        = EXCLUDED.token_type,
                scope             = EXCLUDED.scope,
                updated_at        = NOW()`,
            [
                state.workspaceId,
                user.id,
                tokenResponse.team_id,
                teamName,
                accessTokenEnc,
                refreshTokenEnc,
                tokenResponse.token_type ?? 'Bearer',
                tokenResponse.scope ?? null,
            ]
        );

        const returnTo = state.returnTo ?? redirectBase;
        return NextResponse.redirect(
            new URL(`${returnTo}${returnTo.includes('?') ? '&' : '?'}vercel=connected`, request.url)
        );
    } catch (e) {
        console.error('[vercel/oauth/callback]', e);
        const msg = e instanceof Error ? e.message : 'OAuth failed';
        return NextResponse.redirect(
            new URL(`${redirectBase}?vercel=error&error=${encodeURIComponent(msg)}`, request.url)
        );
    }
}
