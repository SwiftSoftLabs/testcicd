'use client';

import type { VaultCliTokenWithPlaintext } from '@/types/vault';
import { CliStepBlocks, CopyButton } from './cli-snippets';

interface Props {
    token: VaultCliTokenWithPlaintext;
    projectId: string;
    title?: string;
    onClose: () => void;
}

export default function RevealTokenModal({ token, projectId, title = 'Copy Your Token', onClose }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark shrink-0">
                    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                </div>

                <div className="px-5 py-5 space-y-5 overflow-y-auto">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
                        <span className="material-symbols-outlined text-base text-amber-400 mt-0.5">warning</span>
                        <p className="text-xs text-amber-400 font-medium">
                            This token will not be shown again. Copy it now.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs text-text-muted mb-1.5">Your token</label>
                        <div className="bg-background-dark border border-border-dark rounded-lg flex items-center gap-2 pr-1.5">
                            <code className="flex-1 px-3 py-2 text-xs text-emerald-400 font-mono break-all">
                                {token.plaintext}
                            </code>
                            <CopyButton value={token.plaintext} />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-border-dark" />
                        <span className="text-[10px] uppercase tracking-wider text-text-muted">How to use it</span>
                        <div className="flex-1 h-px bg-border-dark" />
                    </div>

                    <CliStepBlocks tokenLiteral={token.plaintext} projectId={projectId} />
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="cursor-pointer ml-auto px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
