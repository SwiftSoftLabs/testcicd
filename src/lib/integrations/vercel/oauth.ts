import crypto from 'crypto';
import { getAppOrigin } from '@/lib/integrations/git/oauth';
import type { VercelTokenResponse } from './types';

const VERCEL_API = 'https://api.vercel.com';

function getOAuthStateSecret(): Buffer {
    const key = process.env.INSFORGE_API_KEY?.trim();
    if (!key) throw new Error('INSFORGE_API_KEY is required for Vercel OAuth state signing');
    return crypto.createHash('sha256').update(`vercel-oauth-state:${key}`, 'utf8').digest();
}

export interface VercelOAuthStatePayload {
    userId: string;
    workspaceId: string;
    returnTo: string;
    exp: number;
    nonce: string;
}

export function signVercelOAuthState(payload: VercelOAuthStatePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', getOAuthStateSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyVercelOAuthState(token: string): VercelOAuthStatePayload {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('Invalid Vercel OAuth state');
    const expected = crypto.createHmac('sha256', getOAuthStateSecret()).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        throw new Error('Invalid Vercel OAuth state signature');
    }
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VercelOAuthStatePayload;
    if (Date.now() > parsed.exp) throw new Error('Vercel OAuth state expired');
    if (!parsed.userId || !parsed.workspaceId || !parsed.returnTo) {
        throw new Error('Malformed Vercel OAuth state');
    }
    return parsed;
}

export function vercelOAuthCallbackUrl(): string {
    return `${getAppOrigin()}/api/integrations/vercel/oauth/callback`;
}

/**
 * Classic Vercel Integration Console install URL.
 * Do NOT use https://vercel.com/oauth/authorize with Integration Client IDs —
 * that endpoint is for "Sign in with Vercel" apps and returns "The app ID is invalid".
 * @see https://vercel.com/docs/integrations/create-integration
 */
export function getVercelOAuthAuthorizeUrl(state: string): string {
    const slug = process.env.VERCEL_INTEGRATION_SLUG?.trim();
    if (!slug) {
        throw new Error(
            'VERCEL_INTEGRATION_SLUG is not configured (Integration Console → URL Slug)',
        );
    }
    const params = new URLSearchParams({ state });
    return `https://vercel.com/integrations/${encodeURIComponent(slug)}/new?${params}`;
}

export async function exchangeVercelCode(code: string): Promise<VercelTokenResponse> {
    const clientId = process.env.VERCEL_CLIENT_ID?.trim();
    const clientSecret = process.env.VERCEL_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Vercel OAuth is not configured');
    const redirectUri = vercelOAuthCallbackUrl();
    const res = await fetch(`${VERCEL_API}/v2/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        }),
        cache: 'no-store',
    });
    const data = await res.json() as VercelTokenResponse & { error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description ?? data.error ?? 'Vercel token exchange failed');
    }
    return data;
}

export async function fetchVercelTeamName(teamId: string, accessToken: string): Promise<string | null> {
    try {
        const res = await fetch(`${VERCEL_API}/v2/teams/${teamId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        });
        if (!res.ok) return null;
        const data = await res.json() as { name?: string };
        return data.name ?? null;
    } catch {
        return null;
    }
}
