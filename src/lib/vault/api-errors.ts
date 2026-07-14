import {
    VaultKeyMismatchError,
    VaultNotConfiguredError,
    VaultSchemaMissingError,
} from '@/lib/vault/vault-errors';

export const VAULT_ERROR_CODES = {
    NOT_CONFIGURED: 'VAULT_NOT_CONFIGURED',
    KEY_MISMATCH: 'VAULT_KEY_MISMATCH',
    SCHEMA_MISSING: 'VAULT_SCHEMA_MISSING',
} as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[keyof typeof VAULT_ERROR_CODES];

export interface VaultApiErrorBody {
    error: string;
    code?: VaultErrorCode;
    detail?: string;
}

function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

/** Maps thrown vault/crypto/DB errors to client-safe API responses. */
export function vaultApiErrorFromUnknown(e: unknown): VaultApiErrorBody & { status: number } {
    if (e instanceof VaultNotConfiguredError) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.NOT_CONFIGURED,
            error: 'Environment Vault is not configured on this server.',
            detail:
                'Set VAULT_MASTER_KEY in the deployment environment (32-byte base64: openssl rand -base64 32), then redeploy.',
        };
    }

    if (e instanceof VaultKeyMismatchError) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.KEY_MISMATCH,
            error: 'Vault cannot decrypt secrets for this project.',
            detail:
                'The server encryption key does not match the key used when this project was initialized. Restore the original VAULT_MASTER_KEY or set VAULT_MASTER_KEY_PREVIOUS during rotation.',
        };
    }

    if (e instanceof VaultSchemaMissingError) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.SCHEMA_MISSING,
            error: 'Vault database tables are not available.',
            detail: e.message,
        };
    }

    const message = errorMessage(e);

    if (
        message.includes('VAULT_MASTER_KEY') &&
        (message.includes('required but not set') || message.includes('must be a base64'))
    ) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.NOT_CONFIGURED,
            error: 'Environment Vault is not configured on this server.',
            detail:
                'Set VAULT_MASTER_KEY in the deployment environment (32-byte base64: openssl rand -base64 32), then redeploy.',
        };
    }

    if (message.includes('Failed to unwrap DEK')) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.KEY_MISMATCH,
            error: 'Vault cannot decrypt secrets for this project.',
            detail:
                'The server encryption key does not match the key used when this project was initialized. Restore the original VAULT_MASTER_KEY or set VAULT_MASTER_KEY_PREVIOUS during rotation.',
        };
    }

    if (message.includes('InsForge SQL error') && /vault_/i.test(message)) {
        return {
            status: 503,
            code: VAULT_ERROR_CODES.SCHEMA_MISSING,
            error: 'Vault database tables are not available.',
            detail: 'Run the vault migration (scripts/migrations/005_vault_tables.sql) on the app_onework schema.',
        };
    }

    return {
        status: 500,
        error: 'Internal server error',
    };
}
