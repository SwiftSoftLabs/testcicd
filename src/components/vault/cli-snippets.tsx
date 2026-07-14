'use client';

import { useState } from 'react';

export function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    function handle() {
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch((err) => {
            console.error('[CopyButton] clipboard write failed', err);
            setCopied(false);
        });
    }
    return (
        <button
            onClick={handle}
            className="cursor-pointer shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-surface-dark-2 transition-colors"
            title="Copy"
            type="button"
        >
            <span className="material-symbols-outlined text-sm">
                {copied ? 'check' : 'content_copy'}
            </span>
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

export function CommandBlock({ command }: { command: string }) {
    return (
        <div className="relative group bg-background-dark border border-border-dark rounded-lg">
            <pre className="px-3 py-2.5 pr-16 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed">
                {command}
            </pre>
            <div className="absolute top-1.5 right-1.5">
                <CopyButton value={command} />
            </div>
        </div>
    );
}

export function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-dark-2 border border-border-dark text-[10px] font-semibold text-text-secondary">
                    {n}
                </span>
                <span className="text-xs font-medium text-text-primary">{title}</span>
            </div>
            <div className="pl-7 space-y-1.5">{children}</div>
        </div>
    );
}

type RunExample = 'verify' | 'custom';

const RUN_EXAMPLES: Array<{ id: RunExample; label: string; hint: string }> = [
    { id: 'verify', label: 'Verify injection', hint: 'Prints only your vault vars (no system env)' },
    { id: 'custom', label: 'Any command',      hint: 'Replace the placeholder with your command' },
];

interface CliStepBlocksProps {
    /** Token to embed in commands. Pass `'$ONEWORK_TOKEN'` for reference mode. */
    tokenLiteral: string;
    projectId: string;
    /** Origin to use for ONEWORK_API_URL. Defaults to window.location.origin. */
    apiUrl?: string;
}

export function CliStepBlocks({ tokenLiteral, projectId, apiUrl }: CliStepBlocksProps) {
    const [tab, setTab] = useState<RunExample>('verify');

    const resolvedApiUrl = apiUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

    const setupCmd = 'npm install -g @swiftsoftlabs/onework-vault-cli';
    const exportCmd = `export ONEWORK_TOKEN=${tokenLiteral}
export ONEWORK_API_URL=${resolvedApiUrl}`;

    const runCmds: Record<RunExample, string> = {
        verify: `onework env \\
  --project ${projectId} \\
  --env development`,
        custom: `onework run \\
  --project ${projectId} \\
  --env development \\
  -- <your-command-here>`,
    };

    return (
        <div className="space-y-5">
            <StepCard n={1} title="Install the CLI">
                <CommandBlock command={setupCmd} />
                <p className="text-[11px] text-text-muted">
                    Requires Node.js 18+. Run <code className="font-mono text-text-secondary">onework --version</code> to verify the install.
                </p>
            </StepCard>

            <StepCard n={2} title="Set credentials in your shell">
                <CommandBlock command={exportCmd} />
            </StepCard>

            <StepCard n={3} title="Run any command with vault vars injected">
                <div className="flex items-center gap-1 mb-1">
                    {RUN_EXAMPLES.map((ex) => (
                        <button
                            key={ex.id}
                            onClick={() => setTab(ex.id)}
                            type="button"
                            className={`cursor-pointer px-2.5 py-1 rounded-md text-xs transition-colors ${
                                tab === ex.id
                                    ? 'bg-surface-dark-2 text-text-primary border border-border-dark'
                                    : 'text-text-muted hover:text-text-secondary border border-transparent'
                            }`}
                        >
                            {ex.label}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-text-muted mb-1.5">
                    {RUN_EXAMPLES.find((e) => e.id === tab)?.hint}
                </p>
                <CommandBlock command={runCmds[tab]} />
            </StepCard>
        </div>
    );
}
