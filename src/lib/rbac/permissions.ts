/** Workspace capability keys — stable across API, DB overrides, and UI. */
export const PERMISSION_KEYS = [
    'workspace_settings',
    'billing_management',
    'invite_members',
    'manage_members',
    'view_audit_logs',
    'create_projects',
    'delete_projects',
    'manage_workflows',
    'archive_projects',
    'create_channels',
    'archive_channels',
    'manage_bot_integrations',
    'moderate_content',
    'push_protected_branches',
    'merge_pull_requests',
    'access_repositories',
    'manage_roles',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionSection =
    | 'GENERAL WORKSPACE'
    | 'PROJECT MANAGEMENT'
    | 'VERSION CONTROL'
    | 'CHAT & COMMUNICATION';

export interface PermissionDefinition {
    key: PermissionKey;
    name: string;
    description: string;
    section: PermissionSection;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
    { key: 'workspace_settings', name: 'Workspace Settings', description: 'Manage branding, name, and URL.', section: 'GENERAL WORKSPACE' },
    { key: 'billing_management', name: 'Billing Management', description: 'View invoices and update payment methods.', section: 'GENERAL WORKSPACE' },
    { key: 'invite_members', name: 'Invite Members', description: 'Add new users to the workspace.', section: 'GENERAL WORKSPACE' },
    { key: 'manage_members', name: 'Manage Members', description: 'Remove members and change their roles.', section: 'GENERAL WORKSPACE' },
    { key: 'view_audit_logs', name: 'View Audit Logs', description: 'Read workspace activity and audit history.', section: 'GENERAL WORKSPACE' },
    { key: 'create_projects', name: 'Create Projects', description: 'Initialize new projects and repositories.', section: 'PROJECT MANAGEMENT' },
    { key: 'delete_projects', name: 'Delete Projects', description: 'Permanently remove projects and data.', section: 'PROJECT MANAGEMENT' },
    { key: 'manage_workflows', name: 'Manage Workflows', description: 'Edit boards, statuses, and automation.', section: 'PROJECT MANAGEMENT' },
    { key: 'archive_projects', name: 'Archive Projects', description: 'Archive or restore projects.', section: 'PROJECT MANAGEMENT' },
    { key: 'push_protected_branches', name: 'Push to Protected Branches', description: 'Direct commits to main/master branches.', section: 'VERSION CONTROL' },
    { key: 'merge_pull_requests', name: 'Merge Pull Requests', description: 'Approve and merge code changes.', section: 'VERSION CONTROL' },
    { key: 'access_repositories', name: 'Access Repositories', description: 'Read and clone linked source code.', section: 'VERSION CONTROL' },
    { key: 'create_channels', name: 'Create Channels', description: 'Create workspace chat channels.', section: 'CHAT & COMMUNICATION' },
    { key: 'archive_channels', name: 'Archive Channels', description: 'Archive or delete channels.', section: 'CHAT & COMMUNICATION' },
    { key: 'manage_bot_integrations', name: 'Manage Bot Integrations', description: 'Connect and configure chat bots.', section: 'CHAT & COMMUNICATION' },
    { key: 'moderate_content', name: 'Moderate Content', description: 'Delete messages and moderate channels.', section: 'CHAT & COMMUNICATION' },
    { key: 'manage_roles', name: 'Manage Roles & Permissions', description: 'Edit role definitions and permission matrix.', section: 'GENERAL WORKSPACE' },
];

export const PERMISSION_GROUPS = [
    {
        title: 'Workspace Management',
        icon: 'workspaces',
        description: 'Manage workspace settings and members',
        permissions: ['manage_members', 'billing_management', 'workspace_settings', 'view_audit_logs'] as PermissionKey[],
    },
    {
        title: 'Project Access',
        icon: 'folder',
        description: 'Create, edit and manage projects',
        permissions: ['create_projects', 'delete_projects', 'manage_workflows', 'archive_projects'] as PermissionKey[],
    },
    {
        title: 'Chat & Communication',
        icon: 'chat',
        description: 'Messaging and channel controls',
        permissions: ['create_channels', 'archive_channels', 'manage_bot_integrations', 'moderate_content'] as PermissionKey[],
    },
] as const;

export function permissionLabel(key: PermissionKey): string {
    return PERMISSION_DEFINITIONS.find((p) => p.key === key)?.name ?? key;
}
