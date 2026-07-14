'use client';

import { useState } from 'react';
import type { VaultVariableMeta } from '@/types/vault';
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
    normalizeVaultVariableName,
    validateVaultVariableName,
} from '@/lib/vault/variable-names';

interface Props {
    projectId: string;
    environmentId: string;
    initialVar?: VaultVariableMeta;
    onSave: (saved: VaultVariableMeta) => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function VaultVariableModal({
    projectId,
    environmentId,
    initialVar,
    onSave,
    onClose,
    addToast,
}: Props) {
    const isEdit = !!initialVar;
    const [name, setName] = useState(initialVar?.name ?? '');
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [nameError, setNameError] = useState('');

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const err = validateVaultVariableName(name);
        if (err) { setNameError(err); return; }
        const normalizedName = normalizeVaultVariableName(name);
        if (!value) { addToast('Value cannot be empty', 'error'); return; }

        setSaving(true);
        try {
            let res: Response;
            if (isEdit) {
                res = await authenticatedFetch('/api/vault/variables', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: initialVar!.id,
                        projectId,
                        value,
                        updatedAt: initialVar!.updated_at,
                    }),
                });
            } else {
                res = await authenticatedFetch('/api/vault/variables', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId, environmentId, name: normalizedName, value }),
                });
            }

            const json = await res.json();
            if (!res.ok) {
                if (res.status === 409) {
                    addToast(json.error ?? 'Conflict — refresh and try again', 'warning');
                } else {
                    addToast(json.error ?? 'Failed to save variable', 'error');
                }
                return;
            }
            addToast(isEdit ? 'Variable updated' : 'Variable created', 'success');
            onSave(json.data);
        } catch {
            addToast('Network error — please try again', 'error');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-md p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-semibold text-text-primary">
                        {isEdit ? 'Edit Variable' : 'Add Variable'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="cursor-pointer text-text-muted hover:text-text-primary transition-colors"
                        aria-label="Close"
                    >
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            Variable Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(normalizeVaultVariableName(e.target.value));
                                setNameError('');
                            }}
                            disabled={isEdit}
                            placeholder="DATABASE_URL"
                            className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                        />
                        {nameError && (
                            <p className="mt-1 text-xs text-red-400">{nameError}</p>
                        )}
                        {isEdit && (
                            <p className="mt-1 text-xs text-text-muted">
                                Variable names cannot be changed. Delete and recreate to rename.
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">
                            {isEdit ? 'New Value' : 'Value'}
                        </label>
                        <textarea
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={isEdit ? 'Enter new value to replace current' : 'Enter secret value'}
                            rows={3}
                            className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-none"
                        />
                        <p className="mt-1 text-xs text-text-muted">
                            Value is encrypted before storage and never logged.
                        </p>
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary hover:border-border-dark-hover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                        >
                            {saving ? 'Saving…' : isEdit ? 'Update' : 'Add Variable'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
