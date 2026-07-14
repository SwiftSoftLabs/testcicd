import type { TaskPluginProviderHandler } from './provider';
import { asanaTaskPlugin } from './asana-plugin';
import { clickUpTaskPlugin } from './clickup-plugin';
import { jiraTaskPlugin } from './jira-plugin';
import { trelloTaskPlugin } from './trello-plugin';
import type { TaskPluginProvider } from './types';

const handlers: Partial<Record<TaskPluginProvider, TaskPluginProviderHandler>> = {
    trello: trelloTaskPlugin,
    jira: jiraTaskPlugin,
    clickup: clickUpTaskPlugin,
    asana: asanaTaskPlugin,
};

export function getTaskPluginHandler(provider: TaskPluginProvider): TaskPluginProviderHandler {
    const handler = handlers[provider];
    if (!handler) throw new Error(`No task plugin handler for ${provider}`);
    return handler;
}

export function isTaskPluginProvider(value: string): value is TaskPluginProvider {
    return value === 'trello' || value === 'jira' || value === 'clickup' || value === 'asana';
}
