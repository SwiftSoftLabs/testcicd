import type { TaskPluginProviderHandler } from './provider';
import { listClickUpContainers, pullClickUpListTasks, updateClickUpTask } from './clickup';

export const clickUpTaskPlugin: TaskPluginProviderHandler = {
    provider: 'clickup',

    listContainers(_installation, token) {
        return listClickUpContainers(token);
    },

    pullTasks(_installation, token, externalContainerId) {
        return pullClickUpListTasks(token, externalContainerId);
    },

    async pushTaskUpdate(_installation, token, externalTaskId, update, linkContext) {
        const listId = linkContext.externalContainerId.replace(/^list:/, '');
        await updateClickUpTask(
            token,
            externalTaskId,
            {
                title: update.title,
                description: update.description,
                status: update.status,
            },
            { listId },
        );
    },
};
