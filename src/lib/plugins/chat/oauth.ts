import crypto from 'crypto';

import type { ChatPluginProvider } from './types';

function stateSecret(): Buffer {
    const key = process.env.INSFORGE_API_KEY?.trim();
    if (!key) throw new Error('INSFORGE_API_KEY is required for chat plugin OAuth state signing');
    return crypto.createHash('sha256').update(`chat-plugin-oauth-state:${key}`, 'utf8').digest();
}

export interface ChatPluginOAuthStatePayload {
    userId: string;
    workspaceId: string;
    provider: ChatPluginProvider;
    returnTo: string;
    popup: boolean;
    exp: number;
    nonce: string;
}

export function signChatPluginOAuthState(payload: ChatPluginOAuthStatePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyChatPluginOAuthState(token: string): ChatPluginOAuthStatePayload {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('Invalid OAuth state');
    const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error('Invalid OAuth state signature');
    }
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChatPluginOAuthStatePayload;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) throw new Error('OAuth state expired');
    if (!parsed.userId || !parsed.workspaceId || !parsed.provider || !parsed.returnTo) {
        throw new Error('Malformed OAuth state');
    }
    return parsed;
}

export function getAppOrigin(): string {
    const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!raw) throw new Error('NEXT_PUBLIC_APP_URL is required for chat plugin OAuth callbacks');
    return new URL(raw).origin;
}

export function chatPluginOAuthCallbackUrl(provider: ChatPluginProvider): string {
    return `${getAppOrigin()}/api/plugins/chat/${provider}/callback`;
}

export function safeReturnTo(request: Request, pathOrUrl?: string | null): string {
    const origin = (() => {
        try {
            return getAppOrigin();
        } catch {
            return new URL(request.url).origin;
        }
    })();
    const raw = pathOrUrl?.trim() || '/settings/plugins';
    if (raw.startsWith('http')) {
        try {
            const u = new URL(raw);
            const o = new URL(origin);
            if (u.origin === o.origin && u.pathname.startsWith('/')) return raw;
        } catch {
            /* fallback */
        }
        return `${origin}/settings/plugins`;
    }
    if (raw.startsWith('/')) return `${origin}${raw}`;
    return `${origin}/settings/plugins`;
}
