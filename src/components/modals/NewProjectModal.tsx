'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { Project } from '@/types';
import type { BillingSummary } from '@/types/billing';
import ProjectColorPicker from './ProjectColorPicker';
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
    deriveProjectKey,
    normalizeProjectKeyInput,
    PROJECT_KEY_MAX_LENGTH,
    PROJECT_KEY_RE,
} from '@/lib/tasks/taskKey';

interface NewProjectModalProps {
    onClose: () => void;
    onCreated?: (project: Project) => void;
}

const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, onCreated }) => {
    const { addToast, openModal } = useUIContext();
    const { addProject, projects, selectedWorkspaceId } = useAppContext();
    const modalRef = useRef<HTMLDivElement>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState('#195de6');
    const [projectKey, setProjectKey] = useState('');
    const [keyTouched, setKeyTouched] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [limitChecking, setLimitChecking] = useState(true);
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (!keyTouched && name.trim()) {
            setProjectKey(deriveProjectKey(name));
        }
    }, [name, keyTouched]);

    useEffect(() => {
        setLimitChecking(true);
        if (!selectedWorkspaceId) { setLimitChecking(false); return; }
        authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json: { data: BillingSummary } | null) => {
                const max = json?.data?.entitlements?.max_projects ?? null;
                if (max !== null && projects.length >= max) {
                    onClose();
                    openModal('plan-comparison', { note: 'Upgrade to create more projects.', canManage: json?.data?.canManage ?? false, currentPlan: json?.data?.plan?.code ?? 'basic', plans: json?.data?.plans ?? [], workspaceId: selectedWorkspaceId });
                }
            })
            // fail open — billing check errors should never block the user action
            .catch(() => {})
            .finally(() => setLimitChecking(false));
    }, [onClose, openModal, projects.length, selectedWorkspaceId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        const normalizedKey = normalizeProjectKeyInput(projectKey);
        if (!PROJECT_KEY_RE.test(normalizedKey)) {
            addToast('Project key must be 2–50 uppercase letters/numbers, starting with a letter', 'error');
            return;
        }

        setIsLoading(true);
        try {
            const project = await addProject({
                name,
                key: normalizedKey,
                description: description.trim() || undefined,
                status: 'active',
                visibility: 'public',
                color
            });
            if (project) onCreated?.(project);
            addToast(`Project "${name}" created successfully!`, 'success');
            onClose();
        } catch (error) {
            console.error('Failed to create project:', error);
            addToast('Failed to create project', 'error');
        } finally {
            setIsLoading(false);
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
                <h2 className="text-xl font-bold text-white">Create Project</h2>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white transition-colors" aria-label="Close dialog">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-1.5">
                    <label htmlFor="new-project-name" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Project Name</label>
                    <input
                        id="new-project-name"
                        autoFocus
                        data-tour="project-name-input"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all"
                        placeholder="e.g., Marketing Site Refactor"
                        required
                    />
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label htmlFor="new-project-description" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Description</label>
                        <span className={`text-[10px] font-bold tabular-nums ${description.length >= 50 ? 'text-red-400' : 'text-text-secondary'}`}>
                            {description.length}/50
                        </span>
                    </div>
                    <input
                        id="new-project-description"
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 50))}
                        maxLength={50}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all"
                        placeholder="Short subtitle (max 50 chars)..."
                    />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="new-project-key" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Project Key</label>
                    <input
                        id="new-project-key"
                        type="text"
                        value={projectKey}
                        onChange={(e) => {
                            setKeyTouched(true);
                            setProjectKey(normalizeProjectKeyInput(e.target.value));
                        }}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm font-mono focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all uppercase"
                        placeholder="e.g., ONEWORK"
                        maxLength={PROJECT_KEY_MAX_LENGTH}
                        required
                    />
                    <p className="text-[10px] text-text-secondary">Used in task IDs like ONEWORK-12. Task numbers restart per project.</p>
                </div>

                <ProjectColorPicker value={color} onChange={setColor} />

                <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={onClose} className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors" disabled={isLoading}>Cancel</button>
                    <button type="submit" data-tour="create-project-submit" className="cursor-pointer px-10 py-2.5 bg-primary text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50" disabled={isLoading}>
                        {isLoading ? 'Creating...' : 'Create Project'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default NewProjectModal;
