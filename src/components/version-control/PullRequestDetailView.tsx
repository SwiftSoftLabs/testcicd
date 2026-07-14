'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import DiffFilesView from '@/components/version-control/DiffFilesView';
import VcBrandedHeader from '@/components/version-control/VcBrandedHeader';
import {
  prExternalProviderUrl,
  prLabel,
  resolvePrNumber,
  resolvePrProvider,
  type PRDetailTab,
} from '@/lib/integrations/git/vc-pr-ui';
import { commentHasSuggestions } from '@/lib/integrations/git/pr-suggestions';
import { buildOneworkPullShareUrl } from '@/lib/integrations/git/vc-share-url';
import { getProviderLabel } from '@/lib/integrations/git/provider-meta';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import { api } from '@/lib/api';
import {
    isCheckFailure,
    isCheckPending,
    summarizeChecks,
} from '@/lib/integrations/git/pr-checks';
import {
    getPullMergeability,
    pullRequestHasMergeConflicts,
} from '@/lib/integrations/git/pr-merge';
import {
    isSameVcLogin,
    isPrAuthorLogin,
    pullRequestIsMergeableByReview,
    summarizePullReviews,
} from '@/lib/integrations/git/pr-reviews';
import { useGitIntegrationStatus } from '@/hooks/useGitIntegration';
import type { GitProvider } from '@/types/git';
import type { PullRequest } from '@/types';

type ReviewModalKind = 'APPROVE' | 'REQUEST_CHANGES';
type WorkspaceMemberHandle = {
    userId: string;
    name: string;
    email: string;
    giteaUsername: string | null;
};

export type PullRequestDetailViewProps = {
    pr: PullRequest;
    prDetailTab: PRDetailTab;
    onPrDetailTab: (t: PRDetailTab) => void;
    loadingDetail: boolean;
    workspaceId: string;
    projectId: string;
    projectName?: string | null;
    gitProvider: GitProvider;
    owner: string;
    repo: string;
    onBack: () => void;
    onRefreshSelectedPR: () => Promise<void>;
    onRefreshPullList?: () => Promise<void>;
    onPatchSelectedPR?: (patch: Partial<PullRequest>) => void;
    readOnly?: boolean;
    variant?: 'embedded' | 'page';
    backLabel?: string;
};

function fileStatusIcon(status: string): string {
    const s = status.toLowerCase();
    if (s === 'added') return 'add_circle';
    if (s === 'removed') return 'remove_circle';
    if (s === 'renamed') return 'drive_file_rename_outline';
    return 'edit_note';
}

function FilesTab({
    pr,
    readOnly,
    onLineComment,
}: {
    pr: PullRequest;
    readOnly: boolean;
    onLineComment?: (input: {
        path: string;
        line: number;
        side: 'LEFT' | 'RIGHT';
    }) => void;
}) {
    return (
        <DiffFilesView
            diffFiles={pr.diffFiles ?? []}
            readOnly={readOnly}
            onLineComment={onLineComment}
            fileAnchorPrefix="pr-diff"
            emptyMessage="No diff data available for this PR. Use the review bar above to request reviewers or approve."
        />
    );
}

