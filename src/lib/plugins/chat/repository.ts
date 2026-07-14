import { query, SCHEMA } from '@/lib/db';
import { decryptChatPluginSecret, encryptChatPluginSecret } from './crypto';
import type {
    ChatPluginInstallationRow,
    ChatPluginProvider,
    ChatPluginStatus,
    ConversationLinkDTO,
    PluginConversationLinkRow,
    PluginMessageLinkRow,
    PluginMessageSyncOrigin,
} from './types';

export async function upsertChatPluginInstallation(input: {
    workspaceId: string;
    installedBy: string;
    provider: ChatPluginProvider;
    teamId: string;
    teamName: string | null;
    botUserId: string | null;
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiresAt?: Date | null;
}): Promise<ChatPluginInstallationRow> {
    const settings =
        input.tokenExpiresAt != null
            ? JSON.stringify({ tokenExpiresAt: input.tokenExpiresAt.toISOString() })
            : '{}';
    const result = await query<ChatPluginInstallationRow>(
        `INSERT INTO ${SCHEMA}.chat_plugin_installations (
            workspace_id, installed_by, provider, team_id, team_name, bot_user_id,
            encrypted_token, encrypted_refresh, settings, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'connected')
         ON CONFLICT (workspace_id, provider)
         DO UPDATE SET
            installed_by = EXCLUDED.installed_by,
            team_id = EXCLUDED.team_id,
            team_name = EXCLUDED.team_name,
            bot_user_id = EXCLUDED.bot_user_id,
            encrypted_token = EXCLUDED.encrypted_token,
            encrypted_refresh = COALESCE(EXCLUDED.encrypted_refresh, chat_plugin_installations.encrypted_refresh),
            settings = CASE
                WHEN EXCLUDED.settings::text != '{}'::text THEN EXCLUDED.settings
                ELSE chat_plugin_installations.settings
            END,
            status = 'connected',
            last_sync_error = NULL,
            updated_at = NOW()
         RETURNING *`,
        [
            input.workspaceId,
            input.installedBy,
            input.provider,
            input.teamId,
            input.teamName,
            input.botUserId,
            encryptChatPluginSecret(input.accessToken),
            input.refreshToken ? encryptChatPluginSecret(input.refreshToken) : null,
            settings,
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to persist chat plugin installation');
    return row;
}

export async function findChatPluginInstallation(
    workspaceId: string,
    provider: ChatPluginProvider = 'slack',
): Promise<ChatPluginInstallationRow | null> {
    const result = await query<ChatPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.chat_plugin_installations
         WHERE workspace_id = $1 AND provider = $2 AND status = 'connected'
         LIMIT 1`,
        [workspaceId, provider],
    );
    return result.rows[0] ?? null;
}

export async function findChatPluginInstallationById(id: string): Promise<ChatPluginInstallationRow | null> {
    const result = await query<ChatPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.chat_plugin_installations WHERE id = $1 LIMIT 1`,
        [id],
    );
    return result.rows[0] ?? null;
}

export async function findInstallationBySlackTeamId(teamId: string): Promise<ChatPluginInstallationRow | null> {
    const result = await query<ChatPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.chat_plugin_installations
         WHERE team_id = $1 AND provider = 'slack' AND status = 'connected'
         LIMIT 1`,
        [teamId],
    );
    return result.rows[0] ?? null;
}

export async function getChatPluginStatus(
    workspaceId: string,
    provider: ChatPluginProvider,
): Promise<ChatPluginStatus> {
    const row = await findChatPluginInstallation(workspaceId, provider);
    return {
        provider,
        connected: row?.status === 'connected',
        teamName: row?.team_name ?? null,
        status: row?.status ?? 'disconnected',
        lastSyncedAt: row?.last_synced_at ?? null,
        lastSyncError: row?.last_sync_error ?? null,
    };
}

export async function replaceInstallationAccessToken(
    installationId: string,
    accessToken: string,
    refreshToken: string | null,
    tokenExpiresAt: Date | null,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.chat_plugin_installations
         SET encrypted_token = $1,
             encrypted_refresh = COALESCE($2, encrypted_refresh),
             settings = COALESCE(settings, '{}'::jsonb) || $3::jsonb,
             updated_at = NOW()
         WHERE id = $4`,
        [
            encryptChatPluginSecret(accessToken),
            refreshToken ? encryptChatPluginSecret(refreshToken) : null,
            JSON.stringify({
                tokenExpiresAt: tokenExpiresAt?.toISOString() ?? null,
            }),
            installationId,
        ],
    );
}

export function decryptInstallationRefresh(row: ChatPluginInstallationRow): string | null {
    if (!row.encrypted_refresh) return null;
    return decryptChatPluginSecret(row.encrypted_refresh);
}

export async function deleteChatPluginInstallation(workspaceId: string, provider: ChatPluginProvider = 'slack'): Promise<void> {
    await query(
        `DELETE FROM ${SCHEMA}.chat_plugin_installations WHERE workspace_id = $1 AND provider = $2`,
        [workspaceId, provider],
    );
}

