import type { TaskPluginProviderHandler } from './provider';
import type { TaskPluginInstallationRow } from './types';
import {
    listTrelloBoards,
    pullTrelloBoardTasks,
    trelloListIdForStatus,
    updateTrelloCard,
} from './trello';

export const trelloTaskPlugin: TaskPluginProviderHandler = {
    provider: 'trello',

    listContainers(_installation, token) {
        return listTrelloBoards(token);
    },

    pullTasks(_installation, token, externalContainerId) {
        return pullTrelloBoardTasks(token, externalContainerId);
    },

    async pushTaskUpdate(installation, token, externalTaskId, update, linkContext) {
        const boardId = linkContext.externalContainerId;
        let listId: string | undefined;
        if (update.status) {
            listId =
                (await trelloListIdForStatus(
                    token,
                    boardId,
                    update.status,
                    linkContext.statusMap,
                )) ?? undefined;
        }
        await updateTrelloCard(token, externalTaskId, {
            title: update.title,
            description: update.description,
            dueDate: update.dueDate,
            listId,
        });
    },
};
