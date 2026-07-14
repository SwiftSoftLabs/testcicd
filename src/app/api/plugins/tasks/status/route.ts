import { NextResponse } from 'next/server';

import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import { getTaskPluginStatus } from '@/lib/plugins/tasks/repository';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireWorkspaceTasksWrite(workspaceId, user.id);
        const [trello, jira, clickup, asana] = await Promise.all([
            getTaskPluginStatus(workspaceId, 'trello'),
            getTaskPluginStatus(workspaceId, 'jira'),
            getTaskPluginStatus(workspaceId, 'clickup'),
            getTaskPluginStatus(workspaceId, 'asana'),
        ]);
        return NextResponse.json({
            trelloConfigured: Boolean(process.env.TRELLO_API_KEY?.trim()),
            jiraConfigured: Boolean(
                process.env.ATLASSIAN_CLIENT_ID?.trim() && process.env.ATLASSIAN_CLIENT_SECRET?.trim(),
            ),
            clickupConfigured: Boolean(
                process.env.CLICKUP_CLIENT_ID?.trim() && process.env.CLICKUP_CLIENT_SECRET?.trim(),
            ),
            asanaConfigured: Boolean(
                process.env.ASANA_CLIENT_ID?.trim() && process.env.ASANA_CLIENT_SECRET?.trim(),
            ),
            trello,
            jira,
            clickup,
            asana,
        });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to fetch task plugin status' }, { status: 500 });
    }
}
