'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import type { BillingPlan, BillingSummary, OverQuotaResource } from '@/types/billing';
import { formatStorageBytes } from '@/lib/billing/formatBytes';
import { authenticatedFetch } from '@/lib/authenticated-fetch';

// Kelviq currently only supports IMMEDIATE cancellation (no period-end), so the
// Resume action has no meaning today — once canceled, there's nothing to resume.
// When Kelviq exposes a period-end cancellationType, flip this to true and
// restore the cancel route's cancel_at_period_end semantics.
// See docs/billing-deferred-work.md.
const RESUME_ENABLED = false;

type UsageBarTone = 'primary' | 'amber' | 'danger';

function usageBarTone(overLimit: boolean, pct: number): UsageBarTone {
    if (overLimit) return 'danger';
    if (pct >= 80) return 'amber';
    return 'primary';
}

function UsageProgressBar({ pct, tone }: { pct: number; tone: UsageBarTone }) {
    return (
        <progress
            className={`billing-usage-progress billing-usage-progress--${tone}`}
            value={Math.min(100, Math.max(0, pct))}
            max={100}
            aria-hidden="true"
        />
    );
}

function formatUsagePeriodReset(
    currentPeriodEnd: string | null,
    isPaidSubscription: boolean,
): string {
    if (currentPeriodEnd && isPaidSubscription) {
        const d = new Date(currentPeriodEnd);
        return `Resets ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return 'Resets on the 1st of each month';
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
    const unlimited = max === null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((used / max) * 100));
    const overLimit = !unlimited && used > max;

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3 text-[10px] font-black text-text-secondary uppercase tracking-widest">
                <span className="shrink-0">{label}</span>
                {unlimited ? (
                    <span className="shrink-0 text-right whitespace-nowrap text-white normal-case tracking-normal font-bold">
                        {used.toLocaleString()} · Unlimited
                    </span>
                ) : (
                    <span className={`shrink-0 text-right whitespace-nowrap ${overLimit ? 'text-red-400' : 'text-white'}`}>
                        {used.toLocaleString()} / {max.toLocaleString()}
                    </span>
                )}
            </div>
            {unlimited ? (
                <p className="text-[10px] text-text-secondary">No limit on this plan</p>
            ) : (
                <UsageProgressBar pct={pct} tone={usageBarTone(overLimit, pct)} />
            )}
        </div>
    );
}

function StorageUsageBar({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }) {
    const pct = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
    const overLimit = usedBytes > limitBytes;
    const remaining = Math.max(0, limitBytes - usedBytes);

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3 text-[10px] font-black text-text-secondary uppercase tracking-widest">
                <span className="shrink-0">Storage</span>
                <span className={`shrink-0 text-right whitespace-nowrap ${overLimit ? 'text-red-400' : 'text-white'}`}>
                    {formatStorageBytes(usedBytes)} / {formatStorageBytes(limitBytes)}
                </span>
            </div>
            <UsageProgressBar pct={pct} tone={usageBarTone(overLimit, pct)} />
            <p className="text-[10px] text-text-secondary">
                {formatStorageBytes(remaining)} remaining · includes all workspace files and call recordings
            </p>
            <Link
                href="/files"
                className="inline-flex items-center gap-1 text-[10px] font-bold text-primary hover:text-blue-300 transition-colors"
            >
                View files
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </Link>
        </div>
    );
}

function CallMinutesUsageBar({
    usedMinutes,
    maxMinutes,
    periodResetLabel,
}: {
    usedMinutes: number;
    maxMinutes: number | null;
    periodResetLabel: string;
}) {
    const unlimited = maxMinutes === null;
    const pct = unlimited ? 0 : Math.min(100, Math.round((usedMinutes / maxMinutes) * 100));
    const overLimit = !unlimited && usedMinutes > maxMinutes;
    const remaining = unlimited ? 0 : Math.max(0, maxMinutes - usedMinutes);

    return (
        <div className="min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3 text-[10px] font-black text-text-secondary uppercase tracking-widest">
                <span className="shrink-0">Call minutes</span>
                {unlimited ? (
                    <span className="shrink-0 text-right whitespace-nowrap text-white normal-case tracking-normal font-bold">
                        {usedMinutes.toLocaleString()} min · Unlimited
                    </span>
                ) : (
                    <span className={`shrink-0 text-right whitespace-nowrap ${overLimit ? 'text-red-400' : 'text-white'}`}>
                        {usedMinutes.toLocaleString()} / {maxMinutes.toLocaleString()} min
                    </span>
                )}
            </div>
            {unlimited ? (
                <p className="text-[10px] text-text-secondary">
                    No monthly cap on this plan · {periodResetLabel.toLowerCase()}
                </p>
            ) : (
                <>
                    <UsageProgressBar pct={pct} tone={usageBarTone(overLimit, pct)} />
                    <p className="text-[10px] text-text-secondary">
                        {remaining.toLocaleString()} min remaining · {periodResetLabel.toLowerCase()}
                    </p>
                </>
            )}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        basic:    'bg-white/10 text-text-secondary border-white/5',
        active:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
        pending:  'bg-amber-500/20 text-amber-400 border-amber-500/20',
        past_due: 'bg-red-500/20 text-red-400 border-red-500/20',
        canceled: 'bg-white/10 text-text-secondary border-white/5',
        trialing: 'bg-purple-500/20 text-purple-400 border-purple-500/20',
    };
    const label: Record<string, string> = {
        basic:    'Free',
        active:   'Active',
        pending:  'Pending',
        past_due: 'Past Due',
        canceled: 'Canceled',
        trialing: 'Trial',
    };
    const cls = map[status] ?? map.basic;
    return (
        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest border ${cls}`}>
            {label[status] ?? status}
        </span>
    );
}

