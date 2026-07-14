import { NextResponse } from 'next/server';

import { getChatPluginStatus } from '@/lib/plugins/chat/repository';
import type { ChatPluginStatus } from '@/lib/plugins/chat/types';
import { requireManageBotIntegrations } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireManageBotIntegrations(workspaceId, user.id);
        const [slack, teams, discord] = await Promise.all([
            getChatPluginStatus(workspaceId, 'slack'),
            getChatPluginStatus(workspaceId, 'teams'),
            getChatPluginStatus(workspaceId, 'discord'),
        ]);
        const plugins: ChatPluginStatus[] = [slack, teams, discord];
        return NextResponse.json({
            slackConfigured: Boolean(process.env.SLACK_CLIENT_ID?.trim() && process.env.SLACK_CLIENT_SECRET?.trim()),
            teamsConfigured: Boolean(
                process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() && process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim(),
            ),
            discordConfigured: Boolean(
                process.env.DISCORD_APPLICATION_ID?.trim() &&
                    process.env.DISCORD_CLIENT_SECRET?.trim() &&
                    process.env.DISCORD_BOT_TOKEN?.trim(),
            ),
            slack,
            teams,
            discord,
            plugins,
        });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to fetch chat plugin status' }, { status: 500 });
    }
}
