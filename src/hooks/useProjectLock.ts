import { useAppContext } from '@/context/AppContext';

/**
 * Returns true when the given project has quota_locked = true.
 * Pass null/undefined to get false (no project selected = not locked).
 */
export function useProjectLock(projectId: string | null | undefined): boolean {
    const { projects } = useAppContext();
    if (!projectId) return false;
    const project = projects.find((p) => p.id === projectId);
    return project?.quota_locked === true;
}
