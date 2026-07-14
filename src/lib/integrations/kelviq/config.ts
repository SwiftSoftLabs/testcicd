function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) throw new Error(`${name} is not set. Add it to .env.local (server-only, no NEXT_PUBLIC_ prefix).`);
    return val;
}

export type KelviqMode = 'test' | 'live';

export const KELVIQ_API_BASE_URL = process.env.KELVIQ_API_BASE_URL ?? 'https://api.kelviq.com/api/v1';

export function getKelviqConfig() {
    const mode = (process.env.KELVIQ_MODE ?? 'test') as KelviqMode;
    return {
        mode,
        apiKey: requireEnv('KELVIQ_API_KEY'),
        planIdentifiers: {
            pro: process.env.KELVIQ_VARIANT_PRO ?? 'pro',
            max: process.env.KELVIQ_VARIANT_MAX ?? 'max',
        },
    };
}
