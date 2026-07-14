'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Task, Status, User } from '@/types';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { SubtaskList } from '@/components/tasks/SubtaskList';
import { TimeTracker } from '@/components/tasks/TimeTracker';
import { TaskDependencies } from '@/components/tasks/TaskDependencies';
import { TaskAttachments } from '@/components/tasks/TaskAttachments';
import { AISuggestionPanel } from '@/components/tasks/AISuggestionPanel';
import { api } from '@/lib/api';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getTaskDisplayKey } from '@/lib/tasks/taskKey';
import { buildTaskDeepLink } from '@/lib/tasks/taskDeepLink';
import { useTaskDeepLinkUrlSync } from '@/hooks/useTaskDeepLinkUrlSync';

function copyText(text: string): Promise<boolean> {
    if (!text) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
    );
}

type Priority = 'urgent' | 'high' | 'medium' | 'low';
type DetailTab = 'activity' | 'subtasks' | 'time' | 'dependencies' | 'attachments';

const SYSTEM_ACTIVITY_TYPES = new Set([
    'system',
    'status_change',
    'assignment',
    'create',
]);

function isSystemActivity(type: string): boolean {
    return SYSTEM_ACTIVITY_TYPES.has(type);
}

interface TaskActivityRecord {
    id: string;
    user_id: string;
    is_own: boolean;
    content: string;
    created_at: string;
    type: string;
    profiles?: { id?: string; full_name?: string; avatar_url?: string };
}

interface ActivityItem {
    id: string;
    userId: string;
    isOwn: boolean;
    author: string;
    avatar: string;
    content: string;
    time: string;
    type: string;
}

export interface TaskDetailModalProps {
    onClose: () => void;
    task: Task;
    readOnly?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
    backlog: 'bg-slate-400',
    todo: 'bg-blue-400',
    'in-progress': 'bg-primary',
    review: 'bg-purple-500',
    done: 'bg-emerald-500',
};

