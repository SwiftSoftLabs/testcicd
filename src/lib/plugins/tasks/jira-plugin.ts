import type { TaskPluginProviderHandler } from './provider';
import type { TaskPluginInstallationRow } from './types';
import { getJiraCloudId, listJiraProjects, pullJiraProjectTasks, updateJiraIssue } from './jira';

export const jiraTaskPlugin: TaskPluginProviderHandler = {
    provider: 'jira',

    listContainers(installation, token) {
        return listJiraProjects(token, getJiraCloudId(installation));
    },

    pullTasks(installation: TaskPluginInstallationRow, token, externalContainerId) {
        return pullJiraProjectTasks(token, getJiraCloudId(installation), externalContainerId);
    },

    async pushTaskUpdate(installation, token, externalTaskId, update) {
        await updateJiraIssue(token, getJiraCloudId(installation), externalTaskId, {
            title: update.title,
            description: update.description,
            status: update.status,
        });
    },
};
