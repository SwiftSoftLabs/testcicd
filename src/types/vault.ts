import type { PlanCode, SubscriptionStatus } from '@/types/billing';

export const VAULT_MASK = '••••••••';

export interface VaultPlanLimits {
    maxEnvironments: number;
    maxVariables: number;
}

export const VAULT_PLAN_LIMITS: Record<PlanCode, VaultPlanLimits> = {
    basic:      { maxEnvironments: 5,    maxVariables: 100  },
    pro:        { maxEnvironments: 15,   maxVariables: 500  },
    max:        { maxEnvironments: 30,   maxVariables: 1000 },
    enterprise: { maxEnvironments: 9999, maxVariables: 9999 },
};

export interface VaultEnvironment {
    id: string;
    project_id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface VaultEnvironmentWithCount extends VaultEnvironment {
    variable_count: number;
}

// ciphertext/iv/auth_tag are intentionally omitted — never returned to clients
export interface VaultVariableMeta {
    id: string;
    project_id: string;
    workspace_id: string;
    environment_id: string;
    name: string;
    algorithm: string;
    key_version: number;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}

// Full DB row — server-only, never serialized to clients
export interface VaultVariableRow extends VaultVariableMeta {
    ciphertext: string;
    iv: string;
    auth_tag: string;
}

export interface VaultProjectKeyRow {
    id: string;
    project_id: string;
    workspace_id: string;
    wrapped_dek: string;
    dek_iv: string;
    dek_auth_tag: string;
    algorithm: string;
    key_version: number;
    created_at: string;
    updated_at: string;
}

export interface VaultSummary {
    environments: VaultEnvironmentWithCount[];
    totalVariables: number;
    limits: VaultPlanLimits;
    /** Effective tier for vault limits and gates (from paid entitlements). */
    planCode: string;
    /** Stored subscription tier — may differ from planCode when status is unpaid. */
    subscriptionPlanCode: PlanCode;
    subscriptionStatus: SubscriptionStatus;
    isAdmin: boolean;
    hasKey: boolean;
}

// Transient — only returned by POST /api/vault/reveal, never persisted
export interface VaultRevealResult {
    variableId: string;
    name: string;
    value: string;
}

export interface VaultSyncTargetGithubConfig {
    provider: 'github';
    owner: string;
    repo: string;
    installationId?: string | null;
    environmentName?: string | null;
    variableMode: 'all' | 'subset';
    selectedVariableNames?: string[];
    vaultEnvironmentId: string;
}

export interface VaultSyncTargetVercelConfig {
    provider: 'vercel';
    vercelProjectId: string;
    vercelProjectName: string;
    targets: ('production' | 'preview' | 'development')[];
    variableMode: 'all' | 'subset';
    selectedVariableNames?: string[];
    vaultEnvironmentId: string;
}

export type VaultSyncTargetConfig = VaultSyncTargetGithubConfig | VaultSyncTargetVercelConfig;

export interface VaultSyncTarget {
    id: string;
    project_id: string;
    workspace_id: string;
    name: string;
    provider: 'github' | 'vercel';
    config: VaultSyncTargetConfig;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface VaultSyncEvent {
    id: string;
    sync_target_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    metadata: {
        pushed?: number;
        failed?: { name: string; error: string }[];
        triggeredBy?: string;
    };
    created_at: string;
    updated_at: string;
}

export interface VaultSyncTargetWithLastEvent extends VaultSyncTarget {
    lastEvent: VaultSyncEvent | null;
}

export interface VaultCliToken {
    id: string;
    project_id: string;
    workspace_id: string;
    user_id: string;
    name: string;
    scopes: string[];
    /** NULL or empty = all environments; otherwise case-insensitive name allowlist. */
    allowed_environments: string[] | null;
    expires_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: string;
}

export interface VaultCliTokenWithPlaintext extends VaultCliToken {
    plaintext: string;
}

export type VaultAuditEventType =
    | 'variable.created'
    | 'variable.updated'
    | 'variable.deleted'
    | 'variable.revealed'
    | 'variables.imported'
    | 'variables.exported'
    | 'environment.created'
    | 'environment.renamed'
    | 'environment.deleted'
    | 'project_key.generated'
    | 'sync_target.created'
    | 'sync_target.updated'
    | 'sync_target.deleted'
    | 'sync.started'
    | 'sync.completed'
    | 'sync.failed'
    | 'cli_token.created'
    | 'cli_token.revoked'
    | 'cli_token.rotated'
    | 'cli_env.pulled'
    | 'cli_env.denied'
    | 'cli_token.auth_failed';

export interface VaultAuditEntry {
    id: string;
    project_id: string;
    workspace_id: string;
    actor_id: string;
    actor_email: string | null;
    actor_name: string | null;
    event_type: VaultAuditEventType;
    resource_type: string;
    resource_id: string | null;
    environment_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}