const PRIORITY_COLOR: Record<string, string> = {
    low: 'text-slate-400',
    medium: 'text-blue-400',
    high: 'text-orange-400',
    urgent: 'text-red-400',
};

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ onClose, task, readOnly = false }) => {
    const { addToast, openModal } = useUIContext();
    const { updateTask, deleteTask, duplicateTask, getTaskActivities, addTaskActivity, updateTaskActivity, deleteTaskActivity, users, currentUser, tasks, projects, selectedWorkspaceId } = useAppContext();

    const currentTask = tasks.find(t => t.id === task.id) || task;
    const isPluginTask = currentTask.source === 'plugin';
    const modalRef = useRef<HTMLDivElement>(null);
    const { clearOpenParam } = useTaskDeepLinkUrlSync(
        currentTask.id,
        currentTask.projectId,
    );

    const closeWithUrlCleanup = useCallback(() => {
        clearOpenParam();
        onClose();
    }, [clearOpenParam, onClose]);

    const handleCopyLink = useCallback(async () => {
        const url = buildTaskDeepLink(currentTask.id, currentTask.projectId, {
            absolute: true,
        });
        const ok = await copyText(url);
        addToast(
            ok ? 'Task link copied.' : 'Could not copy to clipboard.',
            ok ? 'success' : 'warning',
        );
    }, [addToast, currentTask.id, currentTask.projectId]);

    const [activeTab, setActiveTab] = useState<DetailTab>('activity');
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(true);
    const [commentText, setCommentText] = useState('');
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [editingCommentText, setEditingCommentText] = useState('');
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const [showPriorityMenu, setShowPriorityMenu] = useState(false);
    const [showAssigneeMenu, setShowAssigneeMenu] = useState(false);
    const [showProjectMenu, setShowProjectMenu] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showAI, setShowAI] = useState(false);
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const [subtaskRefreshToken, setSubtaskRefreshToken] = useState(0);
    const [pendingImage, setPendingImage] = useState<File | null>(null);
    const [pendingImagePreviewUrl, setPendingImagePreviewUrl] = useState<string | null>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    useEffect(() => {
        return () => { if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl); };
    }, [pendingImagePreviewUrl]);

    // Inline editing state
    const [editingTitle, setEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState(currentTask.title);
    const [editingDesc, setEditingDesc] = useState(false);
    const [editDesc, setEditDesc] = useState(currentTask.description || '');
    const [editingEstimate, setEditingEstimate] = useState(false);
    const [editEstimate, setEditEstimate] = useState(String(currentTask.estimatedHours || ''));

    const statusRef = useRef<HTMLDivElement>(null);
    const priorityRef = useRef<HTMLDivElement>(null);
    const assigneeRef = useRef<HTMLDivElement>(null);
    const projectRef = useRef<HTMLDivElement>(null);

    const handleCloseRequest = useCallback(() => {
        if (editingDesc && editDesc !== (currentTask.description || '')) {
            setShowDiscardDialog(true);
        } else {
            closeWithUrlCleanup();
        }
    }, [editingDesc, editDesc, currentTask.description, closeWithUrlCleanup]);

    useClickOutside(modalRef, handleCloseRequest);
    useClickOutside(statusRef, () => setShowStatusMenu(false));
    useClickOutside(priorityRef, () => setShowPriorityMenu(false));
    useClickOutside(assigneeRef, () => setShowAssigneeMenu(false));
    useClickOutside(projectRef, () => setShowProjectMenu(false));

    const fetchActivities = useCallback(async () => {
        setIsLoadingActivities(true);
        const data = await getTaskActivities(task.id);
        setActivities(data.map(raw => {
            const a = raw as unknown as TaskActivityRecord;
            return {
                id: a.id,
                userId: a.user_id,
                isOwn: a.is_own === true,
                author: a.profiles?.full_name || 'System',
                avatar: a.profiles?.avatar_url || `https://ui-avatars.com/api/?name=${a.profiles?.full_name || 'S'}&background=random`,
                content: a.content,
                time: new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                type: a.type,
            };
        }));
        setIsLoadingActivities(false);
    }, [task.id, getTaskActivities]);

    const refreshAfterTaskUpdate = useCallback(async () => {
        await fetchActivities();
    }, [fetchActivities]);

    useEffect(() => { fetchActivities(); }, [fetchActivities]);

    const assignee = users.find(u => u.id === currentTask.assigneeId);

    const handleSaveTitle = async () => {
        const trimmed = editTitle.trim();
        if (!trimmed || trimmed === currentTask.title) { setEditingTitle(false); return; }
        await updateTask(task.id, { title: trimmed });
        setEditingTitle(false);
        addToast('Title updated', 'success');
    };

    const handleSaveDesc = async () => {
        if (editDesc === (currentTask.description || '')) { setEditingDesc(false); return; }
        await updateTask(task.id, { description: editDesc });
        setEditingDesc(false);
        addToast('Description updated', 'success');
    };

    const handleSaveEstimate = async () => {
        const hours = parseFloat(editEstimate);
        if (!isNaN(hours) && hours !== currentTask.estimatedHours) {
            await updateTask(task.id, { estimatedHours: hours });
            addToast('Estimate updated', 'success');
        }
        setEditingEstimate(false);
    };

    const handleClearPendingImage = () => {
        if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
        setPendingImage(null);
        setPendingImagePreviewUrl(null);
    };

    const handleCommentPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const imageItem = Array.from(e.clipboardData.items).find(
            item => item.kind === 'file' && item.type.startsWith('image/')
        );
        if (!imageItem) return;
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        const ext = file.type.split('/')[1] ?? 'png';
        const namedFile = new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type });
        if (pendingImagePreviewUrl) URL.revokeObjectURL(pendingImagePreviewUrl);
        setPendingImage(namedFile);
        setPendingImagePreviewUrl(URL.createObjectURL(namedFile));
    };

    const handleAddComment = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (pendingImage) {
            setIsUploadingImage(true);
            try {
                const formData = new FormData();
                formData.append('file', pendingImage);
                const res = await authenticatedFetch(`/api/tasks/${task.id}/activities/upload-image`, {
                    method: 'POST',
                    body: formData,
                });
                if (!res.ok) throw new Error('Upload failed');
                const { url: imageUrl } = await res.json() as { url: string };
                const content = JSON.stringify({ text: commentText.trim(), imageUrl });
                const result = await addTaskActivity(task.id, content, 'comment_image') as { id: string };
                setActivities(prev => [{
                    id: result.id, userId: currentUser.id, isOwn: true, author: currentUser.name,
                    avatar: currentUser.avatar, content, time: 'Just now', type: 'comment_image',
                }, ...prev]);
                setCommentText('');
                handleClearPendingImage();
                addToast('Image posted', 'success');
            } catch { addToast('Failed to upload image', 'error'); }
            finally { setIsUploadingImage(false); }
            return;
        }

        if (!commentText.trim()) return;
        try {
            const result = await addTaskActivity(task.id, commentText) as { id: string };
            setActivities(prev => [{
                id: result.id, userId: currentUser.id, isOwn: true, author: currentUser.name, avatar: currentUser.avatar,
                content: commentText, time: 'Just now', type: 'comment',
            }, ...prev]);
            setCommentText('');
            addToast('Comment added', 'success');
        } catch { addToast('Failed to add comment', 'error'); }
    };

    const handleDeleteComment = async (activityId: string) => {
        try {
            await deleteTaskActivity(task.id, activityId);
            setActivities(prev => prev.filter(a => a.id !== activityId));
            addToast('Comment deleted', 'success');
        } catch { addToast('Failed to delete comment', 'error'); }
    };

    const handleStartEditComment = (activityId: string, currentContent: string) => {
        setEditingCommentId(activityId);
        setEditingCommentText(currentContent);
    };

    const handleSaveEditComment = async (activityId: string) => {
        const trimmed = editingCommentText.trim();
        if (!trimmed) return;
        try {
            await updateTaskActivity(task.id, activityId, trimmed);
            setActivities(prev => prev.map(a => a.id === activityId ? { ...a, content: trimmed } : a));
            setEditingCommentId(null);
            addToast('Comment updated', 'success');
        } catch { addToast('Failed to update comment', 'error'); }
    };

    const handleDelete = async () => {
        if (isPluginTask) {
            addToast('Synced tasks cannot be deleted in OneWork. Remove them in the source tool.', 'warning');
            return;
        }
        if (!isDeleting) { setIsDeleting(true); setTimeout(() => setIsDeleting(false), 3000); return; }
        try {
            await deleteTask(task.id);
            addToast('Task deleted', 'success');
            closeWithUrlCleanup();
        } catch (err) {
            addToast(err instanceof Error ? err.message : 'Failed to delete task', 'error');
            setIsDeleting(false);
        }
    };

    const handleAcceptAiSubtasks = async (titles: string[]) => {
        const toCreate = titles.map((t) => t.trim()).filter(Boolean);
        if (!toCreate.length) return;
        if (!selectedWorkspaceId) {
            addToast('No workspace selected', 'warning');
            throw new Error('No workspace');
        }
        for (const title of toCreate) {
            await api.tasks.createSubtask(task.id, {
                title,
                status: 'todo',
                priority: currentTask.priority,
                workspace_id: selectedWorkspaceId,
                parent_task_id: task.id,
                assignee_id: currentUser.id,
                tags: [],
            });
        }
        setSubtaskRefreshToken((t) => t + 1);
        setActiveTab('subtasks');
    };

    const handleSaveAsTemplate = async () => {
        if (!selectedWorkspaceId) return;
        try {
            await api.taskTemplates.create({
                workspace_id: selectedWorkspaceId,
                name: currentTask.title,
                title: currentTask.title,
                description: currentTask.description,
                priority: currentTask.priority,
                tags: currentTask.tags,
                ...(currentTask.assigneeId && { default_assignee_id: currentTask.assigneeId }),
            });
            addToast('Saved as template', 'success');
        } catch { addToast('Failed to save template', 'error'); }
    };

    const TABS: { id: DetailTab; label: string; icon: string }[] = [
        { id: 'activity', label: 'Activity', icon: 'history' },
        { id: 'subtasks', label: 'Subtasks', icon: 'account_tree' },
        { id: 'time', label: 'Time', icon: 'schedule' },
        { id: 'dependencies', label: 'Deps', icon: 'link' },
        { id: 'attachments', label: 'Files', icon: 'attachment' },
    ];

    return (
        <div ref={modalRef} className="relative w-full max-w-5xl mx-auto bg-background-dark border border-border-dark rounded-2xl shadow-2xl flex flex-col md:flex-row h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">

            {/* Left: main content */}
            <div className="flex-1 flex flex-col min-w-0 bg-background-dark">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-surface-dark/30 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-text-secondary font-mono text-xs">{getTaskDisplayKey(currentTask)}</span>
                        <div className="h-4 w-px bg-border-dark" />
                        <span className={`size-2 rounded-full ${STATUS_COLOR[currentTask.status]}`} />
                        <span className="text-main text-xs font-bold capitalize">{currentTask.status.replace('-', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleCopyLink()}
                            className="cursor-pointer text-text-secondary hover:text-main transition-colors"
                            title="Copy task link"
                        >
                            <span className="material-symbols-outlined">link</span>
                        </button>
                        {!readOnly && (
                            <button
                                type="button"
                                onClick={() => setShowAI(v => !v)}
                                className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                    showAI
                                        ? 'border-violet-500/40 bg-surface-dark text-main'
                                        : 'border-border-dark bg-surface-highlight text-text-secondary hover:border-violet-500/30 hover:text-main'
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined text-[16px] bg-gradient-to-br from-violet-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent icon-filled"
                                >
                                    auto_awesome
                                </span>
                                <span className="bg-gradient-to-r from-violet-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent">
                                    AI
                                </span>
                            </button>
                        )}
                        <button onClick={handleCloseRequest} className="cursor-pointer text-text-secondary hover:text-main transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                {/* Title + Description */}
                <div className="px-8 pt-6 pb-4 shrink-0">
                    {editingTitle && !readOnly ? (
                        <input
                            autoFocus
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') { setEditTitle(currentTask.title); setEditingTitle(false); } }}
                            className="w-full bg-background-dark border border-primary/40 rounded-xl text-2xl font-black text-main px-3 py-2 outline-none focus:ring-1 focus:ring-primary mb-4"
                        />
                    ) : (
                        <h2
                            onClick={readOnly ? undefined : () => { setEditTitle(currentTask.title); setEditingTitle(true); }}
                            className={`text-2xl font-black text-main tracking-tight mb-4 transition-colors leading-tight ${!readOnly ? 'cursor-text hover:text-primary' : ''}`}
                        >
                            {currentTask.title}
                        </h2>
                    )}

                    {editingDesc && !readOnly ? (
                        <>
                            <textarea
                                autoFocus
                                value={editDesc}
                                onChange={e => setEditDesc(e.target.value)}
                                onBlur={handleSaveDesc}
                                onKeyDown={e => { if (e.key === 'Escape') { setEditDesc(currentTask.description || ''); setEditingDesc(false); } }}
                                rows={4}
                                className="w-full bg-background-dark border border-primary/40 rounded-xl text-sm text-main px-3 py-2 outline-none focus:ring-1 focus:ring-primary resize-none"
                            />
                            <div className="flex gap-2 mt-2">
                                <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={handleSaveDesc}
                                    className="cursor-pointer px-3 py-1 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-all flex items-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-[14px]">check</span> Save
                                </button>
                                <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => { setEditDesc(currentTask.description || ''); setEditingDesc(false); }}
                                    className="cursor-pointer px-3 py-1 bg-surface-highlight border border-border-dark text-text-secondary text-xs font-bold rounded-lg hover:bg-surface-highlight transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </>
                    ) : (
                        <p
                            onClick={readOnly ? undefined : () => { setEditDesc(currentTask.description || ''); setEditingDesc(true); }}
                            className={`text-text-secondary text-sm leading-relaxed transition-colors min-h-[2rem] ${!readOnly ? 'cursor-text hover:text-main' : ''}`}
                        >
                            {currentTask.description || <span className="italic opacity-50">Click to add description...</span>}
                        </p>
                    )}
                </div>

                {/* AI Panel (collapsible) */}
                {showAI && (
                    <div className="px-8 pb-4 shrink-0">
                        <AISuggestionPanel
                            task={currentTask}
                            onAcceptTitle={async (t) => {
                                setEditTitle(t);
                                await updateTask(task.id, { title: t });
                            }}
                            onAcceptDescription={async (d) => {
                                setEditDesc(d);
                                await updateTask(task.id, { description: d });
                            }}
                            onAcceptTags={async (tags) => {
                                await updateTask(task.id, { tags });
                            }}
                            onAcceptSubtasks={handleAcceptAiSubtasks}
                            onAcceptEstimate={async (h) => {
                                setEditEstimate(String(h));
                                await updateTask(task.id, { estimatedHours: h });
                            }}
                        />
                    </div>
                )}

                {/* Tabs */}
                <div className="px-8 flex gap-1 border-b border-border-dark shrink-0">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`cursor-pointer px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all -mb-px ${activeTab === tab.id ? 'text-main border-primary' : 'text-text-secondary border-transparent hover:text-main'}`}
                        >
                            <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {activeTab === 'activity' && (
                        <div className="p-8 space-y-4">
                            {isLoadingActivities ? (
                                <div className="flex flex-col items-center py-10 gap-3">
                                    <div className="size-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                                    <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Loading...</p>
                                </div>
                            ) : activities.length > 0 ? (
                                activities.map(a => (
                                    <div key={a.id} className="flex gap-4 animate-in slide-in-from-left-2 duration-300">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img className="size-8 rounded-full border border-border-dark shrink-0 mt-1" src={a.avatar} alt={a.author} />
                                        <div className={`flex-1 rounded-xl p-4 ${isSystemActivity(a.type) ? 'bg-surface-dark/50 border border-border-dark/60' : 'bg-surface-dark border border-border-dark'}`}>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-sm font-bold text-main">{a.author}</span>
                                                <div className="flex items-center gap-1">
                                                    {isSystemActivity(a.type) && (
                                                        <span className="text-[9px] font-bold uppercase tracking-wider text-text-secondary bg-surface-highlight px-1.5 py-0.5 rounded">System</span>
                                                    )}
                                                    <span className="text-[10px] text-text-secondary">{a.time}</span>
                                                                    {a.isOwn && editingCommentId !== a.id && (a.type === 'comment' || a.type === 'comment_image') && (
                                                        <div className="flex items-center gap-0.5 ml-1">
                                                            {a.type === 'comment' && (
                                                                <button
                                                                    onClick={() => handleStartEditComment(a.id, a.content)}
                                                                    className="cursor-pointer p-1 rounded text-text-secondary hover:text-main hover:bg-surface-highlight transition-colors"
                                                                    title="Edit comment"
                                                                >
                                                                    <span className="material-symbols-outlined text-[13px]">edit</span>
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleDeleteComment(a.id)}
                                                                className="cursor-pointer p-1 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                                                title="Delete"
                                                            >
                                                                <span className="material-symbols-outlined text-[13px]">delete</span>
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {editingCommentId === a.id ? (
                                                <div className="space-y-2">
                                                    <textarea
                                                        autoFocus
                                                        value={editingCommentText}
                                                        onChange={e => setEditingCommentText(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEditComment(a.id); if (e.key === 'Escape') setEditingCommentId(null); }}
                                                        className="w-full bg-background-dark border border-primary/50 rounded-lg p-2 text-sm text-main resize-none focus:outline-none focus:border-primary"
                                                        rows={3}
                                                    />
                                                    <div className="flex gap-2 justify-end">
                                                        <button onClick={() => setEditingCommentId(null)} className="cursor-pointer px-3 py-1 text-xs text-text-secondary hover:text-main transition-colors">Cancel</button>
                                                        <button onClick={() => handleSaveEditComment(a.id)} className="cursor-pointer px-3 py-1 text-xs bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors">Save</button>
                                                    </div>
                                                </div>
                                            ) : a.type === 'comment_image' ? (() => {
                                                const img = (() => { try { return JSON.parse(a.content) as { text?: string; imageUrl: string }; } catch { return { imageUrl: a.content, text: '' }; } })();
                                                return (
                                                    <div className="mt-1 space-y-2">
                                                        {img.text && <p className="text-sm text-main whitespace-pre-wrap leading-relaxed">{img.text}</p>}
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={img.imageUrl}
                                                            alt="Comment image"
                                                            className="w-full max-h-64 object-contain rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
                                                            onClick={() => openModal('image-lightbox', { url: img.imageUrl })}
                                                        />
                                                    </div>
                                                );
                                            })() : (
                                                <p className="text-sm text-main whitespace-pre-wrap leading-relaxed">{a.content}</p>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-10 opacity-20 flex flex-col items-center gap-2">
                                    <span className="material-symbols-outlined text-4xl">history</span>
                                    <p className="text-xs font-bold uppercase tracking-widest">No activity yet</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'subtasks' && (
                        <div className="p-8">
                            <SubtaskList
                                parentTask={currentTask}
                                readOnly={readOnly}
                                refreshToken={subtaskRefreshToken}
                                onSubtaskCountChange={(total, done) =>
                                    updateTask(task.id, { subtaskCount: total, subtaskDoneCount: done })
                                }
                            />
                        </div>
                    )}

                    {activeTab === 'time' && (
                        <div className="p-8">
                            <TimeTracker task={currentTask} readOnly={readOnly} />
                        </div>
                    )}

                    {activeTab === 'dependencies' && (
                        <div className="p-8">
                            <TaskDependencies task={currentTask} allTasks={tasks.filter(t => t.id !== task.id)} readOnly={readOnly} />
                        </div>
                    )}

                    {activeTab === 'attachments' && (
                        <div className="p-8">
                            <TaskAttachments task={currentTask} readOnly={readOnly} />
                        </div>
                    )}
                </div>

                {/* Comment input (only on activity tab) */}
                {activeTab === 'activity' && !readOnly && (
                    <div className="p-4 bg-surface-dark/50 border-t border-border-dark shrink-0">
                        {pendingImage && pendingImagePreviewUrl && (
                            <div className="mb-2 relative inline-block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={pendingImagePreviewUrl} alt="Pending" className="h-20 w-auto rounded-lg object-cover border border-border-dark" />
                                {isUploadingImage ? (
                                    <div className="absolute inset-0 bg-black/60 rounded-lg flex items-center justify-center gap-2">
                                        <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span className="text-[11px] font-bold text-white">Uploading...</span>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleClearPendingImage}
                                        className="cursor-pointer absolute -top-1.5 -right-1.5 size-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                                        aria-label="Remove image"
                                    >
                                        <span className="material-symbols-outlined text-[12px]">close</span>
                                    </button>
                                )}
                            </div>
                        )}
                        <form onSubmit={handleAddComment} className="flex items-center gap-3 bg-background-dark border border-border-dark rounded-xl p-1.5 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
                            <input
                                type="text"
                                value={commentText}
                                onChange={e => setCommentText(e.target.value)}
                                onPaste={handleCommentPaste}
                                placeholder={pendingImage ? 'Image ready — press send to post' : 'Add a comment or paste an image...'}
                                className="flex-1 bg-transparent border-0 text-sm text-main focus:ring-0 px-3 py-1.5 outline-none placeholder:text-text-secondary"
                            />
                            {pendingImage && (
                                <span className="material-symbols-outlined text-[16px] text-primary shrink-0">image</span>
                            )}
                            <button
                                type="submit"
                                disabled={(!commentText.trim() && !pendingImage) || isUploadingImage}
                                className="cursor-pointer size-9 bg-primary text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition-all disabled:opacity-50"
                            >
                                {isUploadingImage
                                    ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    : <span className="material-symbols-outlined text-[18px]">send</span>
                                }
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* Discard changes confirmation dialog */}
            {showDiscardDialog && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 rounded-2xl">
                    <div className="bg-background-dark border border-border-dark rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-150">
                        <h3 className="text-main font-bold text-base mb-2">Unsaved Changes</h3>
                        <p className="text-text-secondary text-sm mb-6">You have unsaved changes to the description. What would you like to do?</p>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={async () => { setShowDiscardDialog(false); await handleSaveDesc(); closeWithUrlCleanup(); }}
                                className="cursor-pointer w-full py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-blue-600 transition-all"
                            >
                                Save Changes
                            </button>
                            <button
                                onClick={() => { setShowDiscardDialog(false); closeWithUrlCleanup(); }}
                                className="cursor-pointer w-full py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold rounded-lg hover:bg-red-500/20 transition-all"
                            >
                                Discard Changes
                            </button>
                            <button
                                onClick={() => setShowDiscardDialog(false)}
                                className="cursor-pointer w-full py-2 bg-surface-highlight border border-border-dark text-text-secondary text-sm font-bold rounded-lg hover:bg-surface-highlight transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Right: properties + actions */}
            <div className="w-72 border-l border-border-dark bg-surface-dark p-5 flex flex-col gap-6 shrink-0 overflow-y-auto custom-scrollbar">
                {/* Properties */}
                <div>
                    <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-4">Properties</h4>
                    <div className="space-y-4">

                        {/* Status */}
                        <div className="flex flex-col gap-1.5 relative" ref={statusRef}>
                            <span className="text-[10px] font-medium text-text-secondary">Status</span>
                            <button disabled={readOnly} onClick={() => setShowStatusMenu(!showStatusMenu)} className={`flex items-center gap-2 bg-background-dark border border-border-dark px-3 py-2 rounded-lg hover:border-border-dark transition-all group ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                <span className={`size-2 rounded-full ${STATUS_COLOR[currentTask.status]}`} />
                                <span className="text-xs font-bold text-main capitalize flex-1 text-left">{currentTask.status.replace('-', ' ')}</span>
                                <span className="material-symbols-outlined text-[16px] text-text-secondary group-hover:text-main">unfold_more</span>
                            </button>
                            {showStatusMenu && !readOnly && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                    {(['backlog', 'todo', 'in-progress', 'review', 'done'] as Status[]).map(s => (
                                        <button key={s} onClick={async () => {
                                            await updateTask(task.id, { status: s });
                                            setShowStatusMenu(false);
                                            addToast(`Status → ${s}`, 'success');
                                            await refreshAfterTaskUpdate();
                                        }}
                                            className="cursor-pointer w-full px-4 py-2 text-left text-xs font-bold text-main hover:bg-surface-highlight flex items-center gap-3 capitalize">
                                            <span className={`size-1.5 rounded-full ${STATUS_COLOR[s]}`} />{s.replace('-', ' ')}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Priority */}
                        <div className="flex flex-col gap-1.5 relative" ref={priorityRef}>
                            <span className="text-[10px] font-medium text-text-secondary">Priority</span>
                            <button disabled={readOnly} onClick={() => setShowPriorityMenu(!showPriorityMenu)} className={`flex items-center gap-2 bg-background-dark border border-border-dark px-3 py-2 rounded-lg hover:border-border-dark transition-all group ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                <span className={`text-xs font-bold capitalize flex-1 text-left ${PRIORITY_COLOR[currentTask.priority]}`}>{currentTask.priority}</span>
                                <span className="material-symbols-outlined text-[16px] text-text-secondary group-hover:text-main">unfold_more</span>
                            </button>
                            {showPriorityMenu && !readOnly && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                    {(['low', 'medium', 'high', 'urgent'] as Priority[]).map(p => (
                                        <button key={p} onClick={() => { updateTask(task.id, { priority: p }); setShowPriorityMenu(false); addToast(`Priority → ${p}`, 'success'); }}
                                            className={`cursor-pointer w-full px-4 py-2 text-left text-xs font-bold hover:bg-surface-highlight capitalize ${PRIORITY_COLOR[p]}`}>
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Project */}
                        <div className="flex flex-col gap-1.5 relative" ref={projectRef}>
                            <span className="text-[10px] font-medium text-text-secondary">Project</span>
                            <button
                                disabled={readOnly}
                                onClick={() => setShowProjectMenu(!showProjectMenu)}
                                className={`flex items-center gap-2 bg-background-dark border border-border-dark px-3 py-2 rounded-lg hover:border-border-dark transition-all group ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                                <span className="text-xs font-bold text-main truncate flex-1 text-left">
                                    {projects.find(p => p.id === currentTask.projectId)?.name ?? 'No project'}
                                </span>
                                <span className="material-symbols-outlined text-[16px] text-text-secondary group-hover:text-main">unfold_more</span>
                            </button>
                            {showProjectMenu && !readOnly && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-48 overflow-y-auto custom-scrollbar">
                                    <button
                                        onClick={async () => {
                                            try {
                                                await updateTask(task.id, { projectId: null });
                                                setShowProjectMenu(false);
                                                addToast('Moved to workspace tasks', 'success');
                                                await refreshAfterTaskUpdate();
                                            } catch {
                                                addToast('Failed to move task', 'error');
                                            }
                                        }}
                                        className="cursor-pointer w-full px-4 py-2 text-left text-xs font-bold text-main hover:bg-surface-highlight"
                                    >
                                        No project
                                    </button>
                                    {projects.map((p) => (
                                        <button
                                            key={p.id}
                                            onClick={async () => {
                                                if (p.id === currentTask.projectId) {
                                                    setShowProjectMenu(false);
                                                    return;
                                                }
                                                try {
                                                    const updated = await updateTask(task.id, { projectId: p.id });
                                                    setShowProjectMenu(false);
                                                    if (isPluginTask) {
                                                        addToast('Task key updated locally; external sync unchanged.', 'info');
                                                    } else if (updated?.taskKey) {
                                                        addToast(`Moved to ${updated.taskKey}`, 'success');
                                                    } else {
                                                        addToast(`Moved to ${p.name}`, 'success');
                                                    }
                                                    await refreshAfterTaskUpdate();
                                                } catch {
                                                    addToast('Failed to move task', 'error');
                                                }
                                            }}
                                            className="cursor-pointer w-full px-4 py-2 text-left text-xs font-bold text-main hover:bg-surface-highlight truncate"
                                        >
                                            {p.name}{p.key ? ` (${p.key})` : ''}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Due Date */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-medium text-text-secondary">Due Date</span>
                            <input
                                type="date" defaultValue={currentTask.dueDate || ''}
                                onChange={e => updateTask(currentTask.id, { dueDate: e.target.value || undefined })}
                                disabled={readOnly}
                                className={`bg-background-dark border border-border-dark px-3 py-2 rounded-lg text-xs font-bold text-main hover:border-border-dark transition-all focus:ring-1 focus:ring-primary light:[color-scheme:light] dark:[color-scheme:dark] outline-none ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                            />
                        </div>

                        {/* Assignee */}
                        <div className="flex flex-col gap-1.5 relative" ref={assigneeRef}>
                            <span className="text-[10px] font-medium text-text-secondary">Assignee</span>
                            <button disabled={readOnly} onClick={() => setShowAssigneeMenu(!showAssigneeMenu)} className={`flex items-center gap-3 bg-background-dark border border-border-dark px-3 py-2 rounded-lg hover:border-border-dark transition-all group ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                <div className="relative inline-flex shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img className="size-5 rounded-full border border-border-dark" src={assignee?.avatar || `https://ui-avatars.com/api/?name=?&background=random`} alt="" />
                                    {assignee && (
                                        <span className="absolute -bottom-0.5 -right-0.5">
                                            <PresenceDot status={presenceFromMemberStatus(assignee.status)} size="sm" ring />
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs font-bold text-main truncate flex-1 text-left">{assignee?.name || 'Unassigned'}</span>
                                <span className="material-symbols-outlined text-[16px] text-text-secondary group-hover:text-main">unfold_more</span>
                            </button>
                            {showAssigneeMenu && !readOnly && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-48 overflow-y-auto custom-scrollbar">
                                    {users.map((u: User) => (
                                        <button key={u.id} onClick={() => { updateTask(task.id, { assigneeId: u.id }); setShowAssigneeMenu(false); addToast(`Assigned to ${u.name}`, 'success'); }}
                                            className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-main hover:bg-surface-highlight flex items-center gap-3">
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

                        {/* Estimated Hours */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-medium text-text-secondary">Estimated Hours</span>
                            {editingEstimate && !readOnly ? (
                                <input
                                    autoFocus type="number" min="0" step="0.5" value={editEstimate}
                                    onChange={e => setEditEstimate(e.target.value)}
                                    onBlur={handleSaveEstimate}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEstimate(); if (e.key === 'Escape') setEditingEstimate(false); }}
                                    className="bg-background-dark border border-primary/40 px-3 py-2 rounded-lg text-xs font-bold text-main outline-none focus:ring-1 focus:ring-primary"
                                />
                            ) : (
                                <button disabled={readOnly} onClick={readOnly ? undefined : () => setEditingEstimate(true)}
                                    className={`flex items-center gap-2 bg-background-dark border border-border-dark px-3 py-2 rounded-lg hover:border-border-dark transition-all text-left ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                    <span className="material-symbols-outlined text-[16px] text-text-secondary">schedule</span>
                                    <span className="text-xs font-bold text-main">{currentTask.estimatedHours ? `${currentTask.estimatedHours}h` : 'Not set'}</span>
                                </button>
                            )}
                        </div>

                        {/* Tags */}
                        {currentTask.tags && currentTask.tags.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-medium text-text-secondary">Tags</span>
                                <div className="flex flex-wrap gap-1">
                                    {currentTask.tags.map(tag => (
                                        <span key={tag} className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-bold text-primary uppercase">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                {!readOnly && (
                    <div>
                        <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-4">Actions</h4>
                        <div className="grid grid-cols-1 gap-2">
                            <button onClick={() => duplicateTask(task.id).then(() => { addToast('Task duplicated', 'success'); closeWithUrlCleanup(); }).catch(() => addToast('Failed', 'error'))}
                                className="cursor-pointer w-full py-2 bg-surface-highlight border border-border-dark rounded-lg text-xs font-bold text-main hover:bg-surface-highlight transition-all flex items-center justify-center gap-2 group active:scale-95">
                                <span className="material-symbols-outlined text-[18px] group-hover:text-primary">content_copy</span> Duplicate
                            </button>
                            <button onClick={handleSaveAsTemplate}
                                className="cursor-pointer w-full py-2 bg-surface-highlight border border-border-dark rounded-lg text-xs font-bold text-main hover:bg-surface-highlight transition-all flex items-center justify-center gap-2 group active:scale-95">
                                <span className="material-symbols-outlined text-[18px] group-hover:text-primary">bookmark_add</span> Save as Template
                            </button>
                            <div className="h-px bg-border-dark my-1" />
                            {isPluginTask ? (
                                <p className="text-[11px] text-text-secondary leading-relaxed px-1">
                                    This task is synced from an external tool and cannot be deleted here. Remove it in{' '}
                                    {currentTask.sourceProvider === 'jira'
                                        ? 'Jira'
                                        : currentTask.sourceProvider === 'clickup'
                                          ? 'ClickUp'
                                          : currentTask.sourceProvider === 'asana'
                                            ? 'Asana'
                                            : currentTask.sourceProvider === 'trello'
                                              ? 'Trello'
                                              : 'the source app'}
                                    .
                                </p>
                            ) : (
                                <button onClick={handleDelete}
                                    className={`w-full py-2 border rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95 ${isDeleting ? 'bg-red-500 border-red-600 text-white animate-pulse' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'} cursor-pointer`}>
                                    <span className="material-symbols-outlined text-[18px]">{isDeleting ? 'warning' : 'delete'}</span>
                                    {isDeleting ? 'Click again to confirm' : 'Delete Task'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TaskDetailModal;
