'use client';

import React, { useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useAppContext } from '@/context/AppContext';
import type { BillingPlan } from '@/types/billing';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface PlanComparisonModalProps {
    onClose: () => void;
    note?: string;
    canManage?: boolean;
    isOwnerOrAdmin?: boolean;
    currentPlan?: string;
    plans?: BillingPlan[];
    onUpgrade?: (planCode: string) => Promise<void>;
    workspaceId?: string;
}

function describePlan(plan: BillingPlan): string {
    switch (plan.code) {
        case 'basic':
            return 'For solo users and small teams';
        case 'pro':
            return 'For growing startups';
        case 'max':
            return 'For high-velocity teams';
        case 'enterprise':
            return 'For large-scale operations';
        default:
            return '';
    }
}

function formatLimit(limit: number | null, noun: string): string {
    if (limit === null) return `Unlimited ${noun}`;
    return `Up to ${limit} ${noun}`;
}

function formatStorageLimit(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${Number.isInteger(gb) ? gb : gb.toFixed(0)} GB storage`;
    }
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(0)} MB storage`;
}

function formatCallMinutesLimit(minutes: number | null): string {
    if (minutes === null) return 'Unlimited call minutes / period';
    return `${minutes.toLocaleString()} call minutes / period`;
}

function formatCallDurationLimit(minutes: number | null): string {
    if (minutes === null) return 'Unlimited meeting duration';
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return `Up to ${hours}h meetings`;
    }
    return `Up to ${minutes} min meetings`;
}

function formatPrice(plan: BillingPlan): string {
    if (plan.price_cents === null) return 'Contact Us';
    if (plan.price_cents === 0) return 'Free';
    return `$${(plan.price_cents / 100).toFixed(0)}`;
}

function getPlanFeatures(plan: BillingPlan): string[] {
    return [
        formatLimit(plan.max_projects, 'projects'),
        formatLimit(plan.max_seats, 'members'),
        formatLimit(plan.max_channels, 'channels'),
        formatStorageLimit(plan.max_storage_bytes),
        formatCallMinutesLimit(plan.max_call_minutes_monthly),
        formatCallDurationLimit(plan.max_call_duration_minutes),
        plan.max_inboxes_per_user === null
            ? 'Custom inboxes / user'
            : `${plan.max_inboxes_per_user} inbox${plan.max_inboxes_per_user === 1 ? '' : 'es'} / user`,
        plan.ai_tier === 'none'
            ? 'No AI features'
            : plan.ai_tier === 'task_intel'
                ? 'Task Intelligence AI'
                : plan.ai_tier === 'full_suite'
                    ? 'Full AI Suite'
                    : 'Custom AI & analytics',
        plan.support_tier === 'community'
            ? 'Community support'
            : plan.support_tier === 'priority_email'
                ? 'Priority email support'
                : plan.support_tier === 'slack_24_7'
                    ? '24/7 Slack support'
                    : 'Dedicated support lead',
    ];
}

function getPlanCta(plan: BillingPlan, isCurrent: boolean): string {
    if (isCurrent) return 'Current Plan';
    if (plan.contact_sales) return 'Contact Sales';
    if (plan.code === 'basic') return 'Free Plan';
    return 'Upgrade';
}

function isUpgradeable(plan: BillingPlan, isCurrent: boolean): boolean {
    return !isCurrent && !plan.contact_sales && plan.code !== 'basic';
}

