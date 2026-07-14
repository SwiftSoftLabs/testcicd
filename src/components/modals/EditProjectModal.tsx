'use client';

import React, { useState, useRef } from 'react';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { api } from '@/lib/api';
import { Project } from '@/types';
import ProjectColorPicker from './ProjectColorPicker';
import { normalizeProjectKeyInput, PROJECT_KEY_MAX_LENGTH, PROJECT_KEY_RE } from '@/lib/tasks/taskKey';

interface EditProjectModalProps {
    onClose: () => void;
    project: Project;
}

const EditProjectModal: React.FC<EditProjectModalProps> = ({ onClose, project }) => {
    const { addToast } = useUIContext();
    const { updateProject } = useAppContext();
    const modalRef = useRef<HTMLDivElement>(null);
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description?.slice(0, 50) ?? '');
    const [color, setColor] = useState(project.color ?? '#195de6');
    const [projectKey, setProjectKey] = useState(project.key ?? '');
    const [isLoading, setIsLoading] = useState(false);
    const readOnly = project.quota_locked === true;

    useClickOutside(modalRef, onClose);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (readOnly) {
            addToast('This project is read-only because your workspace is over its plan limit.', 'warning');
            return;
        }
        if (!name.trim()) return;
        const normalizedKey = normalizeProjectKeyInput(projectKey);
        if (!PROJECT_KEY_RE.test(normalizedKey)) {
            addToast('Project key must be 2–50 uppercase letters/numbers, starting with a letter', 'error');
            return;
        }

        setIsLoading(true);
        try {
            const updated = await api.projects.update(project.id, {
                name: name.trim(),
                key: normalizedKey,
                description: description.trim() || undefined,
                color,
            }) as Project;
            updateProject(updated);
            addToast(`Project "${updated.name}" updated successfully!`, 'success');
            onClose();
        } catch (error) {
            console.error('Failed to update project:', error);
            addToast('Failed to update project', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div ref={modalRef} className="max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                <h2 className="text-xl font-bold text-white">Edit Project</h2>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white transition-colors" aria-label="Close dialog">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {readOnly && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
                        This project is read-only because your workspace is over its plan limit. Delete it to free capacity or upgrade to restore editing.
                    </div>
                )}
                <div className="space-y-1.5">
                    <label htmlFor="edit-project-name" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Project Name</label>
                    <input
                        id="edit-project-name"
                        autoFocus
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={readOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="e.g., Marketing Site Refactor"
                        required
                    />
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label htmlFor="edit-project-description" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Description</label>
                        <span className={`text-[10px] font-bold tabular-nums ${description.length >= 50 ? 'text-red-400' : 'text-text-secondary'}`}>
                            {description.length}/50
                        </span>
                    </div>
                    <input
                        id="edit-project-description"
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 50))}
                        maxLength={50}
                        disabled={readOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="Short subtitle (max 50 chars)..."
                    />
                </div>

                <div className="space-y-1.5">
                    <label htmlFor="edit-project-key" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Project Key</label>
                    <input
                        id="edit-project-key"
                        type="text"
                        value={projectKey}
                        onChange={(e) => setProjectKey(normalizeProjectKeyInput(e.target.value))}
                        disabled={readOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm font-mono focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all uppercase disabled:cursor-not-allowed disabled:opacity-60"
                        maxLength={PROJECT_KEY_MAX_LENGTH}
                        required
                    />
                    <p className="text-[10px] text-text-secondary">Existing task keys stay the same; new tasks use the updated key.</p>
                </div>

                <ProjectColorPicker value={color} onChange={setColor} disabled={readOnly} />

                <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={onClose} className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors" disabled={isLoading}>Cancel</button>
                    <button type="submit" className="px-10 py-2.5 bg-primary text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary" disabled={isLoading || readOnly}>
                        {isLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EditProjectModal;
