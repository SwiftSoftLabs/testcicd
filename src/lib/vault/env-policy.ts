// Pure, client-safe environment policy — no server-only imports.
// Server code (auth.ts) and client components both import from here.

const PROTECTED_ENV_NAMES = new Set(['production']);

export function isProtectedEnvName(name: string): boolean {
    return PROTECTED_ENV_NAMES.has(name.toLowerCase());
}

export function canSeeProtectedEnv(isAdmin: boolean, envName: string): boolean {
    return isAdmin || !isProtectedEnvName(envName);
}
