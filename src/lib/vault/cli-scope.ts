export const VAULT_CLI_READ_SCOPE = 'vault:read';

export function tokenHasVaultReadScope(scopes: string[]): boolean {
    return scopes.includes(VAULT_CLI_READ_SCOPE);
}

/** NULL or empty allowlist = all environments in the project. */
export function isEnvironmentAllowedByToken(
    allowedEnvironments: string[] | null | undefined,
    environmentName: string,
): boolean {
    if (!allowedEnvironments || allowedEnvironments.length === 0) {
        return true;
    }
    const normalized = environmentName.toLowerCase();
    return allowedEnvironments.some((env) => env.toLowerCase() === normalized);
}

export function normalizeAllowedEnvironments(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
    }
    return out;
}
