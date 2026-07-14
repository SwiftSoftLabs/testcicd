'use client';

import type { VaultErrorCode } from '@/lib/vault/api-errors';
import { VAULT_ERROR_CODES } from '@/lib/vault/api-errors';

interface Props {
    code: VaultErrorCode;
    message: string;
    detail?: string;
    projectName?: string;
    onRetry?: () => void;
}

function copyForCode(code: VaultErrorCode): { title: string; bullets: string[] } {
    switch (code) {
        case VAULT_ERROR_CODES.NOT_CONFIGURED:
            return {
                title: 'Vault encryption isn’t configured',
                bullets: [
                    'Secrets are encrypted on the server before they reach the database. Without a master key, Vault cannot initialize environments or store variables.',
                    'Whoever deploys OneWork must add VAULT_MASTER_KEY to the hosting environment (Production, Preview, etc.), then redeploy.',
                    'Use the same key for every environment that shares this database. Changing the key after data exists can make existing secrets unreadable.',
                ],
            };
        case VAULT_ERROR_CODES.KEY_MISMATCH:
            return {
                title: 'Vault can’t decrypt this project',
                bullets: [
                    'This project already has an encryption key in the database, but the server’s VAULT_MASTER_KEY does not match.',
                    'Restore the original key, or set VAULT_MASTER_KEY_PREVIOUS during a documented key rotation.',
                ],
            };
        case VAULT_ERROR_CODES.SCHEMA_MISSING:
            return {
                title: 'Vault database setup is incomplete',
                bullets: [
                    'The vault tables are missing or out of date on the InsForge schema.',
                    'Apply scripts/migrations/005_vault_tables.sql (or the vault block in SETUP_DATABASE.sql) for app_onework.',
                ],
            };
        default:
            return { title: 'Environment Vault is unavailable', bullets: [] };
    }
}

export default function VaultUnavailableState({
    code,
    message,
    detail,
    projectName,
    onRetry,
}: Props) {
    const { title, bullets } = copyForCode(code);

    return (
        <div className="w-full p-6">
            <div className="mb-4">
                {projectName && (
                    <p className="text-xs text-text-muted mb-1">Project: {projectName}</p>
                )}
            </div>

            <div className="max-w-2xl mx-auto">
                <div className="bg-surface-dark border border-amber-500/30 rounded-xl overflow-hidden">
                    <div className="flex items-start gap-4 px-6 py-5 border-b border-border-dark bg-amber-500/5">
                        <span className="material-symbols-outlined text-3xl text-amber-400 shrink-0 mt-0.5">
                            shield_lock
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                            <p className="text-sm text-text-secondary mt-1">{message}</p>
                        </div>
                    </div>

                    <div className="px-6 py-5 space-y-3">
                        <ul className="space-y-2 text-sm text-text-muted list-disc pl-5">
                            {bullets.map((b) => (
                                <li key={b}>{b}</li>
                            ))}
                        </ul>

                        {detail && (
                            <div className="rounded-lg bg-surface-dark-2 border border-border-dark px-4 py-3">
                                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                                    For operators
                                </p>
                                <p className="text-xs text-text-secondary font-mono break-words">{detail}</p>
                            </div>
                        )}

                        <p className="text-xs text-text-muted">
                            Not on the deployment team? Ask your workspace admin to configure Vault on the server.
                        </p>

                        {onRetry && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                <span className="material-symbols-outlined text-base">refresh</span>
                                Try again
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