export default function PullRequestDetailView({
    pr: selectedPR,
    prDetailTab,
    onPrDetailTab,
    loadingDetail,
    workspaceId,
    projectId,
    projectName,
    gitProvider,
    owner,
    repo,
    onBack,
    onRefreshSelectedPR,
    onRefreshPullList,
    onPatchSelectedPR,
    readOnly = false,
    variant = 'embedded',
    backLabel = 'Pull requests',
}: PullRequestDetailViewProps) {
    const { addToast } = useUIContext();
    const { appSettings, users, currentUser } = useAppContext();
    const { status: gitStatus } = useGitIntegrationStatus(workspaceId || null);
    const getPresence = (authorId: string | undefined) => {
        if (!authorId) return null;
        const member = users.find((u) => u.id === authorId);
        return member ? presenceFromMemberStatus(member.status) : null;
    };
    const renderAuthorPresence = (authorId?: string | null) => {
        const presence = getPresence(authorId ?? undefined);
        if (!presence) return null;
        return (
            <span className="absolute -bottom-0.5 -right-0.5">
                <PresenceDot status={presence} />
            </span>
        );
    };
    const [fileFilter, setFileFilter] = useState('');
    const [commentText, setCommentText] = useState('');
    const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');
    const [squashMerge, setSquashMerge] = useState(false);
    const [deleteBranchAfterMerge, setDeleteBranchAfterMerge] = useState(false);
    const [posting, setPosting] = useState(false);
    const [merging, setMerging] = useState(false);
    const [autoMerging, setAutoMerging] = useState(false);
    const [closing, setClosing] = useState(false);
    const [reopening, setReopening] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [updatingBranch, setUpdatingBranch] = useState(false);
    const [reviewing, setReviewing] = useState(false);
    const [requestingReviewer, setRequestingReviewer] = useState(false);
    const [collaboratorLogins, setCollaboratorLogins] = useState<string[]>([]);
    const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberHandle[]>([]);
    const [reviewerPick, setReviewerPick] = useState('');
    const [reviewModal, setReviewModal] = useState<ReviewModalKind | null>(null);
    const [reviewModalText, setReviewModalText] = useState('');
    const [lineCommentTarget, setLineCommentTarget] = useState<{
        path: string;
        line: number;
        side: 'LEFT' | 'RIGHT';
    } | null>(null);
    const [lineCommentText, setLineCommentText] = useState('');

    useEffect(() => {
        setFileFilter('');
        setCommentText('');
        setMergeMethod('merge');
        setSquashMerge(false);
        setDeleteBranchAfterMerge(false);
        setReviewerPick('');
        setReviewModal(null);
        setReviewModalText('');
    }, [selectedPR.id]);

    const diffFiles = selectedPR.diffFiles ?? [];
    const sidebarEntries = useMemo(() => {
        const q = fileFilter.trim().toLowerCase();
        return diffFiles
            .map((file, idx) => ({ file, idx }))
            .filter(({ file }) => !q || file.filename.toLowerCase().includes(q));
    }, [diffFiles, fileFilter]);

    const scrollToFile = (index: number) => {
        const el = document.getElementById(`pr-diff-${index}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const additions = diffFiles.reduce((s, f) => s + (f.additions ?? 0), 0);
    const deletions = diffFiles.reduce((s, f) => s + (f.deletions ?? 0), 0);

    const prProvider = resolvePrProvider(selectedPR, gitProvider);
    const prNumber = resolvePrNumber(selectedPR);
    const providerName = getProviderLabel(prProvider);
    const providerExternalUrl = prExternalProviderUrl(selectedPR);
    const oneworkShareUrl =
        prProvider === 'onework' && prNumber != null
            ? buildOneworkPullShareUrl(projectId, prNumber)
            : null;
    const copyShareUrl =
        prProvider === 'onework' ? oneworkShareUrl : providerExternalUrl;

    const activity = selectedPR?.activity;
    const sortedComments = useMemo(() => {
        const list = activity?.comments ?? [];
        return [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }, [activity]);
    const sortedReviews = useMemo(() => {
        const list = activity?.reviews ?? [];
        return [...list].sort((a, b) => {
            const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
            const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
            return ta - tb;
        });
    }, [activity]);

    const canMutate = Boolean(workspaceId && prNumber && owner && repo) && !readOnly;
    const isDraft = selectedPR.is_draft === true;
    const mergeability = getPullMergeability(selectedPR);
    const hasConflicts = pullRequestHasMergeConflicts(selectedPR);
    const checkSummary = summarizeChecks(activity?.checks ?? []);
    const checksBlockMerge =
        checkSummary.aggregate === 'fail' || checkSummary.aggregate === 'pending';
    const mergeClosed =
        !selectedPR?.is_open || selectedPR.status === 'Merged';
    const prActionsBusy =
        merging || closing || reopening || updatingBranch || publishing;
    const reviewSummary = summarizePullReviews(
        activity?.reviews ?? [],
        selectedPR?.author_id,
    );
    const approvalRequired = !pullRequestIsMergeableByReview(
        activity,
        selectedPR?.author_id,
    );
    const mergeBlocked =
        mergeClosed ||
        !canMutate ||
        isDraft ||
        approvalRequired ||
        checksBlockMerge ||
        hasConflicts ||
        mergeability.isChecking ||
        mergeability.isBlocked;
    const supportsMergeMethods = prProvider !== 'gitlab';
    const authorMember = useMemo(
        () =>
            workspaceMembers.find(
                (member) =>
                    (selectedPR.author_user_id &&
                        member.userId === selectedPR.author_user_id) ||
                    isPrAuthorLogin(
                        member.giteaUsername,
                        selectedPR?.author_id,
                        selectedPR?.author?.full_name,
                    ),
            ) ?? null,
        [
            workspaceMembers,
            selectedPR.author_user_id,
            selectedPR?.author_id,
            selectedPR?.author?.full_name,
        ],
    );
    const authorDisplayName =
        authorMember?.name ?? selectedPR.author?.full_name ?? 'Unknown';
    const prAuthorUserId =
        selectedPR?.author_user_id ?? authorMember?.userId ?? null;
    const connectedAccountLogin = useMemo(() => {
        if (prProvider === 'onework') {
            return (
                gitStatus?.onework?.accountLogin ??
                workspaceMembers.find((member) => member.userId === currentUser.id)
                    ?.giteaUsername ??
                null
            );
        }
        if (prProvider === 'github') return gitStatus?.github?.accountLogin ?? null;
        if (prProvider === 'gitlab') return gitStatus?.gitlab?.accountLogin ?? null;
        return null;
    }, [prProvider, gitStatus, workspaceMembers, currentUser.id]);
    const isCurrentUserAuthor = useMemo(() => {
        if (prAuthorUserId && prAuthorUserId === currentUser.id) return true;
        if (authorMember?.userId === currentUser.id) return true;
        return isPrAuthorLogin(
            connectedAccountLogin,
            selectedPR?.author_id,
            selectedPR?.author?.full_name,
        );
    }, [
        prAuthorUserId,
        authorMember?.userId,
        currentUser.id,
        connectedAccountLogin,
        selectedPR?.author_id,
        selectedPR?.author?.full_name,
    ]);
    const requestedReviewers = (activity?.requested_reviewers ?? []).filter(
        (reviewer) => {
            if (prAuthorUserId === currentUser.id) {
                if (isSameVcLogin(reviewer.login, connectedAccountLogin)) return false;
                const selfMember = workspaceMembers.find(
                    (member) => member.userId === currentUser.id,
                );
                if (
                    selfMember?.giteaUsername &&
                    isSameVcLogin(reviewer.login, selfMember.giteaUsername)
                ) {
                    return false;
                }
            }
            if (prAuthorUserId) {
                const reviewerMember = workspaceMembers.find((member) =>
                    isSameVcLogin(member.giteaUsername, reviewer.login),
                );
                if (reviewerMember?.userId === prAuthorUserId) return false;
            }
            return (
                !isPrAuthorLogin(
                    reviewer.login,
                    selectedPR?.author_id,
                    selectedPR?.author?.full_name,
                ) &&
                !isSameVcLogin(reviewer.login, authorMember?.giteaUsername)
            );
        },
    );
    const reviewerOptions = useMemo(() => {
        const excludeLogin = (login: string) =>
            !isPrAuthorLogin(login, selectedPR?.author_id, selectedPR?.author?.full_name) &&
            !isSameVcLogin(login, authorMember?.giteaUsername) &&
            !requestedReviewers.some((reviewer) => isSameVcLogin(reviewer.login, login));

        if (prProvider === 'onework') {
            return workspaceMembers
                .filter((member) => member.giteaUsername)
                .filter((member) => !prAuthorUserId || member.userId !== prAuthorUserId)
                .filter(
                    (member) =>
                        !(isCurrentUserAuthor && member.userId === currentUser.id),
                )
                .filter((member) => excludeLogin(member.giteaUsername!))
                .map((member) => ({
                    login: member.giteaUsername!,
                    label: `${member.name} (${member.giteaUsername})`,
                }));
        }

        return collaboratorLogins
            .filter(excludeLogin)
            .filter((login) => !isCurrentUserAuthor || !isSameVcLogin(login, connectedAccountLogin))
            .map((login) => ({ login, label: login }));
    }, [
        prProvider,
        workspaceMembers,
        prAuthorUserId,
        isCurrentUserAuthor,
        currentUser.id,
        authorMember?.giteaUsername,
        connectedAccountLogin,
        collaboratorLogins,
        selectedPR?.author_id,
        selectedPR?.author?.full_name,
        requestedReviewers,
    ]);

    const mergeButtonLabel = () => {
        if (isDraft) return 'Draft — mark ready to merge';
        if (approvalRequired) return 'Needs approval';
        if (hasConflicts) return 'Has conflicts';
        if (checksBlockMerge) return 'Checks pending';
        if (mergeability.isChecking) return 'Checking mergeability';
        return 'Merge pull request';
    };

    const mergeButtonShortLabel = () => {
        if (isDraft) return 'Draft';
        if (approvalRequired) return 'Needs approval';
        if (hasConflicts) return 'Conflicts';
        if (checksBlockMerge) return 'Checks pending';
        if (mergeability.isChecking) return 'Checking';
        return 'Merge';
    };

    useEffect(() => {
        if (!selectedPR || !workspaceId || !owner || !repo) {
            setCollaboratorLogins([]);
            setWorkspaceMembers([]);
            return;
        }
        let cancelled = false;
        const load = async () => {
            try {
                if (prProvider === 'onework') {
                    const rows = await api.integrations.git.oneworkMemberHandles(
                        workspaceId,
                    );
                    if (!cancelled) {
                        setWorkspaceMembers(rows);
                        setCollaboratorLogins(
                            rows
                                .map((m) => m.giteaUsername)
                                .filter((u): u is string => Boolean(u)),
                        );
                    }
                    return;
                }
                setWorkspaceMembers([]);
                const rows = await api.integrations.git.listCollaborators(
                    prProvider,
                    workspaceId,
                    owner,
                    repo,
                );
                if (!cancelled) {
                    setCollaboratorLogins(rows.map((c) => c.login));
                }
            } catch {
                if (!cancelled) setCollaboratorLogins([]);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [selectedPR, workspaceId, owner, repo, prProvider]);

    const runPostComment = async () => {
        const text = commentText.trim();
        if (!text) {
            addToast('Write a comment before posting.', 'warning');
            return;
        }
        if (!canMutate || prNumber == null) return;
        setPosting(true);
        try {
            await api.integrations.git.postPullComment(prProvider, workspaceId, owner, repo, prNumber, text);
            setCommentText('');
            addToast('Comment posted.', 'success');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Failed to post comment', 'error');
        } finally {
            setPosting(false);
        }
    };

    const runMerge = async () => {
        if (!canMutate || prNumber == null || mergeClosed) return;
        if (isDraft) {
            addToast('Mark this pull request ready for review before merging.', 'warning');
            return;
        }
        if (approvalRequired) {
            addToast(
                'At least one approving review from another collaborator is required before merge.',
                'warning',
            );
            return;
        }
        if (hasConflicts) {
            addToast('Resolve merge conflicts before merging.', 'warning');
            return;
        }
        if (checksBlockMerge) {
            addToast('Required checks must pass before merging.', 'warning');
            return;
        }
        if (!window.confirm('Merge this pull request on the provider?')) {
            return;
        }
        setMerging(true);
        try {
            await api.integrations.git.mergePull(prProvider, workspaceId, owner, repo, prNumber, {
                mergeMethod: supportsMergeMethods ? mergeMethod : undefined,
                squash: prProvider === 'gitlab' ? squashMerge : undefined,
                deleteBranchAfterMerge,
                projectId,
            });
            addToast('Merged.', 'success');
            onPatchSelectedPR?.({ is_open: false, status: 'Merged' });
            await Promise.all([
                onRefreshSelectedPR(),
                onRefreshPullList?.(),
            ]);
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Merge failed', 'error');
        } finally {
            setMerging(false);
        }
    };

    const runAutoMerge = async () => {
        if (!canMutate || prNumber == null || mergeClosed || mergeBlocked) return;
        setAutoMerging(true);
        try {
            await api.integrations.git.enablePullAutoMerge(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
            );
            addToast('Auto-merge enabled when checks pass.', 'success');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to enable auto-merge',
                'error',
            );
        } finally {
            setAutoMerging(false);
        }
    };

    const runPublishDraft = async () => {
        if (!canMutate || prNumber == null || !isDraft) return;
        setPublishing(true);
        try {
            const res = await api.integrations.git.updatePull(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
                { draft: false },
            );
            onPatchSelectedPR?.({
                is_draft: false,
                title: res.pullRequest.title,
            });
            addToast('Pull request is ready for review.', 'success');
            await Promise.all([
                onRefreshSelectedPR(),
                onRefreshPullList?.(),
            ]);
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to mark pull request ready',
                'error',
            );
        } finally {
            setPublishing(false);
        }
    };

    const runClose = async () => {
        if (!canMutate || prNumber == null || mergeClosed) return;
        if (
            !window.confirm(
                'Close this pull request without merging? The branch will stay on the remote — you can open a new pull request from it later.',
            )
        ) {
            return;
        }
        setClosing(true);
        try {
            await api.integrations.git.closePull(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
            );
            addToast('Pull request closed.', 'success');
            onPatchSelectedPR?.({ is_open: false, status: 'Changes Requested' });
            await Promise.all([
                onRefreshSelectedPR(),
                onRefreshPullList?.(),
            ]);
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to close pull request',
                'error',
            );
        } finally {
            setClosing(false);
        }
    };

    const runReopen = async () => {
        if (!canMutate || prNumber == null || selectedPR.is_open) return;
        if (selectedPR.status === 'Merged') return;
        setReopening(true);
        try {
            await api.integrations.git.reopenPull(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
            );
            addToast('Pull request reopened.', 'success');
            onPatchSelectedPR?.({ is_open: true, status: 'In Review' });
            await Promise.all([onRefreshSelectedPR(), onRefreshPullList?.()]);
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to reopen pull request',
                'error',
            );
        } finally {
            setReopening(false);
        }
    };

    const runUpdateBranch = async () => {
        if (!canMutate || prNumber == null) return;
        setUpdatingBranch(true);
        try {
            await api.integrations.git.updatePullBranch(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
            );
            addToast('Branch updated from base.', 'success');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to update branch',
                'error',
            );
        } finally {
            setUpdatingBranch(false);
        }
    };

    const submitLineComment = async () => {
        if (!lineCommentTarget || !canMutate || prNumber == null) return;
        const text = lineCommentText.trim();
        if (!text) {
            addToast('Write a comment before posting.', 'warning');
            return;
        }
        setPosting(true);
        try {
            await api.integrations.git.postPullReviewComment(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
                {
                    body: text,
                    path: lineCommentTarget.path,
                    line: lineCommentTarget.line,
                    side: lineCommentTarget.side,
                },
            );
            setLineCommentTarget(null);
            setLineCommentText('');
            addToast('Line comment posted.', 'success');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to post line comment',
                'error',
            );
        } finally {
            setPosting(false);
        }
    };

    const runReview = async (
        event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
        reviewBody?: string,
    ) => {
        if (!canMutate || prNumber == null) return;
        if (event === 'APPROVE' && isCurrentUserAuthor) {
            addToast('You cannot approve your own pull request.', 'warning');
            return;
        }
        const text = (reviewBody ?? commentText).trim();
        if (event === 'REQUEST_CHANGES' && !text) {
            addToast('Add a comment explaining the requested changes.', 'warning');
            return;
        }
        if (event === 'COMMENT' && prProvider !== 'gitlab' && !text) {
            addToast('Add comment text for this review.', 'warning');
            return;
        }
        setReviewing(true);
        try {
            await api.integrations.git.submitPullReview(prProvider, workspaceId, owner, repo, prNumber, {
                event,
                body: text || undefined,
            });
            if (event !== 'APPROVE' || text) setCommentText('');
            addToast(event === 'APPROVE' ? 'Approved.' : 'Review submitted.', 'success');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Review failed', 'error');
        } finally {
            setReviewing(false);
        }
    };

    const openReviewModal = (kind: ReviewModalKind) => {
        if (kind === 'APPROVE' && isCurrentUserAuthor) return;
        setReviewModalText('');
        setReviewModal(kind);
    };

    const submitReviewModal = async () => {
        if (!reviewModal) return;
        const text = reviewModalText.trim();
        if (reviewModal === 'REQUEST_CHANGES' && !text) {
            addToast('Add a comment explaining the requested changes.', 'warning');
            return;
        }
        await runReview(reviewModal, text);
        setReviewModal(null);
        setReviewModalText('');
    };

    const runRequestReviewer = async () => {
        const username = reviewerPick.trim();
        if (!username) {
            addToast('Choose a reviewer first.', 'warning');
            return;
        }
        const reviewerMember = workspaceMembers.find((member) =>
            isSameVcLogin(member.giteaUsername, username),
        );
        if (
            (prAuthorUserId && reviewerMember?.userId === prAuthorUserId) ||
            isPrAuthorLogin(
                username,
                selectedPR?.author_id,
                selectedPR?.author?.full_name,
            ) ||
            (authorMember?.giteaUsername &&
                isSameVcLogin(username, authorMember.giteaUsername))
        ) {
            addToast('The pull request author cannot be added as a reviewer.', 'warning');
            return;
        }
        if (!canMutate || prNumber == null) return;
        setRequestingReviewer(true);
        try {
            await api.integrations.git.requestPullReviewers(
                prProvider,
                workspaceId,
                owner,
                repo,
                prNumber,
                [username],
            );
            addToast(`Review requested from ${username}.`, 'success');
            setReviewerPick('');
            await onRefreshSelectedPR();
        } catch (e) {
            addToast(
                e instanceof Error ? e.message : 'Failed to request reviewer',
                'error',
            );
        } finally {
            setRequestingReviewer(false);
        }
    };

    return (
        <div className="w-full animate-in fade-in duration-300">
            {loadingDetail && (
                <div className="p-12 text-center text-text-secondary text-sm">Loading pull request…</div>
            )}

            {!loadingDetail ? (
                <div className="w-full max-w-[1600px] mx-auto space-y-4">
                    {variant === 'page' ? (
                        <VcBrandedHeader
                            provider={prProvider}
                            projectName={projectName}
                            projectId={projectId}
                            pullLabel={prLabel(selectedPR)}
                        />
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3 justify-between border border-border-dark rounded-xl bg-surface-dark/80 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3 min-w-0">
                            <button
                                type="button"
                                onClick={() => {
                                    onBack();
                                    onPrDetailTab('conversation');
                                }}
                                className="cursor-pointer flex items-center gap-2 text-text-secondary hover:text-main text-xs font-bold uppercase tracking-widest shrink-0"
                            >
                                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                {backLabel}
                            </button>
                            <span className="hidden sm:inline h-4 w-px bg-border-dark shrink-0" aria-hidden />
                            <span className="text-xs font-mono text-text-secondary shrink-0">{prLabel(selectedPR)}</span>
                            <span
                                className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border shrink-0 ${
                                    selectedPR.status === 'Approved'
                                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                        : selectedPR.status === 'Merged'
                                          ? 'bg-purple-500/10 border-purple-500/25 text-purple-400'
                                          : isDraft
                                            ? 'bg-slate-500/10 border-slate-500/25 text-slate-300'
                                            : selectedPR.is_open
                                              ? 'bg-primary/10 border-primary/25 text-primary'
                                              : 'bg-slate-500/10 border-slate-500/25 text-slate-400'
                                }`}
                            >
                                {isDraft ? 'Draft' : selectedPR.status}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {typeof selectedPR.files_changed_count === 'number' && selectedPR.files_changed_count > 0 ? (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-background-dark border border-border-dark text-main">
                                    {selectedPR.files_changed_count} files
                                </span>
                            ) : null}
                            {diffFiles.length > 0 ? (
                                <>
                                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                                        +{additions}
                                    </span>
                                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-red-400">
                                        −{deletions}
                                    </span>
                                </>
                            ) : null}
                            {variant === 'embedded' && oneworkShareUrl ? (
                                <Link
                                    href={oneworkShareUrl}
                                    className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/30 hover:bg-primary/10"
                                >
                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    See more details
                                </Link>
                            ) : providerExternalUrl ? (
                                <a
                                    href={providerExternalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/30 hover:bg-primary/10"
                                >
                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    {`View on ${providerName}`}
                                </a>
                            ) : null}
                        </div>
                    </div>

                    {readOnly ? (
                        <p className="text-xs text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2">
                            This project is read-only — merge, review, and comment actions are disabled.
                        </p>
                    ) : null}

                    {selectedPR.is_open && selectedPR.status !== 'Merged' && isDraft ? (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-500/40 bg-slate-500/10 px-4 py-3">
                            <div className="flex items-start gap-2 text-xs text-text-secondary min-w-0">
                                <span className="material-symbols-outlined text-slate-300 text-[18px] shrink-0">
                                    edit_document
                                </span>
                                <div>
                                    <p className="font-bold text-main">Draft pull request</p>
                                    <p>
                                        This PR is still a draft. Mark it ready for review when you want
                                        teammates to review and merge it.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void runPublishDraft()}
                                disabled={publishing || !canMutate}
                                className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 inline-flex items-center justify-center gap-2 shrink-0"
                            >
                                {publishing ? (
                                    <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <span className="material-symbols-outlined text-[16px]">published_with_changes</span>
                                )}
                                Ready for review
                            </button>
                        </div>
                    ) : null}

                    {selectedPR.is_open && selectedPR.status !== 'Merged' ? (
                        <div className="flex flex-col lg:flex-row flex-wrap gap-3 items-stretch lg:items-center justify-between rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                                <span className="font-bold text-main">PR actions</span>
                                {isDraft ? (
                                    <span className="text-slate-300">
                                        Draft PRs cannot be merged until marked ready for review.
                                    </span>
                                ) : null}
                                {approvalRequired ? (
                                    <span className="text-amber-400">
                                        At least one approving review from another collaborator is required before merge.
                                    </span>
                                ) : reviewSummary.hasBlockingChanges ? (
                                    <span className="text-amber-400">
                                        Changes were requested — address feedback before merging.
                                    </span>
                                ) : null}
                                {hasConflicts ? (
                                    <span className="text-amber-400">
                                        This branch has merge conflicts.
                                    </span>
                                ) : activity?.mergeable === false ? (
                                    <span className="text-amber-400">Possible conflicts — update branch or resolve locally</span>
                                ) : null}
                                {checksBlockMerge ? (
                                    <span className="text-amber-400">Required checks must pass before merge.</span>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {isDraft ? (
                                    <button
                                        type="button"
                                        onClick={() => void runPublishDraft()}
                                        disabled={publishing || !canMutate}
                                        className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-2"
                                    >
                                        {publishing ? (
                                            <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[16px]">
                                                published_with_changes
                                            </span>
                                        )}
                                        Ready for review
                                    </button>
                                ) : null}
                                {hasConflicts ? (
                                    <button
                                        type="button"
                                        onClick={() => void runUpdateBranch()}
                                        disabled={updatingBranch || !canMutate}
                                        className="cursor-pointer h-9 px-4 rounded-lg border border-amber-500/50 text-amber-400 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center gap-2"
                                    >
                                        {updatingBranch ? (
                                            <span className="size-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[16px]">sync</span>
                                        )}
                                        Update branch
                                    </button>
                                ) : null}
                                {supportsMergeMethods ? (
                                    <select
                                        value={mergeMethod}
                                        onChange={(e) => setMergeMethod(e.target.value as 'merge' | 'squash' | 'rebase')}
                                        className="h-9 rounded-lg bg-background-dark border border-border-dark text-xs text-main px-2"
                                        disabled={prActionsBusy || mergeBlocked}
                                    >
                                        <option value="merge">Merge commit</option>
                                        <option value="squash">Squash merge</option>
                                        <option value="rebase">Rebase merge</option>
                                    </select>
                                ) : (
                                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={squashMerge}
                                            onChange={(e) => setSquashMerge(e.target.checked)}
                                            disabled={prActionsBusy || mergeBlocked}
                                            className="rounded border-border-dark"
                                        />
                                        Squash merge
                                    </label>
                                )}
                                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={deleteBranchAfterMerge}
                                        onChange={(e) => setDeleteBranchAfterMerge(e.target.checked)}
                                        disabled={prActionsBusy || mergeBlocked}
                                        className="rounded border-border-dark"
                                    />
                                    Delete branch after merge
                                </label>
                                <button
                                    type="button"
                                    onClick={() => void runMerge()}
                                    disabled={prActionsBusy || mergeBlocked}
                                    className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-2"
                                >
                                    {merging ? (
                                        <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px]">merge</span>
                                    )}
                                    {mergeButtonLabel()}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runAutoMerge()}
                                    disabled={prActionsBusy || autoMerging || mergeBlocked}
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-primary/40 text-primary text-xs font-bold hover:bg-primary/10 disabled:opacity-40 inline-flex items-center gap-2"
                                >
                                    {autoMerging ? (
                                        <span className="size-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px]">schedule</span>
                                    )}
                                    Auto-merge
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openReviewModal('APPROVE')}
                                    disabled={posting || reviewing || prActionsBusy || !canMutate || isCurrentUserAuthor}
                                    title={isCurrentUserAuthor ? 'You cannot approve your own pull request' : undefined}
                                    className="cursor-pointer h-9 px-4 rounded-lg bg-emerald-600/90 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openReviewModal('REQUEST_CHANGES')}
                                    disabled={posting || reviewing || !canMutate}
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-amber-500/50 text-amber-400 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                                    Request changes
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runClose()}
                                    disabled={prActionsBusy || !canMutate || mergeClosed}
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-red-500/40 text-red-400 text-xs font-bold hover:bg-red-500/10 disabled:opacity-40 inline-flex items-center gap-2"
                                >
                                    {closing ? (
                                        <span className="size-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px]">cancel</span>
                                    )}
                                    Close PR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onPrDetailTab(prDetailTab === 'files' ? 'conversation' : 'files')}
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5 inline-flex items-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        {prDetailTab === 'files' ? 'forum' : 'difference'}
                                    </span>
                                    {prDetailTab === 'files' ? 'Conversation' : 'View changes'}
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {!selectedPR.is_open && selectedPR.status !== 'Merged' ? (
                        <div className="flex flex-col lg:flex-row flex-wrap gap-3 items-stretch lg:items-center justify-between rounded-xl border border-border-dark bg-surface-dark/35 px-4 py-3">
                            <p className="text-xs text-text-secondary">
                                This pull request is closed. You can reopen it if it was not merged.
                            </p>
                            <button
                                type="button"
                                onClick={() => void runReopen()}
                                disabled={reopening || !canMutate}
                                className="cursor-pointer h-9 px-4 rounded-lg border border-primary/40 text-primary text-xs font-bold hover:bg-primary/10 disabled:opacity-40 inline-flex items-center gap-2"
                            >
                                {reopening ? (
                                    <span className="size-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                ) : (
                                    <span className="material-symbols-outlined text-[16px]">undo</span>
                                )}
                                Reopen PR
                            </button>
                        </div>
                    ) : null}

                    <div className="flex overflow-hidden rounded-t-xl border border-border-dark border-b-0 bg-surface-dark/40">
                        <button
                            type="button"
                            onClick={() => onPrDetailTab('conversation')}
                            className={`cursor-pointer px-5 py-3 text-xs font-bold transition-all border-b-2 flex-1 sm:flex-none ${
                                prDetailTab === 'conversation'
                                    ? 'border-primary text-primary bg-white/[0.02]'
                                    : 'border-transparent text-text-secondary hover:text-main'
                            }`}
                        >
                            Conversation
                            {requestedReviewers.length > 0 || sortedReviews.length > 0 ? (
                                <span className="bg-primary/20 text-primary text-[10px] px-1.5 py-0.5 rounded-full">
                                    {requestedReviewers.length + sortedReviews.length}
                                </span>
                            ) : null}
                        </button>
                        <button
                            type="button"
                            onClick={() => onPrDetailTab('files')}
                            className={`cursor-pointer px-5 py-3 text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-2 flex-1 sm:flex-none ${
                                prDetailTab === 'files'
                                    ? 'border-primary text-primary bg-white/[0.02]'
                                    : 'border-transparent text-text-secondary hover:text-main'
                            }`}
                        >
                            Files changed
                            <span className="bg-white/10 text-text-secondary text-[10px] px-1.5 py-0.5 rounded-full">
                                {selectedPR.files_changed_count ?? diffFiles.length}
                            </span>
                        </button>
                    </div>

                    {selectedPR.is_open && selectedPR.status !== 'Merged' && canMutate ? (
                        <div className="border-x border-border-dark bg-surface-dark/35 px-4 sm:px-5 py-4 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <div>
                                    <h3 className="text-xs font-bold text-main flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px] text-primary">rate_review</span>
                                        Review this pull request
                                    </h3>
                                    <p className="text-[11px] text-text-secondary mt-0.5">
                                        {isCurrentUserAuthor
                                            ? 'You cannot approve your own pull request. Request a reviewer from your workspace instead.'
                                            : 'Request a reviewer from your workspace, or submit your own approval.'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col lg:flex-row flex-wrap gap-2 lg:items-center">
                                <select
                                    value={reviewerPick}
                                    onChange={(e) => setReviewerPick(e.target.value)}
                                    className="h-9 flex-1 min-w-[200px] rounded-lg bg-background-dark border border-border-dark text-xs text-main px-2"
                                    disabled={requestingReviewer || reviewerOptions.length === 0}
                                >
                                    <option value="">
                                        {reviewerOptions.length === 0
                                            ? 'Add collaborators under repo header first'
                                            : 'Request review from…'}
                                    </option>
                                    {reviewerOptions.map((option) => (
                                        <option key={option.login} value={option.login}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => void runRequestReviewer()}
                                    disabled={
                                        requestingReviewer ||
                                        !reviewerPick ||
                                        reviewerOptions.length === 0
                                    }
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-primary/40 text-primary text-xs font-bold hover:bg-primary/10 disabled:opacity-40 shrink-0 inline-flex items-center justify-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">person_add</span>
                                    {requestingReviewer ? 'Requesting…' : 'Request review'}
                                </button>
                                <span className="hidden lg:inline h-6 w-px bg-border-dark mx-1" aria-hidden />
                                <button
                                    type="button"
                                    onClick={() => openReviewModal('APPROVE')}
                                    disabled={posting || reviewing || prActionsBusy || isCurrentUserAuthor}
                                    title={isCurrentUserAuthor ? 'You cannot approve your own pull request' : undefined}
                                    className="cursor-pointer h-9 px-4 rounded-lg bg-emerald-600/90 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openReviewModal('REQUEST_CHANGES')}
                                    disabled={posting || reviewing}
                                    className="cursor-pointer h-9 px-4 rounded-lg border border-amber-500/50 text-amber-400 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                                    Request changes
                                </button>
                            </div>
                            {requestedReviewers.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                                        Waiting on:
                                    </span>
                                    {requestedReviewers.map((r) => (
                                        <span
                                            key={r.login}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-border-dark bg-background-dark/60 px-2.5 py-1 text-[11px] font-semibold text-main"
                                        >
                                            {r.avatar_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={r.avatar_url} alt="" className="size-4 rounded-full" />
                                            ) : null}
                                            {r.login}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {prDetailTab === 'conversation' ? (
                        <div className="rounded-b-xl border border-t-0 border-border-dark bg-surface-dark/20 overflow-hidden">
                            <div className="p-5 sm:p-6 border-b border-border-dark bg-white/[0.02]">
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <div className="relative shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={
                                                selectedPR.author?.avatar_url ||
                                                `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedPR.author?.full_name || '?')}&background=random`
                                            }
                                            className="size-12 rounded-xl border border-border-dark"
                                            alt=""
                                        />
                                        {renderAuthorPresence(selectedPR.author_id)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h2 className="text-xl sm:text-2xl font-bold text-main leading-tight">
                                            {selectedPR.title}{' '}
                                            <span className="text-text-secondary font-mono font-medium text-lg">
                                                {prLabel(selectedPR)}
                                            </span>
                                        </h2>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-text-secondary">
                                            <span className="font-semibold text-primary">{authorDisplayName}</span>
                                            <span className="text-text-secondary/50">·</span>
                                            <time dateTime={selectedPR.created_at}>
                                                {new Date(selectedPR.created_at).toLocaleString(undefined, {
                                                    dateStyle: 'medium',
                                                    timeStyle: 'short',
                                                })}
                                            </time>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                                            <span className="text-text-secondary">Merge</span>
                                            <span className="bg-background-dark px-2 py-0.5 rounded font-mono text-main border border-border-dark">
                                                {selectedPR.compare_branch}
                                            </span>
                                            <span className="text-text-secondary">into</span>
                                            <span className="bg-background-dark px-2 py-0.5 rounded font-mono text-main border border-border-dark">
                                                {selectedPR.base_branch}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="px-5 sm:px-6 py-5 border-b border-border-dark bg-background-dark/15">
                                <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-2">Description</h3>
                                {selectedPR.description?.trim() ? (
                                    <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {selectedPR.description}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-300 leading-relaxed italic">
                                        No description provided.
                                    </p>
                                )}
                            </div>
                            {selectedPR.labels.length > 0 ? (
                                <div className="px-5 sm:px-6 py-4 border-b border-border-dark">
                                    <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-2">Labels</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedPR.labels.map((l) => (
                                            <span
                                                key={l}
                                                className="px-2 py-0.5 bg-white/5 border border-border-dark rounded text-[10px] font-bold text-text-secondary"
                                            >
                                                {l}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {(selectedPR.assignees?.length ?? 0) > 0 ||
                            selectedPR.milestone ? (
                                <div className="px-5 sm:px-6 py-4 border-b border-border-dark">
                                    {selectedPR.assignees && selectedPR.assignees.length > 0 ? (
                                        <>
                                            <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-2">
                                                Assignees
                                            </h3>
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {selectedPR.assignees.map((a) => (
                                                    <span
                                                        key={a.login}
                                                        className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/5 border border-border-dark rounded text-[10px] font-bold text-main"
                                                    >
                                                        {a.login}
                                                    </span>
                                                ))}
                                            </div>
                                        </>
                                    ) : null}
                                    {selectedPR.milestone ? (
                                        <p className="text-xs text-text-secondary">
                                            Milestone:{' '}
                                            <span className="font-semibold text-main">
                                                {selectedPR.milestone.title}
                                            </span>
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="px-5 sm:px-6 py-5 border-b border-border-dark space-y-6">
                                <div className="rounded-xl border border-border-dark bg-background-dark/40 p-4 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center sm:justify-between">
                                    <div className="flex flex-col gap-1 text-xs text-text-secondary">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {isDraft ? (
                                                <span className="text-slate-300 font-bold">Draft</span>
                                            ) : null}
                                            {activity?.mergeable === true ? (
                                                <span className="text-emerald-400 font-bold">Mergeable</span>
                                            ) : activity?.mergeable === false ? (
                                                <span className="text-amber-400 font-bold">Not mergeable</span>
                                            ) : (
                                                <span className="font-bold text-text-secondary">Mergeability unknown</span>
                                            )}
                                            {checkSummary.aggregate === 'pass' ? (
                                                <span className="text-emerald-400 font-bold">Checks passed</span>
                                            ) : checkSummary.aggregate === 'fail' ? (
                                                <span className="text-red-400 font-bold">Checks failing</span>
                                            ) : checkSummary.aggregate === 'pending' ? (
                                                <span className="text-amber-400 font-bold">Checks pending</span>
                                            ) : null}
                                            {activity?.head_sha ? (
                                                <span
                                                    className="font-mono text-[10px] text-text-secondary/80 truncate max-w-[200px]"
                                                    title={activity.head_sha}
                                                >
                                                    {appSettings.developerMode ? activity.head_sha : activity.head_sha.slice(0, 7)}
                                                </span>
                                            ) : null}
                                        </div>
                                        {supportsMergeMethods ? (
                                            <p className="text-[10px] text-text-secondary">
                                                Method:{' '}
                                                <span className="text-main font-semibold">
                                                    {mergeMethod === 'squash'
                                                        ? 'Squash and merge'
                                                        : mergeMethod === 'rebase'
                                                          ? 'Rebase and merge'
                                                          : 'Create a merge commit'}
                                                </span>
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {isDraft ? (
                                            <button
                                                type="button"
                                                onClick={() => void runPublishDraft()}
                                                disabled={publishing || !canMutate}
                                                className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-2"
                                            >
                                                {publishing ? (
                                                    <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <span className="material-symbols-outlined text-[16px]">
                                                        published_with_changes
                                                    </span>
                                                )}
                                                Ready for review
                                            </button>
                                        ) : null}
                                        {supportsMergeMethods ? (
                                            <select
                                                value={mergeMethod}
                                                onChange={(e) => setMergeMethod(e.target.value as 'merge' | 'squash' | 'rebase')}
                                                className="h-9 rounded-lg bg-background-dark border border-border-dark text-xs text-main px-2"
                                                disabled={prActionsBusy || mergeBlocked}
                                            >
                                                <option value="merge">Create a merge commit</option>
                                                <option value="squash">Squash and merge</option>
                                                <option value="rebase">Rebase and merge</option>
                                            </select>
                                        ) : (
                                            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={squashMerge}
                                                    onChange={(e) => setSquashMerge(e.target.checked)}
                                                    disabled={prActionsBusy || mergeBlocked}
                                                    className="rounded border-border-dark"
                                                />
                                                Squash merge
                                            </label>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void runMerge()}
                                            disabled={prActionsBusy || mergeBlocked}
                                            className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-2"
                                            title={
                                                mergeClosed
                                                    ? 'This pull request is closed or merged'
                                                    : approvalRequired
                                                      ? 'At least one approving review from another collaborator is required'
                                                      : checksBlockMerge
                                                        ? 'Checks are pending or failing — you can still merge with confirmation'
                                                        : activity?.mergeable === false
                                                          ? 'Merge may fail due to conflicts'
                                                          : undefined
                                            }
                                        >
                                            {merging ? (
                                                <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[16px]">merge</span>
                                            )}
                                            {mergeButtonShortLabel()}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void runClose()}
                                            disabled={prActionsBusy || !canMutate || mergeClosed}
                                            className="cursor-pointer h-9 px-4 rounded-lg border border-red-500/40 text-red-400 text-xs font-bold hover:bg-red-500/10 disabled:opacity-40 inline-flex items-center gap-2"
                                        >
                                            {closing ? (
                                                <span className="size-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[16px]">cancel</span>
                                            )}
                                            Close PR
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">verified</span>
                                        Checks
                                        {checkSummary.total > 0 ? (
                                            <span className="font-mono text-text-secondary normal-case tracking-normal">
                                                {checkSummary.pass} pass · {checkSummary.pending} pending ·{' '}
                                                {checkSummary.fail} fail
                                            </span>
                                        ) : null}
                                    </h3>
                                    {(activity?.checks?.length ?? 0) === 0 ? (
                                        <p className="text-xs text-text-secondary italic">
                                            No status checks reported for this head commit.
                                        </p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {(activity?.checks ?? []).map((c) => {
                                                const failing = isCheckFailure(c);
                                                const pending = isCheckPending(c);
                                                const icon = failing
                                                    ? 'cancel'
                                                    : pending
                                                      ? 'pending'
                                                      : 'check_circle';
                                                const iconClass = failing
                                                    ? 'text-red-400'
                                                    : pending
                                                      ? 'text-amber-400'
                                                      : 'text-emerald-400';
                                                return (
                                                    <li
                                                        key={c.id}
                                                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-dark bg-surface-dark/40 px-3 py-2 text-xs"
                                                    >
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <span
                                                                className={`material-symbols-outlined text-[16px] shrink-0 ${iconClass}`}
                                                            >
                                                                {icon}
                                                            </span>
                                                            <span className="font-semibold text-main truncate">
                                                                {c.name}
                                                            </span>
                                                        </span>
                                                        <span className="flex items-center gap-2 shrink-0">
                                                            <span className="text-text-secondary">{c.status}</span>
                                                            {c.conclusion ? (
                                                                <span
                                                                    className={
                                                                        failing
                                                                            ? 'text-red-400 font-bold'
                                                                            : c.conclusion === 'success'
                                                                              ? 'text-emerald-400 font-bold'
                                                                              : 'text-text-secondary'
                                                                    }
                                                                >
                                                                    {c.conclusion}
                                                                </span>
                                                            ) : pending ? (
                                                                <span className="text-amber-400 font-bold">
                                                                    pending
                                                                </span>
                                                            ) : null}
                                                            {c.html_url && prProvider !== 'onework' ? (
                                                                <a
                                                                    href={c.html_url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary font-bold hover:underline"
                                                                >
                                                                    Open
                                                                </a>
                                                            ) : null}
                                                        </span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>

                                <div>
                                    <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                                        Reviews &amp; approvals
                                    </h3>
                                    {requestedReviewers.length > 0 ? (
                                        <div className="mb-4">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2">
                                                Requested reviewers
                                            </p>
                                            <ul className="flex flex-wrap gap-2">
                                                {requestedReviewers.map((r) => (
                                                    <li
                                                        key={r.login}
                                                        className="inline-flex items-center gap-2 rounded-lg border border-border-dark bg-surface-dark/40 px-2 py-1 text-xs"
                                                    >
                                                        {r.avatar_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={r.avatar_url}
                                                                alt=""
                                                                className="size-6 rounded-full"
                                                            />
                                                        ) : null}
                                                        <span className="font-semibold text-main">{r.login}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}
                                    {sortedReviews.length === 0 ? (
                                        <p className="text-xs text-text-secondary italic">No reviews yet.</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {sortedReviews.map((r) => (
                                                <li key={r.id} className="rounded-lg border border-border-dark bg-surface-dark/40 px-3 py-2 text-xs">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-bold text-primary">{r.author_login}</span>
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">
                                                            {r.state}
                                                        </span>
                                                        {r.submitted_at ? (
                                                            <time className="text-text-secondary ml-auto" dateTime={r.submitted_at}>
                                                                {new Date(r.submitted_at).toLocaleString()}
                                                            </time>
                                                        ) : null}
                                                    </div>
                                                    {r.body?.trim() ? (
                                                        <p className="mt-1 text-slate-300 whitespace-pre-wrap">{r.body}</p>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div>
                                    <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">forum</span>
                                        Comments
                                    </h3>
                                    {sortedComments.length === 0 ? (
                                        <p className="text-xs text-text-secondary italic">No comments yet.</p>
                                    ) : (
                                        <ul className="space-y-3">
                                            {sortedComments.map((c) => (
                                                <li key={c.id} className="flex gap-3 rounded-lg border border-border-dark bg-surface-dark/30 p-3">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={
                                                            c.author_avatar_url ||
                                                            `https://ui-avatars.com/api/?name=${encodeURIComponent(c.author_login)}&background=random`
                                                        }
                                                        alt=""
                                                        className="size-9 rounded-lg border border-border-dark shrink-0"
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                                            <span className="font-bold text-primary">{c.author_login}</span>
                                                            <time className="text-text-secondary" dateTime={c.created_at}>
                                                                {new Date(c.created_at).toLocaleString()}
                                                            </time>
                                                            {c.html_url && prProvider !== 'onework' ? (
                                                                <a
                                                                    href={c.html_url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary font-bold hover:underline ml-auto"
                                                                >
                                                                    Open
                                                                </a>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-1 text-sm text-slate-300 whitespace-pre-wrap">{c.body}</p>
                                                        {commentHasSuggestions(c.body) ? (
                                                            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-primary">
                                                                Contains suggested changes
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div className="rounded-xl border border-border-dark bg-background-dark/50 p-4 space-y-3">
                                    <label htmlFor="pr-comment" className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                                        Add a comment
                                    </label>
                                    <textarea
                                        id="pr-comment"
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        rows={4}
                                        placeholder={`Comment on this ${prProvider === 'gitlab' ? 'merge request' : 'pull request'}…`}
                                        className="w-full rounded-lg bg-background-dark border border-border-dark text-sm text-main px-3 py-2 placeholder:text-text-secondary/50 focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-y min-h-[96px]"
                                        disabled={posting || reviewing || !canMutate}
                                    />
                                    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void runPostComment()}
                                            disabled={posting || reviewing || !canMutate}
                                            className="cursor-pointer h-9 px-4 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                        >
                                            {posting ? (
                                                <span className="size-3 border-2 border-main/30 border-t-primary rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[16px]">chat</span>
                                            )}
                                            Post comment
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openReviewModal('APPROVE')}
                                            disabled={posting || reviewing || prActionsBusy || !canMutate || isCurrentUserAuthor}
                                            title={isCurrentUserAuthor ? 'You cannot approve your own pull request' : undefined}
                                            className="cursor-pointer h-9 px-4 rounded-lg bg-emerald-600/90 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                        >
                                            {reviewing ? (
                                                <span className="size-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                            )}
                                            Approve
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openReviewModal('REQUEST_CHANGES')}
                                            disabled={posting || reviewing || !canMutate}
                                            className="cursor-pointer h-9 px-4 rounded-lg border border-amber-500/50 text-amber-400 text-xs font-bold hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                        >
                                            Request changes
                                        </button>
                                        {supportsMergeMethods ? (
                                            <button
                                                type="button"
                                                onClick={() => void runReview('COMMENT')}
                                                disabled={posting || reviewing || !canMutate}
                                                className="cursor-pointer h-9 px-4 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5 disabled:opacity-40 inline-flex items-center justify-center gap-2"
                                            >
                                                Review comment
                                            </button>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center rounded-xl border border-border-dark bg-background-dark/40 p-4">
                                    <p className="text-sm text-text-secondary leading-relaxed">
                                        {prProvider === 'onework'
                                            ? 'All actions run in OneWork Version Control with your connected account.'
                                            : `Actions call the ${providerName} API with your connected account. You can still open the full page on the provider anytime.`}
                                    </p>
                                    {copyShareUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(
                                                    copyShareUrl.startsWith('http')
                                                        ? copyShareUrl
                                                        : `${window.location.origin}${copyShareUrl}`,
                                                ).then(
                                                    () => addToast('Link copied.', 'success'),
                                                    () => addToast('Could not copy link.', 'warning'),
                                                );
                                            }}
                                            className="cursor-pointer shrink-0 h-9 px-3 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5 inline-flex items-center gap-2"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">link</span>
                                            Copy link
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-b-xl border border-t-0 border-border-dark bg-surface-dark/20 p-4 sm:p-6 pt-6">
                            <div className="flex flex-col xl:flex-row gap-6 items-start">
                            <aside className="w-full xl:w-[280px] shrink-0 xl:sticky xl:top-2 xl:max-h-[calc(100vh-10rem)] flex flex-col gap-3 rounded-xl border border-border-dark bg-surface-dark/60 overflow-hidden">
                                <div className="px-3 py-2.5 border-b border-border-dark bg-white/[0.03]">
                                    <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.15em] mb-2">Files changed</p>
                                    <div className="relative">
                                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary text-[18px] pointer-events-none">
                                            search
                                        </span>
                                        <input
                                            type="search"
                                            value={fileFilter}
                                            onChange={(e) => setFileFilter(e.target.value)}
                                            placeholder="Filter files…"
                                            className="w-full pl-9 pr-3 py-2 rounded-lg bg-background-dark border border-border-dark text-xs text-main placeholder:text-text-secondary/60 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                        />
                                    </div>
                                </div>
                                <nav
                                    className="overflow-y-auto max-h-[40vh] xl:max-h-[calc(100vh-14rem)] px-2 pb-3 space-y-0.5"
                                    aria-label="Changed files"
                                >
                                    {diffFiles.length === 0 ? (
                                        <p className="text-xs text-text-secondary px-2 py-4 text-center italic">No file list loaded.</p>
                                    ) : sidebarEntries.length === 0 ? (
                                        <p className="text-xs text-text-secondary px-2 py-4 text-center italic">No files match filter.</p>
                                    ) : (
                                        sidebarEntries.map(({ file, idx }) => (
                                            <button
                                                key={`${file.filename}-${idx}`}
                                                type="button"
                                                onClick={() => scrollToFile(idx)}
                                                className="cursor-pointer w-full text-left flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-white/5 border border-transparent hover:border-border-dark transition-colors group"
                                            >
                                                <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0 mt-0.5 group-hover:text-primary">
                                                    {fileStatusIcon(file.status)}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[11px] font-mono text-main leading-snug break-all">
                                                        {file.filename}
                                                    </span>
                                                    <span className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                                                            {file.status}
                                                        </span>
                                                        <span className="text-[9px] font-bold text-emerald-500">+{file.additions}</span>
                                                        <span className="text-[9px] font-bold text-red-400">−{file.deletions}</span>
                                                    </span>
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </nav>
                            </aside>
                            <main className="flex-1 min-w-0 w-full">
                                <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[16px]">difference</span>
                                    Patch
                                </h3>
                                <FilesTab
                                    pr={selectedPR}
                                    readOnly={readOnly}
                                    onLineComment={
                                        canMutate
                                            ? (input) => {
                                                  setLineCommentTarget(input);
                                                  setLineCommentText('');
                                              }
                                            : undefined
                                    }
                                />
                            </main>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            {lineCommentTarget ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-lg bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-border-dark">
                            <h2 className="text-lg font-bold text-main">Add line comment</h2>
                            <p className="text-xs text-text-secondary mt-1 font-mono">
                                {lineCommentTarget.path}:{lineCommentTarget.line}
                            </p>
                        </div>
                        <div className="p-6 space-y-4">
                            <textarea
                                value={lineCommentText}
                                onChange={(e) => setLineCommentText(e.target.value)}
                                rows={4}
                                autoFocus
                                className="w-full rounded-lg bg-background-dark border border-border-dark text-sm text-main px-3 py-2 outline-none"
                                placeholder="Leave a comment on this line…"
                            />
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLineCommentTarget(null);
                                        setLineCommentText('');
                                    }}
                                    className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submitLineComment()}
                                    disabled={posting || !lineCommentText.trim()}
                                    className="cursor-pointer px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-xl disabled:opacity-50"
                                >
                                    {posting ? 'Posting…' : 'Post comment'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {reviewModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-lg bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                            <h2 className="text-lg font-bold text-main">
                                {reviewModal === 'APPROVE' ? 'Approve pull request' : 'Request changes'}
                            </h2>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!reviewing) {
                                        setReviewModal(null);
                                        setReviewModalText('');
                                    }
                                }}
                                disabled={reviewing}
                                className="cursor-pointer text-text-secondary hover:text-main transition-colors disabled:opacity-50"
                                aria-label="Close dialog"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-sm text-text-secondary">
                                {reviewModal === 'APPROVE'
                                    ? 'Add an optional comment with your approval.'
                                    : 'Explain what needs to change before this pull request can be approved.'}
                            </p>
                            <textarea
                                value={reviewModalText}
                                onChange={(e) => setReviewModalText(e.target.value)}
                                rows={5}
                                placeholder={
                                    reviewModal === 'APPROVE'
                                        ? 'Optional approval comment…'
                                        : 'Required feedback for the author…'
                                }
                                className="w-full rounded-lg bg-background-dark border border-border-dark text-sm text-main px-3 py-2 placeholder:text-text-secondary/50 focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-y min-h-[120px]"
                                disabled={reviewing}
                                autoFocus
                            />
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReviewModal(null);
                                        setReviewModalText('');
                                    }}
                                    disabled={reviewing}
                                    className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-main transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submitReviewModal()}
                                    disabled={
                                        reviewing ||
                                        (reviewModal === 'REQUEST_CHANGES' && !reviewModalText.trim())
                                    }
                                    className={`cursor-pointer px-6 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-50 ${
                                        reviewModal === 'APPROVE'
                                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                            : 'bg-amber-500 text-white hover:bg-amber-400'
                                    }`}
                                >
                                    {reviewing
                                        ? 'Submitting…'
                                        : reviewModal === 'APPROVE'
                                          ? 'Approve'
                                          : 'Request changes'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