const OVER_QUOTA_LABEL: Record<OverQuotaResource['resource'], string> = {
    projects: 'Projects',
    seats: 'Members',
    channels: 'Channels',
    inboxes: 'Inboxes',
};

function describeOverQuota(r: OverQuotaResource): string {
    if (r.resource === 'seats') {
        return `Members: ${r.used} of ${r.limit} — deactivate ${r.used - r.limit} to continue. We won't remove anyone for you.`;
    }
    const perUser = r.resource === 'inboxes' ? ' per user' : '';
    const lockedNote = r.locked > 0 ? `, ${r.locked} read-only` : '';
    return `${OVER_QUOTA_LABEL[r.resource]}: ${r.used} of ${r.limit}${perUser}${lockedNote}`;
}

function formatOverQuotaList(resources: OverQuotaResource[]): string {
    return resources
        .map((resource) => `${OVER_QUOTA_LABEL[resource.resource]} (${resource.used}/${resource.limit})`)
        .join(', ');
}

function formatPlanPrice(plan: BillingPlan, lockedUnitPriceCents: number | null): string {
    if (plan.price_cents === null) return 'Contact Sales';

    const priceCents = lockedUnitPriceCents ?? plan.price_cents;
    if (priceCents === 0) return 'Free';

    return `$${(priceCents / 100).toFixed(0)}`;
}

