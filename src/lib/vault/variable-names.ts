/** Vault variable names: uppercase ASCII, leading letter or underscore. */
export const VAULT_VARIABLE_NAME_REGEX = /^[A-Z_][A-Z0-9_]{0,127}$/;

export const VAULT_VARIABLE_NAME_HINT =
    'Must match ^[A-Z_][A-Z0-9_]{0,127}$ (uppercase letters, digits, underscores)';

export function normalizeVaultVariableName(raw: string): string {
    return raw.trim().toUpperCase();
}

export function isValidVaultVariableName(name: string): boolean {
    return VAULT_VARIABLE_NAME_REGEX.test(name);
}

export function validateVaultVariableName(raw: string): string {
    const name = normalizeVaultVariableName(raw);
    if (!name) return 'Name is required';
    if (!isValidVaultVariableName(name)) return VAULT_VARIABLE_NAME_HINT;
    return '';
}

/** Canonical display form for vault variable names in the UI. */
export function formatVaultVariableName(name: string): string {
    return normalizeVaultVariableName(name);
}
