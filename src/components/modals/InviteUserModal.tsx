'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { api } from '@/lib/api';
import type { BillingSummary } from '@/types/billing';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface InviteUserModalProps {
    onClose: () => void;
    onInviteSuccess?: (user: null) => void;
}

type MemberStatus = 'unknown' | 'checking' | 'not-found' | 'invited' | 'active';

const InviteUserModal: React.FC<InviteUserModalProps> = ({ onClose, onInviteSuccess }) => {
    const { addToast, openModal } = useUIContext();
    const { selectedWorkspaceId } = useAppContext();
    const modalRef = useRef<HTMLDivElement>(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('Member');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [memberStatus, setMemberStatus] = useState<MemberStatus>('unknown');
    const [limitChecking, setLimitChecking] = useState(true);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setLimitChecking(true);
        if (!selectedWorkspaceId) { setLimitChecking(false); return; }
        authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json: { data: BillingSummary } | null) => {
                const max = json?.data?.entitlements?.max_seats ?? null;
                const used = json?.data?.usage?.seats ?? 0;
                if (max !== null && used >= max) {
                    onClose();
                    openModal('plan-comparison', { note: 'Upgrade to invite more team members.', canManage: json?.data?.canManage ?? false, currentPlan: json?.data?.plan?.code ?? 'basic', plans: json?.data?.plans ?? [], workspaceId: selectedWorkspaceId });
                }
            })
            // fail open — billing check errors should never block the user action
            .catch(() => {})
            .finally(() => setLimitChecking(false));
    }, [onClose, openModal, selectedWorkspaceId]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        const trimmed = email.trim();
        if (!trimmed.includes('@') || !selectedWorkspaceId) {
            setMemberStatus('unknown');
            return;
        }

        setMemberStatus('checking');
        debounceRef.current = setTimeout(async () => {
            try {
                const result = await api.users.getMembers(selectedWorkspaceId, { search: trimmed, limit: 10 });
                const match = result.data.find(
                    (m) => m.email.toLowerCase() === trimmed.toLowerCase(),
                );
                if (!match) {
                    setMemberStatus('not-found');
                } else if (match.status === 'Invited') {
                    setMemberStatus('invited');
                } else {
                    setMemberStatus('active');
                }
            } catch {
                setMemberStatus('unknown');
            }
        }, 500);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [email, selectedWorkspaceId]);

    useClickOutside(modalRef, onClose);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.includes('@')) {
            addToast('Please enter a valid email address.', 'error');
            return;
        }
        if (!selectedWorkspaceId) {
            addToast('No workspace selected.', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            await api.users.invite(selectedWorkspaceId, email, role);
            addToast(`Invitation sent to ${email} as ${role}`, 'success');
            if (onInviteSuccess) onInviteSuccess(null);
            onClose();
        } catch (err: unknown) {
            addToast(err instanceof Error ? err.message : 'Failed to send invite.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (limitChecking) {
        return (
            <div className="max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl p-10 flex items-center justify-center animate-in zoom-in-95 duration-200">
                <span className="size-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div ref={modalRef} className="max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">person_add</span>
                    Invite Team Member
                </h2>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Email Address</label>
                    <input
                        autoFocus
                        data-tour="invite-email-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="colleague@productivitypro.com"
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
                        required
                    />
                </div>

                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Workspace Role</label>
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all cursor-pointer outline-none"
                    >
                        <option>Admin</option>
                        <option>Team Lead</option>
                        <option>Member</option>
                        <option>Guest</option>
                    </select>
                    <p className="text-[10px] text-text-secondary mt-2 px-1">Roles define what actions this user can perform in the workspace.</p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors">Cancel</button>
                    <button
                        type="submit"
                        disabled={isSubmitting || memberStatus === 'active' || memberStatus === 'checking'}
                        className="cursor-pointer px-8 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50"
                    >
                        {isSubmitting
                            ? 'Sending...'
                            : memberStatus === 'checking'
                            ? 'Checking...'
                            : memberStatus === 'invited'
                            ? 'Re-send Invitation'
                            : memberStatus === 'active'
                            ? 'User already active'
                            : 'Send Invite'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default InviteUserModal;