const BillingSettings: React.FC = () => {
    const { selectedWorkspaceId, selectedWorkspace, currentUser } = useAppContext();
    const { openModal, addToast } = useUIContext();

    const [summary, setSummary] = useState<BillingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [isLifecycleLoading, setIsLifecycleLoading] = useState(false);
    const [isOpeningPortal, setIsOpeningPortal] = useState(false);
    const [isActivating, setIsActivating] = useState(false);

    const verifyRanRef = useRef(false);

    const fetchSummary = useCallback(async () => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        setError(null);
        try {
            // Bypass the browser HTTP cache so we always observe fresh state — important
            // after webhook-driven DB updates (upgrade activation, cancel) and during the
            // post-checkout polling loop.
            const res = await authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`, { cache: 'no-store' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Failed to load billing info' }));
                throw new Error(body.error ?? 'Failed to load billing info');
            }
            const { data } = await res.json() as { data: BillingSummary };
            setSummary(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load billing info');
        } finally {
            setLoading(false);
        }
    }, [selectedWorkspaceId]);

    // Detect ?checkout=success on mount. The actual subscription activation happens
    // server-side via the subscription.created webhook. We toast immediately so the
    // user sees progress, then poll /api/billing/summary briefly until the webhook
    // lands and our DB reflects 'active'. Falls back to a "still processing" toast
    // after ~30s — at that point the reconcile cron or a manual refresh will catch up.
    useEffect(() => {
        if (!selectedWorkspaceId || verifyRanRef.current) return;

        const params = new URLSearchParams(window.location.search);
        const checkoutParam = params.get('checkout');
        const wsParam = params.get('workspaceId');

        if (checkoutParam !== 'success' || wsParam !== selectedWorkspaceId) return;
        verifyRanRef.current = true;

        window.history.replaceState(null, '', window.location.pathname);
        addToast('Payment received — activating your plan...', 'success');
        setIsActivating(true);

        let cancelled = false;
        const POLL_INTERVAL_MS = 2000;
        const MAX_ATTEMPTS = 15; // ~30s total

        (async () => {
            for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
                try {
                    const res = await authenticatedFetch(
                        `/api/billing/summary?workspaceId=${selectedWorkspaceId}`,
                        { cache: 'no-store' },
                    );
                    if (res.ok) {
                        const { data } = await res.json() as { data: BillingSummary };
                        const status = data.subscription.status;
                        if (status === 'active' || status === 'trialing') {
                            if (!cancelled) {
                                setSummary(data);
                                setIsActivating(false);
                                addToast('Subscription activated. Welcome to your new plan!', 'success');
                            }
                            return;
                        }
                    }
                } catch (err) {
                    console.error('Activation poll failed:', err);
                }
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            }
            if (!cancelled) {
                setIsActivating(false);
                addToast(
                    'Your payment is still processing. Refresh in a moment to see your plan.',
                    'success',
                );
                await fetchSummary();
            }
        })();

        return () => { cancelled = true; setIsActivating(false); };
    }, [selectedWorkspaceId, addToast, fetchSummary]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    const handleCancel = useCallback(() => {
        if (!selectedWorkspaceId) return;
        // Deferred-cancel pattern: Kelviq's billing stops immediately but we keep Pro
        // access locally until current_period_end. Kelviq's portal will show the sub as
        // already canceled — that's surfaced in the confirm modal so users aren't surprised.
        const endIso = summary?.subscription.current_period_end;
        const endLabel = endIso
            ? new Date(endIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'the end of your current billing period';

        openModal('confirm-action', {
            title: 'Cancel your subscription?',
            message: `Your plan will continue until ${endLabel}, then your workspace will return to Basic. You won't be charged for the next period. This cannot be undone.`,
            content: (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 flex items-start gap-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">info</span>
                    <p className="text-xs text-blue-300/90 leading-relaxed">
                        Kelviq's billing portal may show this subscription as already canceled — that's expected. Your OneWork access continues until {endLabel}.
                    </p>
                </div>
            ),
            confirmLabel: 'Cancel subscription',
            confirmInProgressLabel: 'Canceling...',
            cancelLabel: 'Keep plan',
            intent: 'danger',
            onConfirm: async () => {
                const res = await authenticatedFetch('/api/billing/subscription/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workspaceId: selectedWorkspaceId }),
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({ error: 'Cancellation failed' }));
                    throw new Error(body.error ?? 'Cancellation failed');
                }
                addToast(`Cancellation scheduled. You'll keep Pro access until ${endLabel}.`, 'success');
                await fetchSummary();
            },
        });
    }, [selectedWorkspaceId, openModal, addToast, fetchSummary, summary]);

    const handleResume = useCallback(async () => {
        if (!selectedWorkspaceId || isLifecycleLoading) return;
        setIsLifecycleLoading(true);
        try {
            const res = await authenticatedFetch('/api/billing/subscription/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: selectedWorkspaceId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Resume failed' }));
                addToast(body.error ?? 'Resume failed', 'error');
                return;
            }
            addToast('Subscription resumed. Your plan will continue renewing.', 'success');
            await fetchSummary();
        } catch {
            addToast('Failed to resume subscription. Please try again.', 'error');
        } finally {
            setIsLifecycleLoading(false);
        }
    }, [selectedWorkspaceId, isLifecycleLoading, addToast, fetchSummary]);

    const handleOpenPortal = useCallback(async () => {
        if (!selectedWorkspaceId || isOpeningPortal) return;
        setIsOpeningPortal(true);
        try {
            const res = await authenticatedFetch('/api/billing/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: selectedWorkspaceId }),
            });
            const body = await res.json().catch(() => ({})) as { url?: string; error?: string };
            if (!res.ok || !body.url) {
                addToast(body.error ?? 'Could not open billing portal. Please try again.', 'error');
                return;
            }
            window.open(body.url, '_blank', 'noopener,noreferrer');
        } catch {
            addToast('Could not open billing portal. Please try again.', 'error');
        } finally {
            setIsOpeningPortal(false);
        }
    }, [selectedWorkspaceId, isOpeningPortal, addToast]);

    const handleUpgrade = useCallback(async (planCode: string) => {
        if (!selectedWorkspaceId || isCheckingOut) return;
        setIsCheckingOut(true);
        try {
            const res = await authenticatedFetch('/api/billing/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: selectedWorkspaceId, planCode }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Checkout failed' }));
                addToast(body.error ?? 'Checkout failed', 'error');
                setIsCheckingOut(false);
                return;
            }
            const { checkoutUrl } = await res.json() as { checkoutUrl: string };
            window.location.href = checkoutUrl;
        } catch {
            addToast('Failed to start checkout. Please try again.', 'error');
            setIsCheckingOut(false);
        }
    }, [selectedWorkspaceId, isCheckingOut, addToast]);

    const handleOpenQuotaKeep = useCallback(() => {
        if (!selectedWorkspaceId || !summary) return;
        openModal('quota-keep', {
            workspaceId: selectedWorkspaceId,
            overQuota: summary.overQuota,
            onDone: fetchSummary,
        });
    }, [selectedWorkspaceId, summary, openModal, fetchSummary]);

    if (!selectedWorkspaceId) return null;

    if (loading) {
        return (
            <div className="space-y-8 animate-pulse">
                {[1, 2, 3].map(i => (
                    <div key={i} className="bg-surface-dark border border-border-dark rounded-2xl h-48" />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-surface-dark border border-border-dark rounded-2xl p-8 text-center">
                <p className="text-text-secondary text-sm mb-4">{error}</p>
                <button onClick={fetchSummary} className="cursor-pointer px-4 py-2 bg-primary text-white text-xs font-black rounded-lg">
                    Retry
                </button>
            </div>
        );
    }

    if (!summary) return null;

    const { plan, subscription, usage, entitlements, overQuota, canManage, isOwnerOrAdmin } = summary;
    const workspaceName = selectedWorkspace?.name ?? 'Your Workspace';
    const userName = currentUser?.name ?? 'Your Account';
    const isPaid = subscription.status === 'active' || subscription.status === 'past_due' || subscription.status === 'trialing';
    const isPastDue = subscription.status === 'past_due';
    const showRenewal = isPaid && subscription.current_period_end;
    const canCancel = canManage && isPaid && !subscription.cancel_at_period_end && subscription.status !== 'past_due';
    const canResume = RESUME_ENABLED && canManage && isPaid && subscription.cancel_at_period_end;

    const renewalLabel = (() => {
        if (!subscription.current_period_end) return null;
        const d = new Date(subscription.current_period_end);
        const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (subscription.cancel_at_period_end) return `Cancels on ${formatted}`;
        return `Renews on ${formatted}`;
    })();

    const displayPrice = formatPlanPrice(plan, isPaid ? subscription.unit_price_cents : null);
    const usagePeriodResetLabel = formatUsagePeriodReset(subscription.current_period_end, isPaid);

    const nextPlanCode = plan.code === 'basic' ? 'pro' : plan.code === 'pro' ? 'max' : null;
    const selectableOverQuota = overQuota.resources.filter((resource) => resource.resource === 'projects' || resource.resource === 'channels');
    const hasSelectableOverQuota = selectableOverQuota.length > 0;
    const anyLocked = overQuota.resources.some((resource) => resource.locked > 0);
    const totalLocked = overQuota.resources.reduce((sum, resource) => sum + resource.locked, 0);
    const inGrace = !!overQuota.graceUntil && !overQuota.graceExpired;
    const canChooseSelection = canManage && hasSelectableOverQuota && inGrace;

    return (
        <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {!canManage && isOwnerOrAdmin && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">info</span>
                    <div>
                        <p className="text-sm font-semibold text-blue-300">Billing upgrades are in early access</p>
                        <p className="text-xs text-blue-400/80 mt-0.5">We're rolling out billing gradually. You'll be notified when it's available for your account.</p>
                    </div>
                </div>
            )}
            {!canManage && !isOwnerOrAdmin && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">info</span>
                    <div>
                        <p className="text-sm font-semibold text-blue-300">Managed by your workspace admin</p>
                        <p className="text-xs text-blue-400/80 mt-0.5">You can view billing information and compare plans, but only an admin or owner can make changes.</p>
                    </div>
                </div>
            )}

            {isActivating && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="w-5 h-5 border-2 border-blue-300/40 border-t-blue-300 rounded-full animate-spin shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-blue-300">Activating your subscription</p>
                        <p className="text-xs text-blue-400/80 mt-0.5">Your payment was received. This usually takes a few seconds — your new plan will appear automatically.</p>
                    </div>
                </div>
            )}

            {isPastDue && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-red-400 text-[20px] shrink-0 mt-0.5">warning</span>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-red-300">Payment past due</p>
                        <p className="text-xs text-red-400/80 mt-0.5">Your last payment failed. Please update your payment method to keep your plan active. Kelviq will retry automatically.</p>
                    </div>
                </div>
            )}

            {overQuota.isOverQuota && (() => {
                const unresolved = inGrace && !anyLocked;
                const graceDate = overQuota.graceUntil
                    ? new Date(overQuota.graceUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : null;
                return (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                        <span className="material-symbols-outlined text-amber-400 text-[20px] shrink-0 mt-0.5">warning</span>
                        <div className="flex-1 space-y-1.5">
                            <p className="text-sm font-semibold text-amber-300">
                                {unresolved ? `Action needed: over your ${overQuota.planName} limits` : 'Read-only limits applied'}
                            </p>
                            <ul className="text-xs text-amber-400/80 space-y-0.5 list-disc list-inside">
                                {overQuota.resources.map(r => (
                                    <li key={r.resource}>{describeOverQuota(r)}</li>
                                ))}
                            </ul>
                            <p className="text-xs text-amber-400/80">
                                {unresolved
                                    ? hasSelectableOverQuota
                                        ? `Reduce ${formatOverQuotaList(overQuota.resources)}${graceDate ? ` by ${graceDate}` : ''}, or choose what to keep active before the automatic oldest-stays lock kicks in. Nothing is deleted — upgrading restores full access.`
                                        : `Reduce your usage${graceDate ? ` by ${graceDate}` : ''}, or we'll keep your oldest items active and switch the newest over-limit items to read-only. Nothing is deleted — upgrading restores full access.`
                                    : hasSelectableOverQuota
                                        ? `${totalLocked} item${totalLocked === 1 ? ' is' : 's are'} read-only right now. Upgrade to restore full access${inGrace ? `, or change which ${selectableOverQuota.length === 1 ? 'item stays' : 'items stay'} active` : ''}.`
                                        : `We kept your oldest items active and switched the newest over-limit items to read-only. Upgrade to restore full access, or delete locked items to free them up.`}
                            </p>
                            {canChooseSelection || (canManage && nextPlanCode) ? (
                                <div className="flex flex-wrap gap-3 pt-2">
                                    {canChooseSelection && (
                                        <button
                                            onClick={handleOpenQuotaKeep}
                                            className="cursor-pointer px-4 py-2 bg-white/10 border border-white/10 text-white text-xs font-black rounded-lg hover:bg-white/15 transition-all active:scale-95"
                                        >
                                            {unresolved ? 'Choose what to keep' : 'Change selection'}
                                        </button>
                                    )}
                                    {canManage && nextPlanCode && (
                                        <button
                                            onClick={() => handleUpgrade(nextPlanCode)}
                                            disabled={isCheckingOut || isActivating}
                                            className="cursor-pointer px-4 py-2 bg-primary text-white text-xs font-black rounded-lg hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                                        >
                                            {isCheckingOut ? 'Starting...' : 'Upgrade Plan'}
                                        </button>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </div>
                );
            })()}

            {isPaid && subscription.cancel_at_period_end && subscription.current_period_end && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">schedule</span>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-blue-300">
                            Cancellation scheduled for {new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-blue-400/80 mt-0.5">
                            You'll keep Pro access until then. Kelviq's billing portal may show this subscription as already canceled — that's expected; your OneWork access is governed by the date above.
                        </p>
                    </div>
                </div>
            )}

            {/* Current Plan Card */}
            <section className="bg-surface-dark border border-border-dark rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 md:p-8 pb-4 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                    <div className="space-y-1">
                        <span className="inline-block bg-white/5 text-text-secondary text-[10px] font-black px-2 py-0.5 rounded-lg border border-border-dark uppercase tracking-widest">
                            {workspaceName}
                        </span>
                        <div className="flex items-center gap-3 mt-1">
                            <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                            {subscription.status !== 'basic' && <StatusBadge status={subscription.status} />}
                        </div>
                        <p className="text-xs text-text-secondary font-medium">{userName}</p>
                        <p className="text-sm text-text-secondary mt-1">
                            {plan.code === 'basic' && 'Free forever. Upgrade when your team grows.'}
                            {plan.code === 'pro' && 'Best for growing teams and advanced workflows.'}
                            {plan.code === 'max' && 'For high-velocity teams that need full AI power.'}
                            {plan.code === 'enterprise' && 'Large-scale operations with dedicated support.'}
                        </p>
                    </div>
                    <div className="sm:text-right shrink-0">
                        <div className="flex items-baseline sm:justify-end gap-1">
                            <span className="text-3xl font-black text-white">{displayPrice}</span>
                            {plan.price_cents !== null && plan.price_cents > 0 && (
                                <span className="text-sm text-text-secondary">/mo</span>
                            )}
                        </div>
                        {showRenewal && renewalLabel && (
                            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mt-1">
                                {renewalLabel}
                            </p>
                        )}
                    </div>
                </div>

                <div className="px-5 sm:px-6 md:px-8 py-5 space-y-6">
                    <div>
                        <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-4">
                            Workspace limits
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                            <UsageBar label="Projects" used={usage.projects} max={entitlements.max_projects} />
                            <UsageBar label="Members" used={usage.seats} max={entitlements.max_seats} />
                            <UsageBar label="Channels" used={usage.channels} max={entitlements.max_channels} />
                            <UsageBar label="Inboxes (you)" used={usage.current_user_mail_accounts} max={entitlements.max_inboxes_per_user} />
                        </div>
                    </div>
                    <div className="pt-2 border-t border-border-dark/60">
                        <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-1">
                            Usage this billing period
                        </p>
                        <p className="text-[10px] text-text-secondary/80 mb-4">
                            Shared across your workspace · call recordings count toward storage
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                            <StorageUsageBar usedBytes={usage.storage_bytes} limitBytes={entitlements.max_storage_bytes} />
                            <CallMinutesUsageBar
                                usedMinutes={usage.call_minutes_used}
                                maxMinutes={entitlements.max_call_minutes_monthly}
                                periodResetLabel={usagePeriodResetLabel}
                            />
                        </div>
                    </div>
                </div>

                <div className="px-5 sm:px-6 md:px-8 py-4 bg-white/2 border-t border-border-dark flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div className="flex items-center gap-4">
                        {canCancel && (
                            <button
                                onClick={handleCancel}
                                disabled={isLifecycleLoading}
                                className="text-xs font-bold text-text-secondary hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                                {isLifecycleLoading && (
                                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                )}
                                Cancel Plan
                            </button>
                        )}
                        {canResume && (
                            <button
                                onClick={handleResume}
                                disabled={isLifecycleLoading}
                                className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                                {isLifecycleLoading && (
                                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                )}
                                Resume Plan
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => openModal('plan-comparison', {
                                canManage,
                                isOwnerOrAdmin,
                                currentPlan: plan.code,
                                plans: summary.plans,
                                onUpgrade: canManage ? handleUpgrade : undefined,
                            })}
                            className="text-xs font-bold text-text-secondary hover:text-white transition-colors cursor-pointer"
                        >
                            Compare Plans
                        </button>
                        {nextPlanCode && (
                            <button
                                onClick={() => canManage && handleUpgrade(nextPlanCode)}
                                disabled={!canManage || isCheckingOut || isActivating}
                                className="px-6 py-2 bg-primary text-white text-xs font-black rounded-lg shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100 flex items-center gap-2"
                            >
                                {isCheckingOut && (
                                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                )}
                                {isCheckingOut ? 'Starting...' : 'Upgrade Plan'}
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {/* Manage billing — Kelviq Customer Portal. Invoices and payment methods live there;
                Kelviq does not expose them as JSON. The portal opens in a new tab. */}
            {isPaid && canManage && (
                <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-text-secondary text-[24px] mt-0.5">receipt_long</span>
                            <div>
                                <h3 className="text-lg font-bold text-white">Invoices & payment methods</h3>
                                <p className="text-xs text-text-secondary mt-1 max-w-md">
                                    View invoices, download receipts, and update your card in the Kelviq billing portal. Opens in a new tab.
                                </p>
                                {subscription.cancel_at_period_end && (
                                    <p className="text-xs text-blue-400/80 mt-2 max-w-md">
                                        Your subscription may appear canceled in the portal — that's normal during the wind-down period.
                                    </p>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={handleOpenPortal}
                            disabled={isOpeningPortal}
                            className="self-start shrink-0 px-4 py-2 bg-white/5 border border-border-dark text-white text-xs font-black rounded-lg hover:bg-white/10 transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center gap-2"
                        >
                            {isOpeningPortal && (
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            )}
                            {isOpeningPortal ? 'Opening...' : 'Manage Billing'}
                            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        </button>
                    </div>
                </section>
            )}

            {/* Legacy inline render — preserved in case billing_invoices / workspace_payment_methods
                tables are ever populated by a future webhook handler. Today both lists are always
                empty (Kelviq doesn't expose this data via REST), so these sections render nothing. */}
            {summary.paymentMethods.length > 0 && (
                <section className="bg-surface-dark border border-border-dark rounded-2xl p-8 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white">Payment Methods</h3>
                    </div>
                    <div className="space-y-3">
                        {summary.paymentMethods.map(pm => (
                            <div key={pm.kelviq_pm_id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-border-dark">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-text-secondary text-[20px]">credit_card</span>
                                    <div>
                                        <p className="text-sm font-bold text-white capitalize">{pm.brand} ···· {pm.last4}</p>
                                        <p className="text-[10px] text-text-secondary">Expires {pm.exp_month}/{pm.exp_year}</p>
                                    </div>
                                </div>
                                {pm.is_default && (
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 uppercase tracking-widest">Default</span>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {summary.invoices.length > 0 && (
                <section className="bg-surface-dark border border-border-dark rounded-2xl p-8 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-white">Billing History</h3>
                    </div>
                    <div className="space-y-2">
                        {summary.invoices.map(inv => {
                            const statusColor = inv.status === 'paid' ? 'text-emerald-400' : inv.status === 'open' ? 'text-amber-400' : 'text-text-secondary';
                            const issuedDate = inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                            const amount = `$${(inv.amount_cents / 100).toFixed(2)}`;
                            return (
                                <div key={inv.kelviq_invoice_id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-border-dark">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-text-secondary text-[20px]">receipt</span>
                                        <div>
                                            <p className="text-sm font-bold text-white">{inv.number ?? inv.kelviq_invoice_id}</p>
                                            <p className="text-[10px] text-text-secondary">{issuedDate}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${statusColor}`}>{inv.status}</span>
                                        <span className="text-sm font-bold text-white">{amount}</span>
                                        {inv.hosted_url && (
                                            <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-blue-400 transition-colors">
                                                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                                            </a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
};

export default BillingSettings;
