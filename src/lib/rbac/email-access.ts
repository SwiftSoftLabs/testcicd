import { requireWorkspaceMember, WorkspaceAccessError } from './workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** When email is tagged to a workspace, caller must be a member. */
export async function requireEmailWorkspaceAccess(
    workspaceId: string | null | undefined,
    userId: string,
): Promise<void> {
    if (!workspaceId) return;
    if (!UUID_RE.test(workspaceId)) {
        throw new WorkspaceAccessError('Invalid workspace id.');
    }
    await requireWorkspaceMember(workspaceId, userId);
}
