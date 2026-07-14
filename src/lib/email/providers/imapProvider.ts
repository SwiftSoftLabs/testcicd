import type { MailAccountWithSecret } from "@/lib/email/accounts";
import {
  fetchMessageBodyByUid,
  fetchRecentMessagesByDate,
  imapConfigFromAccount,
  resolveImapFolderPath,
  updateMessageFlagsOnMailbox,
  type MailFolderPathHints,
} from "@/lib/email/providers/imap";
import { sendViaSmtp, smtpConfigFromAccount } from "@/lib/email/providers/smtp";
import type {
  ImapSyncCursor,
  MailProvider,
  MessageRef,
  SyncCursor,
  SyncResult,
  SyncScope,
} from "@/lib/email/providers/types";

const BACKFILL_DAYS = 30;

function folderHintsFromCursor(
  cursor: SyncCursor,
): Partial<Record<"inbox" | "sent" | "drafts", string>> {
  const c = cursor as ImapSyncCursor;
  return {
    inbox: typeof c.inboxFolder === "string" ? c.inboxFolder : undefined,
    sent: typeof c.sentFolder === "string" ? c.sentFolder : undefined,
    drafts: typeof c.draftsFolder === "string" ? c.draftsFolder : undefined,
  };
}

export const imapProvider: MailProvider = {
  async sync(account, cursor, _scope): Promise<SyncResult> {
    const since = new Date();
    since.setDate(since.getDate() - BACKFILL_DAYS);

    const { messages, folderMap } = await fetchRecentMessagesByDate(
      imapConfigFromAccount(account),
      since,
      folderHintsFromCursor(cursor),
    );

    return {
      messages: messages.map((msg) => ({
        ...msg,
        providerMessageId: msg.externalUid
          ? String(msg.externalUid)
          : undefined,
      })),
      cursor: {
        inboxFolder: folderMap.inbox,
        sentFolder: folderMap.sent,
        draftsFolder: folderMap.drafts,
        lastSyncAt: new Date().toISOString(),
      },
      fullBackfill: true,
    };
  },

  async fetchBody(account, ref) {
    if (!ref.externalUid) return null;
    const folderPath = resolveImapFolderPath(
      ref.folder as "inbox" | "sent" | "drafts",
      folderHintsFromCursor(account.sync_cursor || {}) as MailFolderPathHints,
    );
    if (!folderPath) return null;
    return fetchMessageBodyByUid(
      imapConfigFromAccount(account),
      folderPath,
      Number(ref.externalUid),
    );
  },

  async updateFlags(account, ref, changes) {
    if (!ref.externalUid) return;
    const folderPath = resolveImapFolderPath(
      ref.folder as "inbox" | "sent" | "drafts",
      folderHintsFromCursor(account.sync_cursor || {}) as MailFolderPathHints,
    );
    if (!folderPath) return;
    await updateMessageFlagsOnMailbox(
      imapConfigFromAccount(account),
      folderPath,
      Number(ref.externalUid),
      changes,
    );
  },

  async send(account, input) {
    return sendViaSmtp({
      config: smtpConfigFromAccount(account),
      fromEmail: account.email_address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    });
  },
};
