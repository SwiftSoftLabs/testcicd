import { NextResponse } from 'next/server';
import { z } from 'zod';

import { query, SCHEMA } from '@/lib/db';
import { requireManageBotIntegrations, requireWorkspaceChatRead } from '@/lib/chat/chatAccess';
import {
    createConversationLink,
    findChatPluginInstallation,
    findConversationLinkByExternalChannel,
    listConversationLinks,
    deleteConversationLink,
} from '@/lib/plugins/chat/repository';
import {
    formatSlackErrorForUser,
    isSlackMissingScopeError,
    isSlackNotInChannelError,
    slackNotInChannelUserMessage,
} from '@/lib/plugins/chat/slack';
import { onConversationLinkCreated, syncChannelHistory } from '@/lib/plugins/chat/sync-engine';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireWorkspaceChatRead(workspaceId, user.id);
        const links = await listConversationLinks(workspaceId);
        return NextResponse.json({ links });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to list links' }, { status: 500 });
    }
}

const postSchema = z.object({
    workspaceId: z.string().uuid(),
    provider: z.enum(['slack', 'teams', 'discord']).default('slack'),
    conversationId: z.string().uuid(),
    externalChannelId: z.string().min(1),
    externalChannelName: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const parsed = postSchema.parse(await request.json());
        await requireManageBotIntegrations(parsed.workspaceId, user.id);

        const installation = await findChatPluginInstallation(parsed.workspaceId, parsed.provider);
        if (!installation) {
            return NextResponse.json({ error: 'Connect Slack first' }, { status: 400 });
        }

        const conv = await query<{ id: string; workspace_id: string; type: string }>(
            `SELECT id, workspace_id, type FROM ${SCHEMA}.conversations
             WHERE id = $1 AND archived_at IS NULL LIMIT 1`,
            [parsed.conversationId],
        );
        const conversation = conv.rows[0];
        if (!conversation || conversation.workspace_id !== parsed.workspaceId) {
            return NextResponse.json({ error: 'Conversation not found in workspace' }, { status: 404 });
        }
        if (conversation.type !== 'channel') {
            return NextResponse.json({ error: 'Only workspace channels can be linked to Slack' }, { status: 400 });
        }

        const existing = await findConversationLinkByExternalChannel(
            installation.id,
            parsed.externalChannelId,
        );
        if (existing && existing.conversation_id !== parsed.conversationId) {
            return NextResponse.json(
                { error: 'This Slack channel is already linked to another OneWork channel' },
                { status: 409 },
            );
        }

        const link =
            existing ??
            (await createConversationLink({
                installationId: installation.id,
                conversationId: parsed.conversationId,
                externalChannelId: parsed.externalChannelId,
                externalChannelName: parsed.externalChannelName ?? null,
            }));

        if (!existing) {
            await onConversationLinkCreated(installation, parsed.externalChannelId);
        }

        let imported = 0;
        let warning: string | undefined;
        try {
            imported = await syncChannelHistory(
                installation,
                parsed.externalChannelId,
                parsed.conversationId,
            );
        } catch (syncError: unknown) {
            if (installation.provider === 'slack' && isSlackNotInChannelError(syncError)) {
                warning = slackNotInChannelUserMessage(parsed.externalChannelName ?? undefined);
            } else if (installation.provider === 'slack' && isSlackMissingScopeError(syncError)) {
                warning = formatSlackErrorForUser(syncError);
            } else {
                throw syncError;
            }
        }

        return NextResponse.json(
            { ok: true, link, imported, warning, alreadyLinked: Boolean(existing) },
            { status: existing ? 200 : 201 },
        );
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Failed to create link';
        const status = msg.includes('duplicate') || msg.includes('unique') ? 409 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
}

export async function DELETE(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const linkId = new URL(request.url).searchParams.get('linkId');
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!linkId || !workspaceId) {
            return NextResponse.json({ error: 'linkId and workspaceId are required' }, { status: 400 });
        }
        await requireManageBotIntegrations(workspaceId, user.id);
        await deleteConversationLink(linkId);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to delete link' }, { status: 500 });
    }
}
