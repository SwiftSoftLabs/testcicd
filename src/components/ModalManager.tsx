'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import NewTaskModal from './modals/NewTaskModal';
import TaskDetailModal, { type TaskDetailModalProps } from './modals/TaskDetailModal';
import NewProjectModal from './modals/NewProjectModal';
import EditProjectModal from './modals/EditProjectModal';
import NewPRModal from './modals/NewPRModal';
import NewMessageModal from './modals/NewMessageModal';
// import AttachmentPreviewModal from './modals/AttachmentPreviewModal';
// import OAuthSimulationModal from './modals/OAuthSimulationModal';
import InviteUserModal from './modals/InviteUserModal';
import InviteRepoCollaboratorModal, { type InviteRepoCollaboratorModalProps } from './modals/InviteRepoCollaboratorModal';
import InviteToProjectModal from './modals/InviteToProjectModal';
import PlanComparisonModal from './modals/PlanComparisonModal';
import OAuthSimulationModal, { type OAuthSimulationModalProps } from './modals/OAuthSimulationModal';
import GitLinkedReposModal, { type GitLinkedReposModalProps } from './modals/GitLinkedReposModal';
import SprintModal from './modals/SprintModal';
import TaskTemplateModal from './modals/TaskTemplateModal';
import EditTemplateModal from './modals/EditTemplateModal';
import type { TaskTemplate } from '@/types';
import AttachmentPreviewModal, { type AttachmentPreviewModalProps } from './modals/AttachmentPreviewModal';
import ConfirmActionModal, { type ConfirmActionModalProps } from './modals/ConfirmActionModal';
import FilePreviewModal from './modals/FilePreviewModal';
import { EventModal } from './calendar/EventModal';
import ImageLightboxModal, { type ImageLightboxModalProps } from './modals/ImageLightboxModal';
import QuotaKeepModal, { type QuotaKeepModalProps } from './modals/QuotaKeepModal';

