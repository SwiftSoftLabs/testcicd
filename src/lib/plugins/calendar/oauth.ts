import crypto from 'crypto';

import type { CalendarPluginProvider } from './types';

function stateSecret(): Buffer {
    const key = process.env.INSFORGE_API_KEY?.trim();
    if (!key) throw new Error('INSFORGE_API_KEY is required for calendar plugin OAuth state signing');
    return crypto.createHash('sha256').update(`calendar-plugin-oauth-state:${key}`, 'utf8').digest();
}

export interface CalendarPluginOAuthStatePayload {
    userId: string;
    provider: CalendarPluginProvider;
    returnTo: string;
    popup: boolean;
    exp: number;
    nonce: string;
}

export function signCalendarPluginOAuthState(payload: CalendarPluginOAuthStatePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyCalendarPluginOAuthState(token: string): CalendarPluginOAuthStatePayload {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new Error('Invalid OAuth state');
    const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error('Invalid OAuth state signature');
    }
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CalendarPluginOAuthStatePayload;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) throw new Error('OAuth state expired');
    if (!parsed.userId || !parsed.provider || !parsed.returnTo) throw new Error('Malformed OAuth state');
    return parsed;
}

export function getAppOrigin(): string {
    const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!raw) throw new Error('NEXT_PUBLIC_APP_URL is required for calendar plugin OAuth callbacks');
    return new URL(raw).origin;
}

const PROVIDER_PATH: Record<CalendarPluginProvider, string> = {
    google_calendar: 'google_calendar',
    outlook: 'outlook',
    calendly: 'calendly',
};

export function calendarPluginOAuthCallbackUrl(provider: CalendarPluginProvider): string {
    return `${getAppOrigin()}/api/plugins/calendar/${PROVIDER_PATH[provider]}/callback`;
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

export function parsePluginProviderParam(raw: string): CalendarPluginProvider {
    if (raw === 'google_calendar' || raw === 'google') return 'google_calendar';
    if (raw === 'outlook') return 'outlook';
    if (raw === 'calendly') return 'calendly';
    throw new Error('Unsupported calendar plugin provider');
}
