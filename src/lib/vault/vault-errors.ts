export class VaultNotConfiguredError extends Error {
    readonly code = 'VAULT_NOT_CONFIGURED' as const;

    constructor(message = 'VAULT_MASTER_KEY environment variable is required but not set') {
        super(message);
        this.name = 'VaultNotConfiguredError';
    }
}

export class VaultKeyMismatchError extends Error {
    readonly code = 'VAULT_KEY_MISMATCH' as const;

    constructor(message = 'Failed to unwrap DEK with provided vault master key candidates') {
        super(message);
        this.name = 'VaultKeyMismatchError';
    }
}

export class VaultSchemaMissingError extends Error {
    readonly code = 'VAULT_SCHEMA_MISSING' as const;

    constructor(message: string) {
        super(message);
        this.name = 'VaultSchemaMissingError';
    }
}

export function isVaultTypedError(e: unknown): e is { code: string; message: string } {
    return (
        e instanceof VaultNotConfiguredError ||
        e instanceof VaultKeyMismatchError ||
        e instanceof VaultSchemaMissingError
    );
}
