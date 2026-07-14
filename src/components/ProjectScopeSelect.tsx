'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Project } from '@/types';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useProjectLock } from '@/hooks/useProjectLock';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { useCreateProjectGuard } from '@/hooks/useCreateProjectGuard';

interface ProjectScopeSelectProps {
    projects: Project[];
    selectedProjectId: string | null;
    onChange: (projectId: string) => void;
    label?: string;
    className?: string;
}

const ProjectScopeSelect: React.FC<ProjectScopeSelectProps> = ({
    projects,
    selectedProjectId,
    onChange,
    label = 'Project',
    className = '',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement | null>(null);
    const router = useRouter();
    const openCreateProject = useCreateProjectGuard();
    const { can } = useWorkspacePermissions();

    useClickOutside(rootRef, () => setIsOpen(false));

    const selectedProject = useMemo(
        () => projects.find((project) => project.id === selectedProjectId) ?? null,
        [projects, selectedProjectId],
    );
    const isLockedProject = useProjectLock(selectedProjectId);

    const filteredProjects = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return projects;
        return projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery));
    }, [projects, query]);

    const handleSelect = (projectId: string) => {
        onChange(projectId);
        setIsOpen(false);
        setQuery('');
    };

    const handleCreateProject = () => {
        setIsOpen(false);
        setQuery('');
        void openCreateProject({
            onCreated: (project: Project) => onChange(project.id),
        });
    };

    const handleManageProjects = () => {
        setIsOpen(false);
        setQuery('');
        router.push('/settings/workspace');
    };

    const projectColor = selectedProject?.color;

    return (
        <div ref={rootRef} className={`relative min-w-[220px] ${className}`}>
            <span className="sr-only">{label}</span>
            <button
                type="button"
                onClick={() => setIsOpen((current) => !current)}
                style={projectColor ? { '--proj-color': projectColor } as React.CSSProperties : undefined}
                className={`w-full cursor-pointer h-14 border rounded-lg pl-4 pr-3 text-sm font-bold text-main outline-none transition-all flex items-center gap-3 ${
                    projectColor ? 'bg-[color-mix(in_srgb,var(--proj-color)_12%,transparent)]' : 'bg-surface-dark'
                } ${isOpen
                    ? 'border-primary/70 ring-1 ring-primary/30'
                    : projectColor
                        ? 'border-[color-mix(in_srgb,var(--proj-color)_40%,transparent)]'
                        : 'border-border-dark hover:border-white/20'
                }`}
            >
                <span
                    className="material-symbols-outlined text-[22px] shrink-0 text-(--proj-color,var(--color-text-secondary))"
                >
                    folder
                </span>
                <div className="flex flex-col text-left flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-bold">
                            {selectedProject?.name ?? 'No project'}
                        </span>
                        {isLockedProject && (
                            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                                Read-only
                            </span>
                        )}
                    </div>
                    {isLockedProject ? (
                        <span className="truncate text-[11px] text-amber-300 font-normal leading-tight">
                            Locked by plan limits
                        </span>
                    ) : selectedProject?.description && (
                        <span className="truncate text-[11px] text-text-secondary font-normal leading-tight">
                            {selectedProject.description}
                        </span>
                    )}
                </div>
                <span className={`material-symbols-outlined text-[18px] text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    expand_more
                </span>
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full mt-2 w-[320px] max-w-[calc(100vw-2rem)] bg-surface-dark border border-border-dark rounded-lg shadow-2xl shadow-black/40 z-50 overflow-hidden">
                    <div className="p-3">
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-[18px]">
                                search
                            </span>
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search projects..."
                                className="w-full h-11 bg-background-dark border border-border-dark rounded-lg pl-10 pr-3 text-sm text-main placeholder:text-text-secondary outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/30"
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="px-3 pb-3">
                        <p className="px-1 pb-2 text-[11px] font-black uppercase tracking-wider text-text-secondary">
                            Recent Projects
                        </p>
                        <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                            {filteredProjects.length === 0 ? (
                                <div className="px-3 py-6 text-center text-sm text-text-secondary">
                                    No projects found
                                </div>
                            ) : (
                                filteredProjects.map((project) => {
                                    const isActive = project.id === selectedProjectId;
                                    return (
                                        <button
                                            key={project.id}
                                            type="button"
                                            onClick={() => handleSelect(project.id)}
                                            className={`cursor-pointer w-full h-11 flex items-center gap-3 px-3 rounded-lg text-sm transition-colors ${isActive
                                                ? 'text-main bg-white/5'
                                                : 'text-text-secondary hover:text-main hover:bg-white/5'
                                                }`}
                                        >
                                            <span
                                                className="size-2.5 rounded-full shrink-0 bg-(--swatch-color)"
                                                style={{ '--swatch-color': project.color } as React.CSSProperties}
                                            />
                                            <span className="truncate text-left flex-1 font-bold">
                                                {project.name}
                                            </span>
                                            {project.quota_locked && (
                                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                                                    Read-only
                                                </span>
                                            )}
                                            {isActive && (
                                                <span className="material-symbols-outlined text-[18px] text-main">
                                                    check
                                                </span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div className="border-t border-border-dark p-2 space-y-1">
                        {can('create_projects') && (
                        <button
                            type="button"
                            onClick={handleCreateProject}
                            className="w-full cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-text-secondary hover:text-main hover:bg-white/5 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">add</span>
                            Create Project
                        </button>
                        )}
                        <button
                            type="button"
                            onClick={handleManageProjects}
                            className="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-text-secondary hover:text-main hover:bg-white/5 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">settings</span>
                            Manage Projects
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectScopeSelect;
