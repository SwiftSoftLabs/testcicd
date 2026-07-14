'use client';

import { CliStepBlocks } from './cli-snippets';

interface Props {
    projectId: string;
    onClose: () => void;
}

// Persistent CLI usage reference. Shown via the panel's "CLI usage" button.
// Commands embed `$ONEWORK_TOKEN` as a placeholder — no real token is rendered,
// so this modal is safe to leave open or screen-share.
export default function CliUsageModal({ projectId, onClose }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark shrink-0">
                    <h3 className="text-sm font-semibold text-text-primary">CLI Usage</h3>
                    <button onClick={onClose} className="cursor-pointer text-text-muted hover:text-text-primary transition-colors" type="button">
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </div>

                <div className="px-5 py-5 space-y-5 overflow-y-auto">
                    <p className="text-xs text-text-secondary">
                        Reference for running the CLI against this project. Set <code className="font-mono text-text-primary">$ONEWORK_TOKEN</code> in your shell once (using a token from this panel) — the commands below will pick it up.
                    </p>

                    <CliStepBlocks tokenLiteral="$ONEWORK_TOKEN" projectId={projectId} />
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="cursor-pointer ml-auto px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                        type="button"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
