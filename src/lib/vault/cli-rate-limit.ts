import { NextResponse } from 'next/server';
import { checkSimpleRateLimit } from '@/lib/email/rateLimit';

/** In-memory limits per process. Distributed Redis/Upstash is intentionally deferred. */

export const VAULT_CLI_FAIL_LIMIT = 20;
export const VAULT_CLI_FAIL_WINDOW_MS = 15 * 60 * 1000;

export const VAULT_CLI_PULL_LIMIT = 120;
export const VAULT_CLI_PULL_WINDOW_MS = 60 * 60 * 1000;

export const VAULT_CLI_CREATE_LIMIT = 10;
export const VAULT_CLI_CREATE_WINDOW_MS = 60 * 60 * 1000;

export function checkVaultCliRateLimit(
    key: string,
    limit: number,
    windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
    return checkSimpleRateLimit(key, limit, windowMs);
}

export function vaultCliRateLimitResponse(retryAfterMs?: number): NextResponse {
    const headers: Record<string, string> = {};
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
        headers['Retry-After'] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
    }
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers });
}
