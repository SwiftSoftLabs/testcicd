import type { Status } from '@/types';

import {
    asanaSectionGidForStatus,
    getAsanaWorkspaceGid,
    listAsanaProjects,
    pullAsanaProjectTasks,
    updateAsanaTask,
} from './asana';
import type { TaskPluginProviderHandler } from './provider';

export const asanaTaskPlugin: TaskPluginProviderHandler = {
    provider: 'asana',

    listContainers(installation, token) {
        return listAsanaProjects(token, getAsanaWorkspaceGid(installation));
    },

    pullTasks(_installation, token, externalContainerId) {
        return pullAsanaProjectTasks(token, externalContainerId);
    },

    async pushTaskUpdate(installation, token, externalTaskId, update, linkContext) {
        const projectGid = linkContext.externalContainerId;
        let sectionGid: string | undefined;
        let completed: boolean | undefined;

        if (update.status) {
            if (update.status === 'done') {
                completed = true;
            } else {
                completed = false;
                const gid = await asanaSectionGidForStatus(
                    token,
                    projectGid,
                    update.status as Status,
                    linkContext.statusMap,
                );
                sectionGid = gid ?? undefined;
            }
        }

        await updateAsanaTask(token, externalTaskId, {
            title: update.title,
            description: update.description,
            dueDate: update.dueDate,
            completed,
            sectionGid,
        });
    },
};
