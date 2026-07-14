'use client';

import { useCallback } from 'react';
import { useAppContext } from '@/context/AppContext';
import type { PermissionKey } from '@/lib/rbac/permissions';

/** Workspace RBAC from AppContext (single fetch per workspace switch). */
export function useWorkspacePermissions() {
    const {
        workspacePermissions: permissions,
        workspaceRoleLabel: role,
        workspaceIsOwner: isOwner,
        workspacePermissionsLoading: loading,
        canWorkspace,
    } = useAppContext();

    const can = useCallback(
        (permission: PermissionKey) => canWorkspace(permission),
        [canWorkspace],
    );

    return { permissions, role, isOwner, loading, can };
}
