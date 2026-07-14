'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useProjectLock } from '@/hooks/useProjectLock';
import { Project, User, Status, TaskTemplate, Sprint, Task } from '@/types';
import { api } from '@/lib/api';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Priority = 'urgent' | 'high' | 'medium' | 'low';

interface NewTaskModalProps {
    onClose: () => void;
    initialStatus?: Status;
    initialProjectId?: string;
    /** Prefill from Task assistant (POST /api/tasks/ai quick_create) */
    initialTitle?: string;
    initialDescription?: string;
    initialPriority?: Priority;
    /** Comma-separated tags, same as manual tags field */
    initialTags?: string;
    initialAssigneeId?: string;
}

const PRIORITY_SET = new Set<Priority>(['urgent', 'high', 'medium', 'low']);

const STATUSES: { value: Status; label: string; color: string }[] = [
    { value: 'backlog', label: 'Backlog', color: 'bg-slate-400' },
    { value: 'todo', label: 'To Do', color: 'bg-blue-400' },
    { value: 'in-progress', label: 'In Progress', color: 'bg-primary' },
    { value: 'review', label: 'Review', color: 'bg-purple-400' },
    { value: 'done', label: 'Done', color: 'bg-emerald-400' },
];

const NewTaskModal: React.FC<NewTaskModalProps> = ({
    onClose,
    initialStatus = 'todo',
    initialProjectId,
    initialTitle,
    initialDescription,
    initialPriority,
    initialTags,
    initialAssigneeId,
}) => {
    const { projects, users, projectSprints, tasks, addTask, selectedProjectId, selectedWorkspaceId, selectedWorkspace, currentUser } = useAppContext();

    const { addToast, openModal } = useUIContext();
    const modalRef = useRef<HTMLDivElement>(null);

    // Core form fields
    const [title, setTitle] = useState(() => initialTitle?.trim() || '');
    const [description, setDescription] = useState(() => initialDescription?.trim() || '');
    const [priority, setPriority] = useState<Priority>(() =>
        initialPriority && PRIORITY_SET.has(initialPriority) ? initialPriority : 'medium',
    );
    const [status, setStatus] = useState<Status>(initialStatus);
    const [projectId, setProjectId] = useState(
        initialProjectId || selectedProjectId || projects[0]?.id || '',
    );
    const isLockedProject = useProjectLock(projectId);
    const [assigneeId, setAssigneeId] = useState(initialAssigneeId || '');
    const [dueDate, setDueDate] = useState('');
    const [tagsInput, setTagsInput] = useState(() => initialTags?.trim() || '');
    const [sprintId, setSprintId] = useState(() => projectSprints.find(s => s.status === 'active')?.id ?? '');
    const [isLoading, setIsLoading] = useState(false);

    // Template dropdown
    const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
    const [templates, setTemplates] = useState<TaskTemplate[]>([]);
    const [templateSearch, setTemplateSearch] = useState('');
    const [templatesLoaded, setTemplatesLoaded] = useState(false);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const templateDropdownRef = useRef<HTMLDivElement>(null);
    const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
    const assigneeDropdownRef = useRef<HTMLDivElement>(null);
    useClickOutside(assigneeDropdownRef, () => setShowAssigneeDropdown(false));

    // Subtasks (collected locally, created after task)
    const [subtasks, setSubtasks] = useState<string[]>([]);
    const [subtaskInput, setSubtaskInput] = useState('');
    const [expandSubtasks, setExpandSubtasks] = useState(false);

    // Dependencies (collected locally, linked after task)
    const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
    const [depSearch, setDepSearch] = useState('');
    const [expandDeps, setExpandDeps] = useState(false);

    // Files (uploaded immediately to workspace storage, linked to task after creation)
    const [stagedWorkspaceFiles, setStagedWorkspaceFiles] = useState<{ id: string; name: string }[]>([]);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [expandFiles, setExpandFiles] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useClickOutside(modalRef, onClose);
    useClickOutside(templateDropdownRef, () => setShowTemplateDropdown(false));

    // Load templates lazily when the dropdown first opens
    useEffect(() => {
        if (!showTemplateDropdown || templatesLoaded || !selectedWorkspaceId) return;
        api.taskTemplates.getAll(selectedWorkspaceId)
            .then(data => { setTemplates(data as TaskTemplate[]); setTemplatesLoaded(true); })
            .catch(() => addToast('Failed to load templates', 'error'));
    }, [showTemplateDropdown, templatesLoaded, selectedWorkspaceId, addToast]);

    const applyTemplate = (template: TaskTemplate) => {
        setTitle(template.title);
        setDescription(template.description || '');
        setPriority(template.priority as Priority);
        setTagsInput((template.tags || []).join(', '));
        setAssigneeId(template.default_assignee_id || '');
    };

    const handleSaveAsTemplate = async () => {
        if (!title.trim() || !selectedWorkspaceId) {
            addToast('Enter a title before saving as template', 'error');
            return;
        }
        setIsSavingTemplate(true);
        try {
            const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
            await api.taskTemplates.create({
                workspace_id: selectedWorkspaceId,
                name: title.trim(),
                title: title.trim(),
                description,
                priority,
                tags,
                ...(assigneeId && { default_assignee_id: assigneeId }),
            });
            addToast('Saved as template!', 'success');
        } catch {
            addToast('Failed to save template', 'error');
        } finally {
            setIsSavingTemplate(false);
        }
    };

    const addSubtask = () => {
        if (!subtaskInput.trim()) return;
        setSubtasks(prev => [...prev, subtaskInput.trim()]);
        setSubtaskInput('');
    };

    const resolveWorkspaceId = (): string | null => {
        if (selectedWorkspaceId) return selectedWorkspaceId;
        if (selectedWorkspace?.id) return selectedWorkspace.id;
        // Fallback: read persisted workspace ID from localStorage
        if (typeof window !== 'undefined' && currentUser?.id) {
            return localStorage.getItem(`ow-selected-workspace-id:${currentUser.id}`);
        }
        return null;
    };

    const uploadFiles = async (fileArray: File[]) => {
        const workspaceId = resolveWorkspaceId();
        if (!workspaceId) {
            addToast('No active workspace. Please select a workspace and try again.', 'error');
            return;
        }
        setExpandFiles(true);
        setUploadingCount(c => c + fileArray.length);
        await Promise.allSettled(
            fileArray.map(async (file) => {
                const fd = new FormData();
                fd.append('file', file);
                fd.append('workspace_id', workspaceId);
                try {
                    const res = await authenticatedFetch('/api/files/upload', { method: 'POST', body: fd });
                    if (res.ok) {
                        const data = await res.json();
                        setStagedWorkspaceFiles(prev => [...prev, { id: data.id, name: file.name }]);
                    } else {
                        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                        addToast(`Failed to upload "${file.name}": ${err.error ?? 'Upload failed'}`, 'error');
                    }
                } catch {
                    addToast(`Failed to upload "${file.name}"`, 'error');
                } finally {
                    setUploadingCount(c => c - 1);
                }
            })
        );
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        // IMPORTANT: Copy files into an array BEFORE clearing the input.
        // FileList is a live reference — clearing e.target.value empties it.
        const fileArray = Array.from(files);
        e.target.value = '';
        await uploadFiles(fileArray);
    };

    // Paste-to-upload: capture clipboard images/files anywhere in the modal
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const files = Array.from(e.clipboardData.files);
            if (files.length > 0) {
                uploadFiles(files);
                return;
            }
            // Also handle pasted images that come as clipboard items (e.g. screenshots)
            const imageItems = Array.from(e.clipboardData.items).filter(
                item => item.kind === 'file' && item.type.startsWith('image/'),
            );
            if (imageItems.length === 0) return;
            const imageFiles = imageItems.map(item => {
                const file = item.getAsFile();
                if (!file) return null;
                // Give the pasted image a readable name with timestamp
                const ext = file.type.split('/')[1] ?? 'png';
                return new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type });
            }).filter(Boolean) as File[];
            if (imageFiles.length > 0) uploadFiles(imageFiles);
        };

        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedWorkspaceId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;

        const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
        setIsLoading(true);
        try {
            const newTask: Task = await addTask({
                title: title.trim(),
                description,
                priority,
                status,
                assigneeId,
                projectId: projectId || null,
                tags,
                commentsCount: 0,
                dueDate: dueDate || undefined,
                sprintId: sprintId || undefined,
            });

            const failures: string[] = [];

            await Promise.allSettled([
                ...subtasks.map(t =>
                    api.tasks.createSubtask(newTask.id, { title: t, status: 'todo', priority: 'medium' })
                        .catch(() => failures.push(`subtask "${t}"`))
                ),
                ...selectedDeps.map(depId =>
                    api.tasks.addDependency(newTask.id, depId)
                        .catch(() => failures.push('a dependency'))
                ),
                ...stagedWorkspaceFiles.map(({ id: workspaceFileId, name }) =>
                    authenticatedFetch(`/api/tasks/${newTask.id}/attachments/link`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workspace_file_id: workspaceFileId }),
                    }).then(r => { if (!r.ok) failures.push(`"${name}"`); })
                ),
            ]);

            const viewAction = { label: 'View Task', onClick: () => openModal('task-detail', { task: newTask }) };
            if (failures.length > 0) {
                addToast(`"${newTask.title}" created, but some steps failed: ${failures.join(', ')}`, 'warning', viewAction);
            } else {
                addToast(`"${newTask.title}" created!`, 'success', viewAction);
            }
            onClose();
        } catch {
            addToast('Failed to create task', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredTemplates = templates.filter(t =>
        t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
        t.title.toLowerCase().includes(templateSearch.toLowerCase())
    );

    const filteredDepTasks = tasks
        .filter(t => !selectedDeps.includes(t.id) && t.title.toLowerCase().includes(depSearch.toLowerCase()))
        .slice(0, 6);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(true);
        setExpandFiles(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        // Only clear when leaving the modal itself, not its children
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) await uploadFiles(files);
    };

    return (
        <div
            ref={modalRef}
            className={`w-full max-w-2xl mx-auto bg-surface-dark border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 transition-colors ${isDraggingOver ? 'border-primary ring-2 ring-primary/30' : 'border-border-dark'}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Header */}
            <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                <h2 className="text-xl font-bold text-white">Create New Task</h2>
                <div className="flex items-center gap-2">
                    {/* Template dropdown */}
                    <div className="relative" ref={templateDropdownRef}>
                        <button
                            type="button"
                            onClick={() => setShowTemplateDropdown(v => !v)}
                            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-border-dark text-text-secondary hover:text-white transition-all"
                            aria-label="Use a task template"
                        >
                            <span className="material-symbols-outlined text-[16px]">bookmark</span>
                            Use Template
                            <span className={`material-symbols-outlined text-[14px] transition-transform ${showTemplateDropdown ? 'rotate-180' : ''}`}>expand_more</span>
                        </button>

                        {showTemplateDropdown && (
                            <div className="absolute right-0 top-full mt-1 w-72 bg-surface-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                <div className="p-2 border-b border-border-dark">
                                    <input
                                        type="text"
                                        value={templateSearch}
                                        onChange={e => setTemplateSearch(e.target.value)}
                                        placeholder="Search templates..."
                                        autoFocus
                                        className="w-full bg-background-dark border border-border-dark rounded-lg text-white text-xs px-3 py-2 focus:ring-1 focus:ring-primary outline-none placeholder:text-text-secondary/50"
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto custom-scrollbar p-1">
                                    {!templatesLoaded ? (
                                        <div className="flex justify-center py-6">
                                            <div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                        </div>
                                    ) : filteredTemplates.length === 0 ? (
                                        <div className="text-center py-6 opacity-40">
                                            <span className="material-symbols-outlined text-2xl">description</span>
                                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1">
                                                {templates.length === 0 ? 'No templates yet' : 'No matches'}
                                            </p>
                                        </div>
                                    ) : (
                                        filteredTemplates.map(tmpl => (
                                            <button
                                                key={tmpl.id}
                                                type="button"
                                                onClick={() => { applyTemplate(tmpl); setShowTemplateDropdown(false); setTemplateSearch(''); }}
                                                className="cursor-pointer w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition-all group"
                                            >
                                                <p className="text-xs font-bold text-white truncate group-hover:text-primary transition-colors">{tmpl.name}</p>
                                                <p className="text-[10px] text-text-secondary truncate">{tmpl.title}</p>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white" aria-label="Close dialog">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* Title */}
                <div className="space-y-1.5">
                    <label htmlFor="new-task-title" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Task Title</label>
                    <input
                        id="new-task-title"
                        autoFocus type="text" value={title} onChange={e => setTitle(e.target.value)}
                        placeholder="e.g., Implement OAuth2 integration"
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-lg font-medium focus:ring-1 focus:ring-primary focus:border-primary px-4 py-3 transition-all placeholder:text-text-secondary/50 outline-none"
                    />
                </div>

                {/* Status + Assignee */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="new-task-status" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Status</label>
                        <select id="new-task-status" value={status} onChange={e => setStatus(e.target.value as Status)}
                            className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all outline-none">
                            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1.5 relative" ref={assigneeDropdownRef}>
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Assignee</label>
                        <button
                            type="button"
                            onClick={() => setShowAssigneeDropdown(p => !p)}
                            className="cursor-pointer w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-3 py-2.5 flex items-center gap-2 hover:border-white/20 transition-all"
                        >
                            {(() => { const u = users.find(u => u.id === assigneeId); return u ? (
                                <>
                                    <div className="relative inline-flex shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={u.avatar} className="size-5 rounded-full" alt="" />
                                        <span className="absolute -bottom-0.5 -right-0.5">
                                            <PresenceDot status={presenceFromMemberStatus(u.status)} size="sm" ring />
                                        </span>
                                    </div>
                                    <span className="truncate">{u.name}</span>
                                </>
                            ) : <span className="text-text-secondary">Unassigned</span>; })()}
                            <span className="material-symbols-outlined text-[16px] text-text-secondary ml-auto">unfold_more</span>
                        </button>
                        {showAssigneeDropdown && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-48 overflow-y-auto custom-scrollbar">
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

                {/* Project + Due Date */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label htmlFor="new-task-project" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Project</label>
                        <select id="new-task-project" value={projectId} onChange={e => setProjectId(e.target.value)}
                            className={`w-full bg-background-dark border-border-dark rounded-xl text-sm focus:ring-1 px-4 py-2.5 transition-all outline-none ${isLockedProject ? 'text-amber-400 focus:ring-amber-500 border-amber-500/40' : 'text-white focus:ring-primary'}`}>
                            {projects.map((p: Project) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}{p.quota_locked ? ' (Read-only)' : ''}
                                </option>
                            ))}
                        </select>
                        {isLockedProject && (
                            <p className="text-[11px] text-amber-400 flex items-center gap-1">
                                <span>⚠</span> This project is locked. Task creation is disabled.
                            </p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="new-task-due-date" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Due Date</label>
                        <input id="new-task-due-date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                            className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all [color-scheme:dark] outline-none" />
                    </div>
                </div>

                {/* Sprint */}
                {projectSprints.length > 0 && (
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Sprint</label>
                        <select value={sprintId} onChange={e => setSprintId(e.target.value)}
                            className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all outline-none">
                            <option value="">No sprint</option>
                            {projectSprints.map((s: Sprint) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}{s.status === 'active' ? ' (active)' : s.status === 'planning' ? ' (planning)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Priority */}
                <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Priority</label>
                    <div className="flex gap-2">
                        {(['low', 'medium', 'high', 'urgent'] as Priority[]).map(p => (
                            <button key={p} type="button" onClick={() => setPriority(p)}
                                aria-pressed={priority === p}
                                className={`cursor-pointer flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${priority === p ? 'bg-primary/20 border-primary text-primary' : 'bg-background-dark border-border-dark text-text-secondary hover:text-white'}`}>
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                    <label htmlFor="new-task-tags" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Tags</label>
                    <input id="new-task-tags" type="text" value={tagsInput} onChange={e => setTagsInput(e.target.value)}
                        placeholder="frontend, bug, api  (comma-separated)"
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all placeholder:text-text-secondary/50 outline-none" />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                    <label htmlFor="new-task-description" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Description</label>
                    <textarea id="new-task-description" rows={3} value={description} onChange={e => setDescription(e.target.value)}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-3 transition-all resize-none placeholder:text-text-secondary/50 outline-none"
                        placeholder="Describe the task details..." />
                </div>

                {/* ── Subtasks ── */}
                <div className="border-t border-white/5 pt-4 space-y-2">
                    <button type="button" onClick={() => setExpandSubtasks(v => !v)}
                        className="cursor-pointer flex items-center gap-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest w-full hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-[14px]">account_tree</span>
                        Subtasks
                        {subtasks.length > 0 && (
                            <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-[9px] font-black">{subtasks.length}</span>
                        )}
                        <span className={`material-symbols-outlined text-[14px] ml-auto transition-transform ${expandSubtasks ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>

                    {expandSubtasks && (
                        <div className="space-y-2">
                            {subtasks.map((s, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-background-dark border border-border-dark rounded-lg">
                                    <span className="material-symbols-outlined text-[14px] text-text-secondary">radio_button_unchecked</span>
                                    <span className="flex-1 text-sm text-white">{s}</span>
                                    <button type="button" onClick={() => setSubtasks(prev => prev.filter((_, j) => j !== i))}
                                        className="cursor-pointer text-text-secondary hover:text-red-400 transition-colors">
                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                    </button>
                                </div>
                            ))}
                            <div className="flex gap-2">
                                <input
                                    type="text" value={subtaskInput} onChange={e => setSubtaskInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                                    placeholder="Add subtask and press Enter…"
                                    className="flex-1 bg-background-dark border border-border-dark rounded-lg text-sm text-white px-3 py-2 focus:ring-1 focus:ring-primary outline-none placeholder:text-text-secondary/50"
                                />
                                <button type="button" onClick={addSubtask}
                                    className="cursor-pointer px-3 py-2 bg-white/5 border border-border-dark rounded-lg text-xs font-bold text-text-secondary hover:text-white transition-colors">
                                    Add
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Dependencies ── */}
                <div className="border-t border-white/5 pt-4 space-y-2">
                    <button type="button" onClick={() => setExpandDeps(v => !v)}
                        className="cursor-pointer flex items-center gap-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest w-full hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-[14px]">link</span>
                        Dependencies
                        {selectedDeps.length > 0 && (
                            <span className="bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded text-[9px] font-black">{selectedDeps.length}</span>
                        )}
                        <span className={`material-symbols-outlined text-[14px] ml-auto transition-transform ${expandDeps ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>

                    {expandDeps && (
                        <div className="space-y-2">
                            {selectedDeps.map(depId => {
                                const t = tasks.find(tk => tk.id === depId);
                                return t ? (
                                    <div key={depId} className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                                        <span className="material-symbols-outlined text-[14px] text-amber-400">block</span>
                                        <span className="flex-1 text-xs text-white truncate">{t.title}</span>
                                        <span className="text-[9px] text-text-secondary font-bold uppercase">{t.status}</span>
                                        <button type="button" onClick={() => setSelectedDeps(p => p.filter(id => id !== depId))}
                                            className="cursor-pointer text-text-secondary hover:text-red-400 transition-colors">
                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                        </button>
                                    </div>
                                ) : null;
                            })}
                            <input
                                type="text" value={depSearch} onChange={e => setDepSearch(e.target.value)}
                                placeholder="Search tasks to block on…"
                                className="w-full bg-background-dark border border-border-dark rounded-lg text-sm text-white px-3 py-2 focus:ring-1 focus:ring-primary outline-none placeholder:text-text-secondary/50"
                            />
                            {depSearch.trim() && filteredDepTasks.length > 0 && (
                                <div className="space-y-1">
                                    {filteredDepTasks.map(t => (
                                        <button key={t.id} type="button"
                                            onClick={() => { setSelectedDeps(p => [...p, t.id]); setDepSearch(''); }}
                                            className="cursor-pointer w-full text-left px-3 py-2 bg-background-dark border border-border-dark rounded-lg text-xs text-white hover:border-primary/40 transition-all flex items-center gap-2">
                                            <span className="flex-1 font-bold truncate">{t.title}</span>
                                            <span className="text-text-secondary text-[10px] uppercase shrink-0">{t.status}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {depSearch.trim() && filteredDepTasks.length === 0 && (
                                <p className="text-[11px] text-text-secondary text-center py-2 opacity-60">No tasks found</p>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Files ── */}
                <div className="border-t border-white/5 pt-4 space-y-2">
                    <button type="button" onClick={() => setExpandFiles(v => !v)}
                        className="cursor-pointer flex items-center gap-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest w-full hover:text-white transition-colors">
                        <span className="material-symbols-outlined text-[14px]">attachment</span>
                        Files
                        {(stagedWorkspaceFiles.length > 0 || uploadingCount > 0) && (
                            <span className="bg-white/10 text-text-secondary px-1.5 py-0.5 rounded text-[9px] font-black">{stagedWorkspaceFiles.length + uploadingCount}</span>
                        )}
                        <span className={`material-symbols-outlined text-[14px] ml-auto transition-transform ${expandFiles ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>

                    {expandFiles && (
                        <div className="space-y-2">
                            {stagedWorkspaceFiles.map((f, i) => (
                                <div key={f.id} className="flex items-center gap-2 px-3 py-2 bg-background-dark border border-border-dark rounded-lg">
                                    <span className="material-symbols-outlined text-[14px] text-text-secondary">attach_file</span>
                                    <span className="flex-1 text-xs text-white truncate">{f.name}</span>
                                    <button type="button" onClick={() => setStagedWorkspaceFiles(p => p.filter((_, j) => j !== i))}
                                        className="cursor-pointer text-text-secondary hover:text-red-400 transition-colors">
                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                    </button>
                                </div>
                            ))}
                            {uploadingCount > 0 && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-background-dark border border-border-dark rounded-lg opacity-60">
                                    <div className="size-3.5 border border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
                                    <span className="flex-1 text-xs text-text-secondary">Uploading {uploadingCount} file{uploadingCount > 1 ? 's' : ''}…</span>
                                </div>
                            )}
                            <button type="button" onClick={() => fileInputRef.current?.click()}
                                className={`cursor-pointer w-full py-4 border border-dashed rounded-lg text-xs transition-all flex flex-col items-center justify-center gap-1 ${isDraggingOver ? 'border-primary bg-primary/5 text-primary' : 'border-border-dark text-text-secondary hover:text-white hover:border-primary/40'}`}>
                                <span className="material-symbols-outlined text-[20px]">upload_file</span>
                                <span>Drop files here, paste a screenshot, or click to browse</span>
                            </button>
                        </div>
                    )}
                    <input ref={fileInputRef} type="file" multiple className="hidden"
                        onChange={handleFileChange}
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 pt-4 border-t border-white/5">
                    <button type="button" onClick={onClose} disabled={isLoading}
                        className="cursor-pointer px-6 py-2.5 text-text-secondary text-sm font-bold hover:text-white transition-colors">
                        Cancel
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleSaveAsTemplate}
                            disabled={isLoading || !title.trim() || isSavingTemplate}
                            className="cursor-pointer flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold bg-white/5 border border-border-dark text-text-secondary hover:text-white rounded-xl transition-all disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
                            {isSavingTemplate ? 'Saving…' : 'Save as Template'}
                        </button>
                        <button type="submit" disabled={isLoading || uploadingCount > 0 || !title.trim() || isLockedProject}
                            className="px-8 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50">
                            {isLoading ? 'Creating…' : uploadingCount > 0 ? 'Uploading…' : 'Create Task'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default NewTaskModal;
