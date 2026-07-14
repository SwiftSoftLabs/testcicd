"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
    formatChatThreadDigest,
    parseChatThreadDigest,
    type ChatThreadDigest,
} from '@/lib/chat/chatAiDigestFormat';
import { useUIContext } from '@/context/UIContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import {
    AiBorderCard,
    AiOutlineButton,
    AiSparkle,
    aiGradientTextClass,
} from "@/components/ai/AiUi";

interface ChatCatchUpPanelProps {
    conversationId: string;
    messageCount: number;
    compact?: boolean;
    disabled?: boolean;
}

function DigestSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{title}</h4>
            {children}
        </section>
    );
}

function CatchUpDigestBody({ digest }: { digest: ChatThreadDigest }) {
    const hasContent =
        digest.summary.length > 0 || digest.focus.length > 0 || digest.openQuestions.length > 0;

    if (!hasContent) {
        return <p className="text-sm text-text-secondary">No summary available for this thread.</p>;
    }

    return (
        <div className="space-y-4">
            {digest.summary ? (
                <p className="text-sm leading-relaxed text-text-main">{digest.summary}</p>
            ) : null}
            {digest.focus.length > 0 ? (
                <DigestSection title="Focus">
                    <ul className="space-y-2">
                        {digest.focus.map((item, i) => (
                            <li
                                key={i}
                                className="flex gap-2 text-sm leading-snug text-text-main"
                            >
                                <span
                                    className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/80"
                                    aria-hidden
                                />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </DigestSection>
            ) : null}
            {digest.openQuestions.length > 0 ? (
                <DigestSection title="Open questions">
                    <ul className="space-y-2">
                        {digest.openQuestions.map((item, i) => (
                            <li
                                key={i}
                                className="flex gap-2 text-sm leading-snug text-text-secondary"
                            >
                                <span
                                    className="mt-0.5 shrink-0 material-symbols-outlined text-[16px] text-amber-400/90"
                                    aria-hidden
                                >
                                    help
                                </span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </DigestSection>
            ) : null}
        </div>
    );
}

export const ChatCatchUpPanel: React.FC<ChatCatchUpPanelProps> = ({
    conversationId,
    messageCount,
    compact = false,
    disabled = false,
}) => {
    const { addToast } = useUIContext();
    const wrapRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [digest, setDigest] = useState<ChatThreadDigest | null>(null);

    const close = useCallback(() => setOpen(false), []);
    useClickOutside(wrapRef, close, open);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, close]);

    useEffect(() => {
        setOpen(false);
        setDigest(null);
    }, [conversationId]);

    const runDigest = async () => {
        if (!conversationId) return;
        setBusy(true);
        setDigest(null);
        setOpen(true);
        try {
            const data = await api.chat.runAi({
                kind: 'thread_digest',
                conversationId,
                sinceUnread: true,
            });
            setDigest(parseChatThreadDigest(data));
        } catch (e) {
            setOpen(false);
            addToast(e instanceof Error ? e.message : 'AI request failed', 'error');
        } finally {
            setBusy(false);
        }
    };

    const copyDigest = async () => {
        if (!digest) return;
        const text = formatChatThreadDigest({
            summary: digest.summary,
            focus: digest.focus,
            open_questions: digest.openQuestions,
        });
        try {
            await navigator.clipboard.writeText(text);
            addToast('Summary copied', 'success');
        } catch {
            addToast('Could not copy to clipboard', 'warning');
        }
    };

    if (!conversationId) return null;

    return (
        <div className="relative" ref={wrapRef}>
            {compact ? (
                <button
                    type="button"
                    disabled={disabled || messageCount === 0 || busy}
                    onClick={() => void runDigest()}
                    aria-label="Catch up on unread messages"
                    className="cursor-pointer inline-flex size-8 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/[0.08] text-violet-300 hover:bg-violet-500/[0.14] hover:border-violet-400/45 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                    {busy ? (
                        <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin" />
                    ) : (
                        <span className="material-symbols-outlined text-[18px]">summarize</span>
                    )}
                </button>
            ) : (
                <AiOutlineButton
                    busy={busy}
                    disabled={disabled || messageCount === 0}
                    icon="summarize"
                    onClick={() => void runDigest()}
            >
                    Catch up
                </AiOutlineButton>
            )}

            {open && (
                <div
                    role="dialog"
                    aria-label="Catch-up summary"
                    className="absolute right-0 top-full z-80 mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-dark bg-background-dark shadow-2xl ring-1 ring-white/10"
                >
                    <div className="border-b border-border-dark bg-surface-dark px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10">
                                    <AiSparkle size="sm" />
                                </span>
                                <div className="min-w-0">
                                    <p className={`text-sm font-bold ${aiGradientTextClass()}`}>
                                        Catch-up summary
                                    </p>
                                    <p className="text-[11px] text-text-secondary">
                                        {busy ? 'Analyzing recent messages…' : 'Unread & recent activity'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                className="cursor-pointer shrink-0 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                                aria-label="Close summary"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[min(70vh,26rem)] overflow-y-auto custom-scrollbar px-4 py-4 bg-background-dark">
                        {busy ? (
                            <div className="space-y-3" aria-busy="true">
                                <div className="h-3 w-full animate-pulse rounded bg-white/10" />
                                <div className="h-3 w-[92%] animate-pulse rounded bg-white/8" />
                                <div className="h-3 w-[78%] animate-pulse rounded bg-white/6" />
                                <div className="mt-4 h-2.5 w-16 animate-pulse rounded bg-white/10" />
                                <div className="h-3 w-full animate-pulse rounded bg-white/8" />
                                <div className="h-3 w-[85%] animate-pulse rounded bg-white/6" />
                            </div>
                        ) : digest ? (
                            <CatchUpDigestBody digest={digest} />
                        ) : null}
                    </div>

                    {digest && !busy ? (
                        <div className="flex items-center justify-end gap-2 border-t border-border-dark bg-surface-dark px-4 py-2.5">
                            <button
                                type="button"
                                onClick={() => void copyDigest()}
                                className="cursor-pointer inline-flex items-center gap-1 rounded-lg border border-border-dark bg-surface-highlight px-2.5 py-1.5 text-xs font-semibold text-text-main transition-colors hover:bg-white/5"
                            >
                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                Copy
                            </button>
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    )
}
