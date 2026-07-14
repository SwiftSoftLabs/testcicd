import type { PermissionKey } from './permissions';
import { PERMISSION_KEYS } from './permissions';

/** Stored in workspace_members.role */
export const WORKSPACE_ROLES = ['admin', 'team_lead', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface RoleDefinition {
    key: WorkspaceRole;
    label: string;
    description: string;
    active: boolean;
}

export const DEFAULT_ROLE_DEFINITIONS: Record<WorkspaceRole, RoleDefinition> = {
    admin: {
        key: 'admin',
        label: 'Admin',
        description: 'Full workspace access except owner-only actions (delete workspace, delete accounts).',
        active: true,
    },
    team_lead: {
        key: 'team_lead',
        label: 'Team Lead',
        description: 'Manage projects, invite members, and lead delivery work.',
        active: true,
    },
    member: {
        key: 'member',
        label: 'Member',
        description: 'Standard developer and collaborator access.',
        active: true,
    },
    guest: {
        key: 'guest',
        label: 'Guest',
        description: 'Restricted read-oriented access for external partners.',
        active: true,
    },
};

/** Baseline capabilities per built-in role (overridable per workspace). */
export const DEFAULT_ROLE_PERMISSIONS: Record<WorkspaceRole, PermissionKey[]> = {
    admin: [...PERMISSION_KEYS],
    team_lead: [
        'invite_members',
        'create_projects',
        'manage_workflows',
        'archive_projects',
        'create_channels',
        'merge_pull_requests',
        'access_repositories',
        'push_protected_branches',
        'moderate_content',
    ],
    member: [
        'create_projects',
        'manage_workflows',
        'create_channels',
        'merge_pull_requests',
        'access_repositories',
        'billing_management',
    ],
    guest: ['access_repositories'],
};

export function isWorkspaceRole(value: string): value is WorkspaceRole {
    return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function roleToUILabel(dbRole: string | null): string {
    if (!dbRole) return 'Non-Member';
    switch (dbRole) {
        case 'admin':
            return 'Admin';
        case 'team_lead':
            return 'Team Lead';
        case 'guest':
            return 'Guest';
        default:
            return 'Member';
    }
}

export function roleFromUILabel(uiRole: string): WorkspaceRole {
    switch (uiRole) {
        case 'Admin':
            return 'admin';
        case 'Team Lead':
            return 'team_lead';
        case 'Guest':
            return 'guest';
        default:
            return 'member';
    }
}
