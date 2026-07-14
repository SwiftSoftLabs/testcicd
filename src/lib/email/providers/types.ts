import type { MailAccountWithSecret } from "@/lib/email/accounts";

export type MailFolderKey = "inbox" | "sent" | "drafts";

export type SyncScope = "initial" | "incremental" | "manual";

export type SyncMessageInput = {
  externalMessageId: string;
  providerMessageId?: string;
  externalUid?: number;
  threadId?: string;
  folder: MailFolderKey;
  from: { name?: string; address: string } | null;
  to: Array<{ name?: string; address: string }>;
  cc: Array<{ name?: string; address: string }>;
  bcc: Array<{ name?: string; address: string }>;
  subject: string;
  htmlBody: string;
  textBody: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  receivedAt: string;
};

export type MessageAttachmentMeta = {
  name: string;
  size: string;
  type: string;
  icsContent?: string;
};

export type MessageBodyResult = {
  htmlBody: string;
  textBody: string;
  attachments?: MessageAttachmentMeta[];
};

export type MessageFlagChanges = {
  isRead?: boolean;
  isStarred?: boolean;
};

export type MessageRef = {
  providerMessageId: string | null;
  externalUid: number | null;
  folder: MailFolderKey | string;
};

export type MailSendInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  replyTo?: string;
};

export type SyncCursor = Record<string, unknown>;

export type GmailSyncCursor = {
  historyId?: string;
  inboxFolder?: string;
  sentFolder?: string;
  draftsFolder?: string;
  lastSyncAt?: string;
  reconnectRequired?: boolean;
};

export type GraphSyncCursor = {
  deltaLinks?: Partial<Record<MailFolderKey, string>>;
  inboxFolder?: string;
  sentFolder?: string;
  draftsFolder?: string;
  lastSyncAt?: string;
  reconnectRequired?: boolean;
};

export type ImapSyncCursor = {
  inboxFolder?: string;
  sentFolder?: string;
  draftsFolder?: string;
  lastSyncAt?: string;
};

export type SyncResult = {
  messages: SyncMessageInput[];
  deletedProviderMessageIds?: string[];
  cursor: SyncCursor;
  fullBackfill?: boolean;
};

export class ReconnectRequiredError extends Error {
  constructor(message = "Mailbox reconnect required") {
    super(message);
    this.name = "ReconnectRequiredError";
  }
}

export interface MailProvider {
  sync(
    account: MailAccountWithSecret,
    cursor: SyncCursor,
    scope: SyncScope,
  ): Promise<SyncResult>;
  fetchBody(
    account: MailAccountWithSecret,
    ref: MessageRef,
  ): Promise<MessageBodyResult | null>;
  updateFlags(
    account: MailAccountWithSecret,
    ref: MessageRef,
    changes: MessageFlagChanges,
  ): Promise<void>;
  send(
    account: MailAccountWithSecret,
    input: MailSendInput,
  ): Promise<{ messageId?: string }>;
}

export function buildSnippet(textBody: string, htmlBody: string): string {
  const stripHtml = (html: string) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const source = (textBody || "").trim() || stripHtml(htmlBody || "");
  if (!source) return "";
  return source.slice(0, 1000);
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 ** 2) {
    const mb = sizeBytes / 1024 ** 2;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  if (sizeBytes >= 1024) {
    const kb = sizeBytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${sizeBytes} B`;
}
