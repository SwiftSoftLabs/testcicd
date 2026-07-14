export interface VercelIntegrationRow {
    id: string;
    workspace_id: string;
    connected_by: string | null;
    connection_scope: 'team' | 'user';
    target_id: string;
    target_name: string | null;
    access_token_enc: string;
    refresh_token_enc: string | null;
    token_type: string;
    scope: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface VercelIntegrationStatus {
    connected: boolean;
    targetName: string | null;
    targetId: string | null;
    connectedBy: string | null;
    connectedAt: string | null;
    configured: boolean;
    /** When true, members with access_repositories can set up CI/CD. Default true. */
    cicdAllowMembers: boolean;
    /** Current user can change cicdAllowMembers (admin/owner). */
    canManageCicdAccess: boolean;
}

export interface VercelProject {
    id: string;
    name: string;
    framework: string | null;
}

export interface VercelCreatedProject {
    id: string;
    name: string;
}

export interface VercelDeploymentSummary {
    id: string;
    url: string | null;
    state: string;
    target: 'production' | 'preview' | null;
    meta?: {
        githubCommitRef?: string;
        githubCommitSha?: string;
        gitCommitRef?: string;
        gitCommitSha?: string;
    };
    createdAt: number;
}

export interface VercelCreatedDeployment {
    id: string;
    url: string | null;
    readyState: string;
}

export interface VercelWebhookSummary {
    id: string;
    url: string;
    events: string[];
}

export interface VercelTokenResponse {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    scope?: string;
    team_id?: string;
    user_id?: string;
    installation_id?: string;
}
