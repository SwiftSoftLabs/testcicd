'use client';

import React, { useRef, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { TaskTemplate, User } from '@/types';
import { api } from '@/lib/api';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';

type Priority = 'urgent' | 'high' | 'medium' | 'low';

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
    { value: 'urgent', label: 'Urgent', color: 'text-red-400 border-red-400/40 bg-red-400/10' },
    { value: 'high', label: 'High', color: 'text-orange-400 border-orange-400/40 bg-orange-400/10' },
    { value: 'medium', label: 'Medium', color: 'text-blue-400 border-blue-400/40 bg-blue-400/10' },
    { value: 'low', label: 'Low', color: 'text-slate-400 border-slate-400/40 bg-slate-400/10' },
];

interface EditTemplateModalProps {
    onClose: () => void;
    template: TaskTemplate;
    onSaved: (updated: TaskTemplate) => void;
}

const EditTemplateModal: React.FC<EditTemplateModalProps> = ({ onClose, template, onSaved }) => {
    const { users } = useAppContext();
    const { addToast } = useUIContext();
    const modalRef = useRef<HTMLDivElement>(null);
    useClickOutside(modalRef, onClose);

    const [name, setName] = useState(template.name);
    const [title, setTitle] = useState(template.title);
    const [description, setDescription] = useState(template.description || '');
    const [priority, setPriority] = useState<Priority>(template.priority as Priority);
    const [tagsInput, setTagsInput] = useState(template.tags.join(', '));
    const [assigneeId, setAssigneeId] = useState(template.default_assignee_id || '');
    const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
    const assigneeDropdownRef = useRef<HTMLDivElement>(null);
    useClickOutside(assigneeDropdownRef, () => setShowAssigneeDropdown(false));
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!name.trim() || !title.trim()) return;
        setIsSaving(true);
        try {
            const tags = tagsInput
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            const payload = {
                name: name.trim(),
                title: title.trim(),
                description: description.trim() || null,
                priority,
                tags,
                default_assignee_id: assigneeId || null,
            };
            const result = await api.taskTemplates.update(template.id, payload);
            onSaved(result as TaskTemplate);
            onClose();
        } catch {
            addToast('Failed to save template', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const assignee = users.find((u) => u.id === assigneeId);

    return (
        <div
            ref={modalRef}
            className="w-full max-w-lg mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        >
            <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between">
                <h2 className="text-lg font-black text-white">Edit Template</h2>
                <button
                    onClick={onClose}
                    className="cursor-pointer text-text-secondary hover:text-white"
                    aria-label="Close dialog"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            <div className="p-6 space-y-4 max-h-[calc(100dvh-12rem)] overflow-y-auto custom-scrollbar">
                {/* Template name */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Template Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Bug Report"
                        className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary outline-none"
                        autoFocus
                    />
                </div>

                {/* Task title */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Task Title
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Default task title when applied"
                        className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary outline-none"
                    />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Description
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional default description"
                        rows={3}
                        className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary outline-none resize-none custom-scrollbar"
                    />
                </div>

                {/* Priority */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Priority
                    </label>
                    <div className="flex gap-2 flex-wrap">
                        {PRIORITY_OPTIONS.map((p) => (
                            <button
                                key={p.value}
                                type="button"
                                onClick={() => setPriority(p.value)}
                                className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                    priority === p.value
                                        ? p.color
                                        : 'text-text-secondary border-border-dark hover:border-white/20'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Tags
                    </label>
                    <input
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        placeholder="bug, frontend, urgent"
                        className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary outline-none"
                    />
                    <p className="text-[11px] text-text-secondary">Comma-separated</p>
                </div>

                {/* Default Assignee */}
                <div className="space-y-1.5 relative" ref={assigneeDropdownRef}>
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                        Default Assignee
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowAssigneeDropdown((p) => !p)}
                        className="cursor-pointer w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-3 py-2.5 flex items-center gap-2 hover:border-white/20 transition-all"
                    >
                        {assignee ? (
                            <>
                                <div className="relative inline-flex shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={assignee.avatar} className="size-5 rounded-full" alt="" />
                                    <span className="absolute -bottom-0.5 -right-0.5">
                                        <PresenceDot status={presenceFromMemberStatus(assignee.status)} size="sm" ring />
                                    </span>
                                </div>
                                <span className="truncate">{assignee.name}</span>
                            </>
                        ) : (
                            <span className="text-text-secondary">None</span>
                        )}
                        <span className="material-symbols-outlined text-[16px] text-text-secondary ml-auto">
                            unfold_more
                        </span>
                    </button>
                    {showAssigneeDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-48 overflow-y-auto custom-scrollbar">
                            <button
                                type="button"
                                onClick={() => { setAssigneeId(''); setShowAssigneeDropdown(false); }}
                                className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-text-secondary hover:bg-white/5"
                            >
                                None
                            </button>
                            {users.map((u: User) => (
                                <button
                                    type="button"
                                    key={u.id}
                                    onClick={() => { setAssigneeId(u.id); setShowAssigneeDropdown(false); }}
                                    className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 flex items-center gap-3"
                                >
                                    <div className="relative inline-flex shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={u.avatar} className="size-5 rounded-full" alt="" />
                                        <span className="absolute -bottom-0.5 -right-0.5">
                                            <PresenceDot status={presenceFromMemberStatus(u.status)} size="sm" ring />
                                        </span>
                                    </div>
                                    {u.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="px-6 py-4 border-t border-border-dark flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="cursor-pointer px-4 py-2 text-sm font-bold text-text-secondary hover:text-white transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!name.trim() || !title.trim() || isSaving}
                    className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                    {isSaving ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};

export default EditTemplateModal;
