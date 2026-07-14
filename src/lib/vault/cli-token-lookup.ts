import crypto from 'crypto';

export const TOKEN_PREFIX = 'ow_';

export function generateCliTokenPlaintext(): string {
    const raw = crypto.randomBytes(32).toString('base64url');
    return `${TOKEN_PREFIX}${raw}`;
}

/** HMAC lookup key for indexed token verification (never store plaintext). */
export function computeCliTokenLookup(plaintext: string, pepper: string): string {
    return crypto.createHmac('sha256', pepper).update(plaintext).digest('hex');
}

export function getCliTokenPepper(): string {
    const explicit = process.env.VAULT_CLI_TOKEN_PEPPER?.trim();
    if (explicit) return explicit;

    const master = process.env.VAULT_MASTER_KEY?.trim();
    if (master) {
        return crypto.createHash('sha256').update(`cli-pepper:${master}`).digest('base64');
    }

    throw new Error('VAULT_CLI_TOKEN_PEPPER or VAULT_MASTER_KEY is required for CLI tokens');
}

export function isCliTokenFormat(presented: string): boolean {
    return presented.startsWith(TOKEN_PREFIX);
}
