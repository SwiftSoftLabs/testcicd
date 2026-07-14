import type { MailFolderKey, SyncMessageInput } from "@/lib/email/providers/types";
import { buildSnippet } from "@/lib/email/providers/types";

type GmailHeader = { name?: string; value?: string };

export type GmailMessageLike = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
};

export type GraphMessageLike = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{
    emailAddress?: { name?: string; address?: string };
  }>;
  ccRecipients?: Array<{
    emailAddress?: { name?: string; address?: string };
  }>;
  bccRecipients?: Array<{
    emailAddress?: { name?: string; address?: string };
  }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  isDraft?: boolean;
  internetMessageId?: string;
  "@removed"?: { reason?: string };
};

function headerValue(
  headers: GmailHeader[] | undefined,
  name: string,
): string | undefined {
  const found = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value?.trim() || undefined;
}

function parseAddressList(
  raw: string | undefined,
): Array<{ name?: string; address: string }> {
  if (!raw?.trim()) return [];
  const out: Array<{ name?: string; address: string }> = [];
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
    if (match) {
      out.push({
        name: match[1]?.trim() || undefined,
        address: match[2].trim().toLowerCase(),
      });
    } else if (trimmed.includes("@")) {
      out.push({ address: trimmed.replace(/^<|>$/g, "").toLowerCase() });
    }
  }
  return out;
}

function parseFromHeader(
  raw: string | undefined,
): { name?: string; address: string } | null {
  const list = parseAddressList(raw);
  return list[0] ?? null;
}

export function gmailFolderFromLabels(
  labelIds: string[] | undefined,
): MailFolderKey | null {
  if (!labelIds?.length) return null;
  if (labelIds.includes("DRAFT")) return "drafts";
  if (labelIds.includes("SENT")) return "sent";
  if (labelIds.includes("INBOX")) return "inbox";
  return null;
}

export function mapGmailMessageToSyncInput(
  msg: GmailMessageLike,
): SyncMessageInput | null {
  const folder = gmailFolderFromLabels(msg.labelIds);
  if (!folder) return null;

  const headers = msg.payload?.headers;
  const messageIdHeader = headerValue(headers, "Message-ID");
  const externalMessageId = messageIdHeader || `gmail:${msg.id}`;
  const receivedAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : headerValue(headers, "Date")
      ? new Date(headerValue(headers, "Date")!).toISOString()
      : new Date().toISOString();

  return {
    externalMessageId,
    providerMessageId: msg.id,
    threadId: msg.threadId,
    folder,
    from: parseFromHeader(headerValue(headers, "From")),
    to: parseAddressList(headerValue(headers, "To")),
    cc: parseAddressList(headerValue(headers, "Cc")),
    bcc: parseAddressList(headerValue(headers, "Bcc")),
    subject: headerValue(headers, "Subject") || "",
    htmlBody: "",
    textBody: buildSnippet(msg.snippet || "", ""),
    isRead: !msg.labelIds?.includes("UNREAD"),
    isStarred: msg.labelIds?.includes("STARRED") ?? false,
    isDraft: msg.labelIds?.includes("DRAFT") ?? false,
    receivedAt,
  };
}

function mapGraphRecipients(
  recipients: GraphMessageLike["toRecipients"],
): Array<{ name?: string; address: string }> {
  if (!recipients?.length) return [];
  return recipients
    .map((r) => r.emailAddress)
    .filter((a): a is { name?: string; address: string } => Boolean(a?.address))
    .map((a) => ({
      address: a.address!.toLowerCase(),
      name: a.name?.trim() || undefined,
    }));
}

export function mapGraphMessageToSyncInput(
  msg: GraphMessageLike,
  folder: MailFolderKey,
): SyncMessageInput | null {
  if (msg["@removed"]) return null;

  const externalMessageId =
    msg.internetMessageId?.trim() || `graph:${msg.id}`;

  return {
    externalMessageId,
    providerMessageId: msg.id,
    threadId: msg.conversationId,
    folder,
    from: msg.from?.emailAddress?.address
      ? {
          address: msg.from.emailAddress.address.toLowerCase(),
          name: msg.from.emailAddress.name?.trim() || undefined,
        }
      : null,
    to: mapGraphRecipients(msg.toRecipients),
    cc: mapGraphRecipients(msg.ccRecipients),
    bcc: mapGraphRecipients(msg.bccRecipients),
    subject: msg.subject || "",
    htmlBody: "",
    textBody: buildSnippet(msg.bodyPreview || "", ""),
    isRead: Boolean(msg.isRead),
    isStarred: msg.flag?.flagStatus === "flagged",
    isDraft: Boolean(msg.isDraft),
    receivedAt:
      msg.receivedDateTime ||
      msg.sentDateTime ||
      new Date().toISOString(),
  };
}

export function shouldGmailFullBackfill(error: unknown): boolean {
  return (error as Error & { status?: number }).status === 404;
}

export function shouldGraphDeltaReset(error: unknown): boolean {
  return (error as Error & { status?: number }).status === 410;
}