const PlanComparisonModal: React.FC<PlanComparisonModalProps> = ({
    onClose,
    note,
    canManage,
    isOwnerOrAdmin,
    currentPlan = 'basic',
    plans = [],
    onUpgrade,
    workspaceId,
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const { selectedWorkspace } = useAppContext();
    useClickOutside(modalRef, onClose);

    const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

    const resolvedWorkspaceId = workspaceId ?? selectedWorkspace?.id;

    const defaultUpgrade = async (planCode: string) => {
        if (!resolvedWorkspaceId) return;
        const res = await authenticatedFetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: resolvedWorkspaceId, planCode }),
        });
        if (res.ok) {
            const { checkoutUrl } = await res.json() as { checkoutUrl: string };
            window.location.href = checkoutUrl;
        }
    };

    const resolvedUpgrade = onUpgrade ?? (canManage ? defaultUpgrade : undefined);

    const handleUpgradeClick = async (planCode: string) => {
        if (!resolvedUpgrade || upgradingPlan) return;
        setUpgradingPlan(planCode);
        try {
            await resolvedUpgrade(planCode);
        } finally {
            setUpgradingPlan(null);
        }
    };

    return (
        <div ref={modalRef} className="max-w-6xl mx-auto bg-surface-dark border border-border-dark rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="px-10 py-8 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                <div>
                    {selectedWorkspace && (
                        <span className="inline-block bg-white/5 text-[10px] font-black px-2 py-0.5 rounded-lg border border-border-dark uppercase tracking-widest text-text-secondary mb-1.5">
                            {selectedWorkspace.name}
                        </span>
                    )}
                    <h2 className="text-2xl font-black text-white">OneWork Plans</h2>
                    <p className="text-text-secondary text-sm">Monthly billing · No free trial · Upgrade or downgrade any time.</p>
                </div>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white p-2">
                    <span className="material-symbols-outlined text-2xl">close</span>
                </button>
            </div>

            {canManage === false && isOwnerOrAdmin && (
                <div className="mx-10 mt-6 flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">info</span>
                    <div>
                        <p className="text-sm font-semibold text-blue-300">Billing upgrades are in early access</p>
                        <p className="text-xs text-blue-400/80 mt-0.5">We're rolling out billing gradually. You'll be notified when it's available for your account.</p>
                    </div>
                </div>
            )}
            {canManage === false && !isOwnerOrAdmin && (
                <div className="mx-10 mt-6 flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                    <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0 mt-0.5">info</span>
                    <div>
                        <p className="text-sm font-semibold text-blue-300">Managed by your workspace admin</p>
                        <p className="text-xs text-blue-400/80 mt-0.5">You can view billing information and compare plans, but only an admin or owner can make changes.</p>
                    </div>
                </div>
            )}

            {note && (
                <div className={`mx-10 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 ${canManage === false ? 'mt-3' : 'mt-6'}`}>
                    <span className="material-symbols-outlined text-amber-400 text-[20px] shrink-0">lock_open</span>
                    <p className="text-sm font-semibold text-amber-300">{note}</p>
                </div>
            )}

            <div className="p-10 grid grid-cols-1 md:grid-cols-4 gap-5">
                {plans.map((plan) => {
                    const isCurrent = plan.code === currentPlan;
                    const canUpgrade = isUpgradeable(plan, isCurrent) && canManage && !!resolvedUpgrade;
                    const isLoading = upgradingPlan === plan.code;

                    return (
                        <div
                            key={plan.code}
                            className={`p-7 rounded-[24px] border flex flex-col transition-all ${
                                isCurrent
                                    ? 'bg-primary/5 border-primary shadow-[0_0_40px_rgba(25,93,230,0.1)] ring-1 ring-primary/20'
                                    : 'bg-background-dark/50 border-border-dark hover:border-white/20'
                            }`}
                        >
                            <div className="mb-5">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${isCurrent ? 'bg-primary text-white' : 'bg-white/10 text-text-secondary'}`}>
                                    {plan.name}
                                </span>
                                <div className="mt-4 flex items-baseline gap-1">
                                    <span className="text-2xl font-black text-white">{formatPrice(plan)}</span>
                                    {plan.price_cents !== null && plan.price_cents > 0 && (
                                        <span className="text-text-secondary text-sm font-medium">/mo</span>
                                    )}
                                </div>
                                <p className="text-text-secondary text-xs mt-2 leading-relaxed">{describePlan(plan)}</p>
                            </div>

                            <ul className="flex-1 space-y-3 mb-8">
                                {getPlanFeatures(plan).map(f => (
                                    <li key={f} className="flex gap-2.5 items-start text-sm text-text-main leading-snug">
                                        <span className="material-symbols-outlined text-[17px] shrink-0 mt-0.5 icon-filled text-primary">
                                            check_circle
                                        </span>
                                        <span className="min-w-0">{f}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className="relative group">
                                <button
                                    disabled={!canUpgrade || !!upgradingPlan}
                                    onClick={() => canUpgrade && handleUpgradeClick(plan.code)}
                                    className={`w-full py-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 ${
                                        canUpgrade
                                            ? 'bg-primary text-white hover:bg-blue-600 active:scale-95 cursor-pointer'
                                            : isCurrent
                                                ? 'bg-primary/20 text-primary border border-primary/30 cursor-default'
                                                : 'bg-white/10 text-text-secondary border border-border-dark cursor-not-allowed'
                                    } disabled:opacity-60`}
                                >
                                    {isLoading && (
                                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    )}
                                    {isLoading ? 'Starting...' : getPlanCta(plan, isCurrent)}
                                </button>
                                {!isCurrent && !canUpgrade && (
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/80 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        {canManage === false ? 'Contact your admin to upgrade' : plan.contact_sales ? 'Contact sales' : 'Not available'}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="px-10 py-5 bg-background-dark/80 border-t border-border-dark text-center">
                <p className="text-xs text-text-secondary">
                    Need a custom solution?{' '}
                    <a
                        href={`mailto:sales@onework.so?subject=${encodeURIComponent('Enterprise Plan Inquiry')}&body=${encodeURIComponent(`Hi,\n\nI'm interested in learning more about OneWork Enterprise.\n\nWorkspace: ${selectedWorkspace?.name ?? ''}\n\nPlease get in touch.`)}`}
                        className="text-primary font-bold hover:underline"
                    >
                        Contact sales for Enterprise pricing.
                    </a>
                </p>
            </div>
        </div>
    );
};

export default PlanComparisonModal;
