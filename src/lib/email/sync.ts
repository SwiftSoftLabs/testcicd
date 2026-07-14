import { SCHEMA, query } from "@/lib/db";
import {
  createMailAuditEvent,
  MailAccountWithSecret,
} from "@/lib/email/accounts";
import { resolveMailProvider } from "@/lib/email/providers/registry";
import type {
  SyncMessageInput,
  SyncScope,
} from "@/lib/email/providers/types";
import { ReconnectRequiredError } from "@/lib/email/providers/types";
import { ensureEmailAccountScopedSchema } from "@/lib/email/schema";

const UPSERT_BATCH_SIZE = 100;

async function upsertMessagesBatch(
  accountId: string,
  messages: SyncMessageInput[],
): Promise<void> {
  if (!messages.length) return;

  for (let i = 0; i < messages.length; i += UPSERT_BATCH_SIZE) {
    const batch = messages.slice(i, i + UPSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((msg, idx) => {
      const base = idx * 18;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, $${base + 9}::jsonb, $${base + 10}::jsonb, $${base + 11}::jsonb, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18})`,
      );
      values.push(
        accountId,
        null,
        msg.externalMessageId,
        msg.providerMessageId ?? null,
        msg.externalUid ?? null,
        msg.folder,
        msg.threadId ?? null,
        JSON.stringify(msg.from || {}),
        JSON.stringify(msg.to),
        JSON.stringify(msg.cc),
        JSON.stringify(msg.bcc),
        msg.subject,
        msg.htmlBody || "",
        msg.textBody,
        msg.isRead,
        msg.isStarred,
        msg.isDraft,
        msg.receivedAt,
      );
    });

    await query(
      `INSERT INTO ${SCHEMA}.mail_messages (
                account_id, workspace_id, external_message_id, provider_message_id,
                external_uid, folder, thread_id,
                from_json, to_json, cc_json, bcc_json, subject, html_body, text_body,
                is_read, is_starred, is_draft, received_at
             ) VALUES ${placeholders.join(", ")}
             ON CONFLICT (account_id, external_message_id)
             DO UPDATE SET
                provider_message_id = COALESCE(EXCLUDED.provider_message_id, ${SCHEMA}.mail_messages.provider_message_id),
                external_uid = COALESCE(EXCLUDED.external_uid, ${SCHEMA}.mail_messages.external_uid),
                folder = EXCLUDED.folder,
                thread_id = EXCLUDED.thread_id,
                from_json = EXCLUDED.from_json,
                to_json = EXCLUDED.to_json,
                cc_json = EXCLUDED.cc_json,
                bcc_json = EXCLUDED.bcc_json,
                subject = EXCLUDED.subject,
                html_body = CASE
                  WHEN ${SCHEMA}.mail_messages.html_body IS NOT NULL
                       AND TRIM(${SCHEMA}.mail_messages.html_body) <> ''
                  THEN ${SCHEMA}.mail_messages.html_body
                  ELSE EXCLUDED.html_body
                END,
                text_body = EXCLUDED.text_body,
                is_read = EXCLUDED.is_read,
                is_starred = EXCLUDED.is_starred,
                is_draft = EXCLUDED.is_draft,
                received_at = EXCLUDED.received_at,
                updated_at = NOW()`,
      values,
    );
  }
}

async function deleteMessagesByProviderIds(
  accountId: string,
  providerMessageIds: string[],
): Promise<void> {
  if (!providerMessageIds.length) return;
  await query(
    `DELETE FROM ${SCHEMA}.mail_messages
         WHERE account_id = $1
           AND provider_message_id = ANY($2::text[])`,
    [accountId, providerMessageIds],
  );
}

export async function runMailboxSync(
  account: MailAccountWithSecret,
  workspaceId: string | null | undefined,
  scope: SyncScope,
): Promise<{ synced: number }> {
  await ensureEmailAccountScopedSchema();

  const runRes = await query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.mail_sync_runs (account_id, status, scope)
         VALUES ($1, 'running', $2)
         RETURNING id`,
    [account.id, scope],
  );
  const runId = runRes.rows[0].id;

  const provider = resolveMailProvider(account);
  const effectiveScope: SyncScope =
    scope === "manual" && account.sync_cursor
      ? "incremental"
      : scope;

  try {
    const result = await provider.sync(
      account,
      account.sync_cursor || {},
      effectiveScope,
    );

    await upsertMessagesBatch(account.id, result.messages);
    await deleteMessagesByProviderIds(
      account.id,
      result.deletedProviderMessageIds || [],
    );

    await query(
      `UPDATE ${SCHEMA}.mail_accounts
             SET
                status = 'connected',
                last_sync_at = NOW(),
                sync_cursor = $1::jsonb,
                updated_at = NOW()
             WHERE id = $2`,
      [JSON.stringify(result.cursor), account.id],
    );

    await query(
      `UPDATE ${SCHEMA}.mail_sync_runs
             SET status = 'success', messages_synced = $1, finished_at = NOW()
             WHERE id = $2`,
      [result.messages.length, runId],
    );

    return { synced: result.messages.length };
  } catch (error) {
    if (error instanceof ReconnectRequiredError) {
      await query(
        `UPDATE ${SCHEMA}.mail_accounts
               SET status = 'error',
                   sync_cursor = COALESCE(sync_cursor, '{}'::jsonb) || '{"reconnectRequired":true}'::jsonb,
                   updated_at = NOW()
               WHERE id = $1`,
        [account.id],
      );
      await createMailAuditEvent(
        account.user_id,
        account.id,
        "MAIL_RECONNECT_REQUIRED",
        { reason: error.message, workspaceId },
      );
    } else {
      await query(
        `UPDATE ${SCHEMA}.mail_accounts
               SET status = 'error', updated_at = NOW()
               WHERE id = $1`,
        [account.id],
      );
    }

    await query(
      `UPDATE ${SCHEMA}.mail_sync_runs
             SET status = 'failed', finished_at = NOW(), error_text = $1
             WHERE id = $2`,
      [error instanceof Error ? error.message : "Mailbox sync failed", runId],
    );
    throw error;
  }
}