export async function updateInstallationSyncState(
    installationId: string,
    opts: { lastSyncedAt?: Date; lastSyncError?: string | null; syncCursor?: Record<string, unknown> },
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.chat_plugin_installations
         SET last_synced_at = COALESCE($1, last_synced_at),
             last_sync_error = $2,
             sync_cursor = COALESCE($3::jsonb, sync_cursor),
             updated_at = NOW()
         WHERE id = $4`,
        [
            opts.lastSyncedAt?.toISOString() ?? null,
            opts.lastSyncError ?? null,
            opts.syncCursor ? JSON.stringify(opts.syncCursor) : null,
            installationId,
        ],
    );
}

export function decryptInstallationToken(row: ChatPluginInstallationRow): string {
    return decryptChatPluginSecret(row.encrypted_token);
}

export async function listConversationLinks(workspaceId: string): Promise<ConversationLinkDTO[]> {
    const result = await query<{
        id: string;
        conversation_id: string;
        external_channel_id: string;
        external_channel_name: string | null;
        conversation_name: string | null;
        provider: ChatPluginProvider;
    }>(
        `SELECT l.id, l.conversation_id, l.external_channel_id, l.external_channel_name,
                c.name AS conversation_name, i.provider
         FROM ${SCHEMA}.plugin_conversation_links l
         JOIN ${SCHEMA}.chat_plugin_installations i ON i.id = l.installation_id
         JOIN ${SCHEMA}.conversations c ON c.id = l.conversation_id
         WHERE i.workspace_id = $1 AND i.status = 'connected'
         ORDER BY i.provider, c.name`,
        [workspaceId],
    );
    return result.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        conversationName: row.conversation_name,
        provider: row.provider,
        externalChannelId: row.external_channel_id,
        externalChannelName: row.external_channel_name,
    }));
}

export async function listConversationLinksForInstallation(
    installationId: string,
): Promise<PluginConversationLinkRow[]> {
    const result = await query<PluginConversationLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_conversation_links WHERE installation_id = $1`,
        [installationId],
    );
    return result.rows;
}

export async function findConversationLinkByConversationId(
    conversationId: string,
): Promise<PluginConversationLinkRow | null> {
    const result = await query<PluginConversationLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_conversation_links WHERE conversation_id = $1 LIMIT 1`,
        [conversationId],
    );
    return result.rows[0] ?? null;
}

export async function findConversationLinkByExternalChannel(
    installationId: string,
    externalChannelId: string,
): Promise<PluginConversationLinkRow | null> {
    const result = await query<PluginConversationLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_conversation_links
         WHERE installation_id = $1 AND external_channel_id = $2
         LIMIT 1`,
        [installationId, externalChannelId],
    );
    return result.rows[0] ?? null;
}

export async function createConversationLink(input: {
    installationId: string;
    conversationId: string;
    externalChannelId: string;
    externalChannelName: string | null;
}): Promise<PluginConversationLinkRow> {
    const result = await query<PluginConversationLinkRow>(
        `INSERT INTO ${SCHEMA}.plugin_conversation_links (
            installation_id, conversation_id, external_channel_id, external_channel_name
         ) VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.installationId, input.conversationId, input.externalChannelId, input.externalChannelName],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create conversation link');
    return row;
}

export async function deleteConversationLink(linkId: string): Promise<void> {
    await query(`DELETE FROM ${SCHEMA}.plugin_conversation_links WHERE id = $1`, [linkId]);
}

export async function findPluginMessageLinkByMessageId(
    installationId: string,
    messageId: string,
): Promise<PluginMessageLinkRow | null> {
    const result = await query<PluginMessageLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_message_links
         WHERE installation_id = $1 AND message_id = $2
         LIMIT 1`,
        [installationId, messageId],
    );
    return result.rows[0] ?? null;
}

export async function findMessageIdByExternalLink(
    installationId: string,
    externalMessageId: string,
): Promise<string | null> {
    const result = await query<{ message_id: string }>(
        `SELECT message_id FROM ${SCHEMA}.plugin_message_links
         WHERE installation_id = $1 AND external_message_id = $2
         LIMIT 1`,
        [installationId, externalMessageId],
    );
    return result.rows[0]?.message_id ?? null;
}

export async function mergeInstallationSettings(
    installationId: string,
    patch: Record<string, unknown>,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.chat_plugin_installations
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(patch), installationId],
    );
}

export async function findPluginMessageLink(
    installationId: string,
    externalMessageId: string,
): Promise<PluginMessageLinkRow | null> {
    const result = await query<PluginMessageLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_message_links
         WHERE installation_id = $1 AND external_message_id = $2
         LIMIT 1`,
        [installationId, externalMessageId],
    );
    return result.rows[0] ?? null;
}

export async function createPluginMessageLink(input: {
    installationId: string;
    messageId: string;
    externalMessageId: string;
    syncOrigin: PluginMessageSyncOrigin;
}): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.plugin_message_links (installation_id, message_id, external_message_id, sync_origin)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (installation_id, external_message_id) DO NOTHING`,
        [input.installationId, input.messageId, input.externalMessageId, input.syncOrigin],
    );
}