type ModalProps = Record<string, unknown> | null;

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const ModalLayer: React.FC<{
    children: React.ReactNode;
    isTop: boolean;
    label: string;
    dismissible: boolean;
    onClose: () => void;
    instanceId: string;
}> = ({ children, isTop, label, dismissible, onClose, instanceId }) => {
    const layerRef = useRef<HTMLDivElement>(null);
    const lastFocusedRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isTop) return;

        lastFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const focusTarget =
            layerRef.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus="true"]') ??
            layerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
            layerRef.current;

        focusTarget?.focus();
    }, [isTop]);

    useEffect(() => {
        return () => {
            lastFocusedRef.current?.focus?.();
        };
    }, []);

    useEffect(() => {
        if (!isTop) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!layerRef.current) return;

            if (event.key === 'Escape' && dismissible) {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusable = Array.from(
                layerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
            ).filter((node) => !node.hasAttribute('disabled') && node.tabIndex !== -1);

            if (focusable.length === 0) {
                event.preventDefault();
                layerRef.current.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [dismissible, isTop, onClose]);

    return (
        <div
            ref={layerRef}
            data-modal-layer
            data-modal-instance={instanceId}
            className={`fixed inset-0 flex items-center justify-center p-4 ${
                isTop ? 'z-[100] pointer-events-auto' : 'z-[90] pointer-events-none opacity-0'
            }`}
            role="dialog"
            aria-modal={isTop ? 'true' : 'false'}
            aria-label={label}
            aria-hidden={isTop ? undefined : true}
            tabIndex={-1}
        >
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 dismiss-backdrop"
                onClick={dismissible ? onClose : undefined}
            />
            <div className="relative z-10 flex w-full max-h-[calc(100dvh-2rem)] justify-center overflow-y-auto">
                <div className="flex w-full justify-center py-2">
                    {children}
                </div>
            </div>
        </div>
    );
};

const ModalManager: React.FC = () => {
    const { modalStack, closeModal } = useUIContext();
    const { projects } = useAppContext();

    useEffect(() => {
        if (modalStack.length === 0) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [modalStack.length]);

    const portalTarget = useMemo(() => {
        if (typeof document === 'undefined') return null;
        return document.body;
    }, []);

    if (modalStack.length === 0 || !portalTarget) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderModal = (modalId: string, modalProps: ModalProps) => {
        // Dynamic dispatch: props are typed per-modal at callsite, not here
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = (modalProps ?? {}) as any;

        switch (modalId) {
            case 'new-task':
                return <NewTaskModal onClose={closeModal} {...props} />;
            case 'task-detail': {
                const p = props as unknown as TaskDetailModalProps;
                const taskProject = p.task?.projectId
                    ? projects.find((pr) => pr.id === p.task.projectId)
                    : null;
                const taskReadOnly = taskProject?.quota_locked === true;
                return <TaskDetailModal onClose={closeModal} task={p.task} readOnly={taskReadOnly} />;
            }
            case 'invite-user':
                return <InviteUserModal onClose={closeModal} {...props} />;
            case 'invite-repo-collaborator': {
                const p = props as unknown as InviteRepoCollaboratorModalProps;
                return (
                    <InviteRepoCollaboratorModal
                        onClose={closeModal}
                        workspaceId={p.workspaceId}
                        provider={p.provider}
                        owner={p.owner}
                        repo={p.repo}
                        repoFullName={p.repoFullName}
                    />
                );
            }
            case 'invite-to-project':
                return <InviteToProjectModal onClose={closeModal} {...props} />;
            case 'plan-comparison':
                return <PlanComparisonModal onClose={closeModal} {...props} />;
            case 'oauth-simulation': {
                const p = props as unknown as OAuthSimulationModalProps;
                return (
                    <OAuthSimulationModal
                        onClose={closeModal}
                        provider={p.provider}
                        workspaceId={p.workspaceId}
                        projectId={p.projectId}
                        oauthConfigured={p.oauthConfigured}
                        onConnected={p.onConnected}
                        afterSessionEstablished={p.afterSessionEstablished}
                    />
                );
            }
            case 'git-linked-repos': {
                const p = props as unknown as GitLinkedReposModalProps;
                return (
                    <GitLinkedReposModal
                        onClose={closeModal}
                        workspaceId={p.workspaceId}
                        projectId={p.projectId}
                        provider={p.provider}
                        onSaved={p.onSaved}
                    />
                );
            }
            case 'new-project':
                return <NewProjectModal onClose={closeModal} {...props} />;
            case 'edit-project':
                return <EditProjectModal onClose={closeModal} {...props} />;
            case 'new-pr':
                return <NewPRModal onClose={closeModal} {...props} />;
            case 'new-message':
                return <NewMessageModal onClose={closeModal} {...props} />;
            case 'sprint-modal':
                return <SprintModal onClose={closeModal} {...props} />;
            case 'template-picker':
                return <TaskTemplateModal onClose={closeModal} {...props} />;
            case 'edit-template': {
                const p = props as unknown as { template: TaskTemplate; onSaved: (t: TaskTemplate) => void };
                return <EditTemplateModal onClose={closeModal} template={p.template} onSaved={p.onSaved} />;
            }
            case 'attachment-preview': {
                const p = props as unknown as AttachmentPreviewModalProps;
                return (
                    <AttachmentPreviewModal
                        onClose={closeModal}
                        url={p.url}
                        downloadUrl={p.downloadUrl ?? p.url}
                        name={p.name}
                    />
                );
            }
            case 'image-lightbox': {
                const p = props as unknown as ImageLightboxModalProps;
                return <ImageLightboxModal onClose={closeModal} url={p.url} />;
            }
            case 'file-preview': {
                const p = props as unknown as { fileId: string; fileName: string; fileType: string };
                return <FilePreviewModal onClose={closeModal} fileId={p.fileId} fileName={p.fileName} fileType={p.fileType} />;
            }
            case 'confirm-action': {
                const p = props as unknown as ConfirmActionModalProps;
                return (
                    <ConfirmActionModal
                        onClose={closeModal}
                        title={p.title}
                        message={p.message}
                        content={p.content}
                        confirmLabel={p.confirmLabel}
                        confirmInProgressLabel={p.confirmInProgressLabel}
                        cancelLabel={p.cancelLabel}
                        intent={p.intent}
                        requireTextMatch={p.requireTextMatch}
                        confirmInputLabel={p.confirmInputLabel}
                        confirmInputPlaceholder={p.confirmInputPlaceholder}
                        confirmDisabled={p.confirmDisabled}
                        onConfirm={p.onConfirm}
                    />
                );
            }
            case 'quota-keep': {
                const p = props as unknown as QuotaKeepModalProps;
                return (
                    <QuotaKeepModal
                        onClose={closeModal}
                        workspaceId={p.workspaceId}
                        overQuota={p.overQuota}
                        onDone={p.onDone}
                    />
                );
            }
            case 'calendar-event':
                return <EventModal onClose={closeModal} {...props} />;
            default:
                return (
                    <div className="bg-surface-dark border border-border-dark p-8 rounded-xl shadow-2xl">
                        <h2 className="text-xl font-bold mb-4">Modal: {modalId}</h2>
                        <p className="text-text-secondary mb-6">This modal has not been migrated yet.</p>
                        <button onClick={closeModal} className="cursor-pointer px-4 py-2 bg-primary rounded-lg text-sm font-bold">Close</button>
                    </div>
                );
        }
    };

    return createPortal(
        <>
            {modalStack.map((entry, index) => {
                const isTop = index === modalStack.length - 1;
                const dismissible = entry.props?.dismissible !== false;
                const label =
                    (typeof entry.props?.ariaLabel === 'string' ? entry.props.ariaLabel : undefined) ??
                    (typeof entry.props?.title === 'string' ? entry.props.title : undefined) ??
                    entry.id.replace(/-/g, ' ');

                return (
                    <ModalLayer
                        key={entry.instanceId}
                        instanceId={entry.instanceId}
                        isTop={isTop}
                        label={label}
                        dismissible={dismissible}
                        onClose={closeModal}
                    >
                        {renderModal(entry.id, entry.props)}
                    </ModalLayer>
                );
            })}
        </>,
        portalTarget,
    );
};

export default ModalManager;
