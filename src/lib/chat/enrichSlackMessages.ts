import {
    applySlackMentionLabels,
    resolveSlackMrkdwnForStorage,
    slackMessageNeedsMentionResolution,
    type SlackMentionLabels,
} from '@/lib/plugins/chat/slack-mrkdwn';
import {
    findChatPluginInstallationById,
    findConversationLinkByConversationId,
} from '@/lib/plugins/chat/repository';
import { validChatPluginAccessToken } from '@/lib/plugins/chat/tokens';

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== 'object') return null;
    return metadata as Record<string, unknown>;
}

type MessageRow = {
    content: string;
    metadata: unknown;
};

/** Resolve raw Slack mentions when loading messages (covers pre-fix history). */
export async function enrichSlackMessagesForRead<T extends MessageRow>(
    conversationId: string,
    rows: T[],
): Promise<T[]> {
    const slackRows = rows.filter((row) => {
        const meta = parseMetadata(row.metadata);
        return meta?.source === 'slack' && slackMessageNeedsMentionResolution(row.content);
    });

    if (slackRows.length === 0) {
        return rows.map((row) => {
            const meta = parseMetadata(row.metadata);
            const stored = meta?.mentionLabels as SlackMentionLabels | undefined;
            if (meta?.source === 'slack' && stored) {
                return { ...row, content: applySlackMentionLabels(row.content, stored) };
            }
            return row;
        });
    }

    const link = await findConversationLinkByConversationId(conversationId);
    if (!link) return rows;

    const installation = await findChatPluginInstallationById(link.installation_id);
    if (!installation || installation.provider !== 'slack' || installation.status !== 'connected') {
        return rows;
    }

    let token: string;
    try {
        token = await validChatPluginAccessToken(installation);
    } catch {
        return rows;
    }

    const cache = new Map<string, string>();
    for (const row of rows) {
        const meta = parseMetadata(row.metadata);
        const stored = meta?.mentionLabels as SlackMentionLabels | undefined;
        if (stored) {
            for (const [id, name] of Object.entries(stored)) {
                if (name && !/^[UWBS][A-Z0-9]{8,}$/i.test(name)) cache.set(id.toUpperCase(), name);
            }
        }
    }

    return Promise.all(
        rows.map(async (row) => {
            const meta = parseMetadata(row.metadata);
            if (meta?.source !== 'slack') return row;

            const stored = meta?.mentionLabels as SlackMentionLabels | undefined;
            if (!slackMessageNeedsMentionResolution(row.content)) {
                return stored
                    ? { ...row, content: applySlackMentionLabels(row.content, stored) }
                    : row;
            }

            const { text, mentionLabels } = await resolveSlackMrkdwnForStorage(
                row.content,
                token,
                cache,
            );
            const mergedLabels = { ...stored, ...mentionLabels };

            return {
                ...row,
                content: text,
                metadata: { ...meta, mentionLabels: mergedLabels },
            };
        }),
    );
}
