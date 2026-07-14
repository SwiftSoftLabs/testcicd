import type { PermissionKey } from './permissions';
import { PERMISSION_KEYS } from './permissions';
import {
    DEFAULT_ROLE_DEFINITIONS,
    DEFAULT_ROLE_PERMISSIONS,
    type RoleDefinition,
    type WorkspaceRole,
    WORKSPACE_ROLES,
} from './roles';

/** Per-workspace overrides persisted in workspaces.rbac_config */
export interface WorkspaceRbacRoleOverride {
    label?: string;
    description?: string;
    active?: boolean;
    permissions?: Partial<Record<PermissionKey, boolean>>;
}

export interface WorkspaceRbacConfig {
    roles?: Partial<Record<WorkspaceRole, WorkspaceRbacRoleOverride>>;
}

export interface ResolvedRoleConfig extends RoleDefinition {
    permissions: Record<PermissionKey, boolean>;
}

function defaultPermissionMap(role: WorkspaceRole): Record<PermissionKey, boolean> {
    const allowed = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
    return PERMISSION_KEYS.reduce(
        (acc, key) => {
            acc[key] = allowed.has(key);
            return acc;
        },
        {} as Record<PermissionKey, boolean>,
    );
}

export function mergeRbacConfig(stored: WorkspaceRbacConfig | null | undefined): Record<WorkspaceRole, ResolvedRoleConfig> {
    const overrides = stored?.roles ?? {};
    const result = {} as Record<WorkspaceRole, ResolvedRoleConfig>;

    for (const role of WORKSPACE_ROLES) {
        const base = DEFAULT_ROLE_DEFINITIONS[role];
        const o = overrides[role];
        const permissions = defaultPermissionMap(role);
        if (o?.permissions) {
            for (const key of PERMISSION_KEYS) {
                if (typeof o.permissions[key] === 'boolean') {
                    permissions[key] = o.permissions[key]!;
                }
            }
        }
        result[role] = {
            key: role,
            label: o?.label?.trim() || base.label,
            description: o?.description?.trim() || base.description,
            active: o?.active ?? base.active,
            permissions,
        };
    }
    return result;
}

export function roleHasPermission(
    resolved: Record<WorkspaceRole, ResolvedRoleConfig>,
    role: WorkspaceRole,
    permission: PermissionKey,
): boolean {
    const cfg = resolved[role];
    if (!cfg?.active) return false;
    return Boolean(cfg.permissions[permission]);
}

export function permissionsForMember(
    resolved: Record<WorkspaceRole, ResolvedRoleConfig>,
    role: WorkspaceRole,
    isOwner: boolean,
): PermissionKey[] {
    if (isOwner) return [...PERMISSION_KEYS];
    return PERMISSION_KEYS.filter((key) => roleHasPermission(resolved, role, key));
}

export function buildRbacConfigPatch(
    current: WorkspaceRbacConfig | null | undefined,
    role: WorkspaceRole,
    patch: WorkspaceRbacRoleOverride,
): WorkspaceRbacConfig {
    return {
        roles: {
            ...(current?.roles ?? {}),
            [role]: {
                ...(current?.roles?.[role] ?? {}),
                ...patch,
            },
        },
    };
}
