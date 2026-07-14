import type {
    ExternalTaskContainer,
    NormalizedPluginTask,
    PullTasksResult,
    TaskPluginInstallationRow,
    TaskPluginProvider,
} from './types';

export interface TaskUpdatePayload {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | null;
}

export interface TaskPluginProviderHandler {
    readonly provider: TaskPluginProvider;
    listContainers(
        installation: TaskPluginInstallationRow,
        accessToken: string,
    ): Promise<ExternalTaskContainer[]>;
    pullTasks(
        installation: TaskPluginInstallationRow,
        accessToken: string,
        externalContainerId: string,
    ): Promise<NormalizedPluginTask[]>;
    pushTaskUpdate?(
        installation: TaskPluginInstallationRow,
        accessToken: string,
        externalTaskId: string,
        update: TaskUpdatePayload,
        linkContext: { externalContainerId: string; statusMap: Record<string, string> },
    ): Promise<void>;
}

export type { NormalizedPluginTask, PullTasksResult };
