import type { Priority, Status } from '@/types';

export type TaskPluginProvider = 'trello' | 'jira' | 'clickup' | 'asana';

export type PluginTaskSyncOrigin = 'import' | 'export';

export interface TaskPluginInstallationRow {
    id: string;
    workspace_id: string;
    installed_by: string;
    provider: TaskPluginProvider;
    account_id: string;
    account_name: string | null;
    account_email: string | null;
    encrypted_token: string;
    encrypted_refresh: string | null;
    status: 'connected' | 'error' | 'revoked';
    settings: Record<string, unknown>;
    sync_cursor: Record<string, unknown>;
    last_synced_at: string | null;
    last_sync_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface PluginProjectLinkRow {
    id: string;
    installation_id: string;
    project_id: string | null;
    external_container_id: string;
    external_container_name: string | null;
    status_map: Record<string, string>;
    created_at: string;
    updated_at: string;
}

export interface PluginTaskLinkRow {
    id: string;
    installation_id: string;
    task_id: string;
    external_task_id: string;
    sync_origin: PluginTaskSyncOrigin;
    external_updated_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface TaskPluginStatus {
    provider: TaskPluginProvider;
    connected: boolean;
    accountName: string | null;
    accountEmail: string | null;
    status: 'connected' | 'error' | 'revoked' | 'disconnected';
    lastSyncedAt: string | null;
    lastSyncError: string | null;
}

export interface ExternalTaskContainer {
    id: string;
    name: string;
    subtitle?: string;
}

export interface NormalizedPluginTask {
    externalId: string;
    title: string;
    description: string | null;
    externalStatus: string;
    statusCategory?: 'todo' | 'in_progress' | 'done';
    priority?: Priority;
    dueDate?: string | null;
    externalUpdatedAt?: string | null;
    assigneeEmail?: string | null;
}

export interface ProjectLinkDTO {
    id: string;
    provider: TaskPluginProvider;
    projectId: string | null;
    projectName: string | null;
    externalContainerId: string;
    externalContainerName: string | null;
}

export interface PullTasksResult {
    imported: number;
    updated: number;
}

export type MappedStatus = Status;
