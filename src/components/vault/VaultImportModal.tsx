'use client';

import { useState } from 'react';
import { parseDotenv } from '@/lib/vault/parse-dotenv';
import { formatVaultVariableName } from '@/lib/vault/variable-names';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface Props {
    projectId: string;
    environmentId: string;
    environmentName: string;
    onImport: (importedCount: number, overwrittenCount: number) => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

type Phase = 'paste' | 'preview' | 'conflicts';

export default function VaultImportModal({
    projectId,
    environmentId,
    environmentName,
    onImport,
    onClose,
    addToast,
}: Props) {
    const [phase, setPhase] = useState<Phase>('paste');
    const [rawText, setRawText] = useState('');
    const [validVars, setValidVars] = useState<Array<{ name: string; value: string }>>([]);
    const [invalidLines, setInvalidLines] = useState<Array<{ line: string; lineNumber: number; reason: string }>>([]);
    const [overwrite, setOverwrite] = useState(false);
    const [conflictingNames, setConflictingNames] = useState<string[]>([]);
    const [importing, setImporting] = useState(false);

    function handlePreview() {
        if (!rawText.trim()) {
            addToast('Paste some .env content first', 'warning');
            return;
        }
        const result = parseDotenv(rawText);
        if (result.valid.length === 0) {
            addToast('No valid variables found in the pasted content', 'warning');
            return;
        }
        setValidVars(result.valid);
        setInvalidLines(result.invalid);
        setPhase('preview');
    }

    async function handleImport(forceOverwrite?: boolean) {
        setImporting(true);
        try {
            const res = await authenticatedFetch('/api/vault/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    environmentId,
                    variables: validVars,
                    overwrite: forceOverwrite ?? overwrite,
                }),
            });
            const json = await res.json();

            if (!res.ok) {
                if (res.status === 409 && json.conflicts) {
                    setConflictingNames(json.conflicts);
                    setPhase('conflicts');
                    return;
                }
                addToast(json.error ?? 'Import failed', 'error');
                return;
            }

            addToast(
                `Imported ${json.data.importedCount} variable${json.data.importedCount !== 1 ? 's' : ''}${json.data.overwrittenCount > 0 ? ` (${json.data.overwrittenCount} overwritten)` : ''}`,
                'success'
            );
            onImport(json.data.importedCount, json.data.overwrittenCount);
        } catch {
            addToast('Network error — please try again', 'error');
        } finally {
            setImporting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between mb-5 shrink-0">
                    <div>
                        <h2 className="text-base font-semibold text-text-primary">Import .env</h2>
                        <p className="text-xs text-text-muted mt-0.5">to <span className="font-medium text-text-secondary">{environmentName}</span></p>
                    </div>
                    <button onClick={onClose} className="cursor-pointer text-text-muted hover:text-text-primary transition-colors" aria-label="Close">
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {phase === 'paste' && (
                        <div className="space-y-4">
                            <p className="text-xs text-text-muted">
                                Paste the contents of a <code className="text-text-secondary">.env</code> file. Variable names will be normalized to uppercase.
                            </p>
                            <textarea
                                value={rawText}
                                onChange={(e) => setRawText(e.target.value)}
                                placeholder={'DATABASE_URL=postgres://...\nAPI_KEY="secret"\n# comments are ignored'}
                                rows={10}
                                className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono resize-none"
                            />
                            <button
                                onClick={handlePreview}
                                className="cursor-pointer w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                            >
                                Preview Variables
                            </button>
                        </div>
                    )}

                    {phase === 'preview' && (
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs text-text-muted mb-2">
                                    <span className="font-medium text-emerald-400">{validVars.length}</span> variable{validVars.length !== 1 ? 's' : ''} ready to import
                                </p>
                                <div className="bg-surface-dark-2 border border-border-dark rounded-lg p-3 max-h-40 overflow-y-auto">
                                    {validVars.map((v) => (
                                        <div key={v.name} className="text-xs font-mono uppercase tracking-wide text-text-secondary py-0.5">
                                            {formatVaultVariableName(v.name)}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {invalidLines.length > 0 && (
                                <div>
                                    <p className="text-xs text-orange-400 mb-2">
                                        {invalidLines.length} line{invalidLines.length !== 1 ? 's' : ''} skipped
                                    </p>
                                    <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3 max-h-28 overflow-y-auto space-y-1">
                                        {invalidLines.map((l) => (
                                            <div key={l.lineNumber} className="text-xs text-orange-400/80">
                                                Line {l.lineNumber}: {l.reason}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={overwrite}
                                    onChange={(e) => setOverwrite(e.target.checked)}
                                    className="rounded"
                                />
                                <span className="text-xs text-text-secondary">
                                    Overwrite existing variables with the same name
                                </span>
                            </label>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setPhase('paste')}
                                    className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={() => handleImport()}
                                    disabled={importing}
                                    className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                                >
                                    {importing ? 'Importing…' : `Import ${validVars.length} Variable${validVars.length !== 1 ? 's' : ''}`}
                                </button>
                            </div>
                        </div>
                    )}

                    {phase === 'conflicts' && (
                        <div className="space-y-4">
                            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
                                <p className="text-sm text-orange-400 font-medium mb-2">
                                    {conflictingNames.length} variable{conflictingNames.length !== 1 ? 's' : ''} already exist
                                </p>
                                <div className="max-h-32 overflow-y-auto space-y-0.5">
                                    {conflictingNames.map((n) => (
                                        <div key={n} className="text-xs font-mono uppercase tracking-wide text-orange-300/80">
                                            {formatVaultVariableName(n)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <p className="text-xs text-text-muted">
                                Importing will overwrite the values for these variables. This action cannot be undone.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setPhase('preview')}
                                    className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={() => handleImport(true)}
                                    disabled={importing}
                                    className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                                >
                                    {importing ? 'Overwriting…' : `Overwrite ${conflictingNames.length} & Import`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
