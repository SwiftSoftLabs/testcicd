import type { MailAccountWithSecret } from "@/lib/email/accounts";
import { providerFetch, providerFetchJson } from "@/lib/email/providers/http";
import type {
  GmailSyncCursor,
  MailFolderKey,
  MailProvider,
  MessageBodyResult,
  SyncCursor,
  SyncMessageInput,
  SyncResult,
  SyncScope,
} from "@/lib/email/providers/types";
import {
  buildSnippet,
  formatAttachmentSize,
} from "@/lib/email/providers/types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const BACKFILL_DAYS = 30;
const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Subject",
  "Date",
  "Message-ID",
].join("&metadataHeaders=");

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
    parts?: GmailMessagePart[];
    mimeType?: string;
    body?: { data?: string; size?: number };
    filename?: string;
  };
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHistoryResponse = {
  history?: Array<{
    id?: string;
    messages?: Array<{ id: string; threadId?: string }>;
    messagesAdded?: Array<{ message: { id: string; threadId?: string } }>;
    messagesDeleted?: Array<{ message: { id: string } }>;
    labelsAdded?: Array<{
      message: { id: string };
      labelIds?: string[];
    }>;
    labelsRemoved?: Array<{
      message: { id: string };
      labelIds?: string[];
    }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

type GmailProfile = { historyId?: string; emailAddress?: string };

function accessToken(account: MailAccountWithSecret): string {
  return account.decryptedPassword;
}

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

function folderFromLabels(labelIds: string[] | undefined): MailFolderKey | null {
  if (!labelIds?.length) return null;
  if (labelIds.includes("DRAFT")) return "drafts";
  if (labelIds.includes("SENT")) return "sent";
  if (labelIds.includes("INBOX")) return "inbox";
  return null;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function messageToSyncInput(msg: GmailMessage): SyncMessageInput | null {
  const folder = folderFromLabels(msg.labelIds);
  if (!folder) return null;

  const headers = msg.payload?.headers;
  const messageIdHeader = headerValue(headers, "Message-ID");
  const externalMessageId =
    messageIdHeader || `gmail:${msg.id}`;
  const receivedAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : headerValue(headers, "Date")
      ? new Date(headerValue(headers, "Date")!).toISOString()
      : new Date().toISOString();

  const snippet = msg.snippet || "";
  const isRead = !msg.labelIds?.includes("UNREAD");
  const isStarred = msg.labelIds?.includes("STARRED") ?? false;
  const isDraft = msg.labelIds?.includes("DRAFT") ?? false;

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
    textBody: buildSnippet(snippet, ""),
    isRead,
    isStarred,
    isDraft,
    receivedAt,
  };
}

async function gmailFetch<T>(
  account: MailAccountWithSecret,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return providerFetchJson<T>(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken(account)}`,
      ...(init?.headers || {}),
    },
  });
}

async function listMessageIds(
  account: MailAccountWithSecret,
  labelId: string,
  since: Date,
): Promise<string[]> {
  const unix = Math.floor(since.getTime() / 1000);
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      labelIds: labelId,
      maxResults: "500",
      q: `after:${unix}`,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await gmailFetch<GmailListResponse>(
      account,
      `/messages?${params.toString()}`,
    );
    for (const msg of data.messages || []) {
      ids.push(msg.id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

async function fetchMessageMetadata(
  account: MailAccountWithSecret,
  messageId: string,
): Promise<GmailMessage | null> {
  try {
    return await gmailFetch<GmailMessage>(
      account,
      `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=${METADATA_HEADERS}`,
    );
  } catch {
    return null;
  }
}

async function fetchMessagesMetadataBatch(
  account: MailAccountWithSecret,
  messageIds: string[],
): Promise<SyncMessageInput[]> {
  const messages: SyncMessageInput[] = [];
  const chunkSize = 20;
  for (let i = 0; i < messageIds.length; i += chunkSize) {
    const chunk = messageIds.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((id) => fetchMessageMetadata(account, id)),
    );
    for (const msg of results) {
      if (!msg) continue;
      const mapped = messageToSyncInput(msg);
      if (mapped) messages.push(mapped);
    }
  }
  return messages;
}

async function fullBackfill(
  account: MailAccountWithSecret,
  cursor: GmailSyncCursor,
): Promise<SyncResult> {
  const since = new Date();
  since.setDate(since.getDate() - BACKFILL_DAYS);

  const [inboxIds, sentIds, draftIds, profile] = await Promise.all([
    listMessageIds(account, "INBOX", since),
    listMessageIds(account, "SENT", since),
    listMessageIds(account, "DRAFT", since),
    gmailFetch<GmailProfile>(account, "/profile"),
  ]);

  const allIds = [...new Set([...inboxIds, ...sentIds, ...draftIds])];
  const messages = await fetchMessagesMetadataBatch(account, allIds);

  return {
    messages,
    cursor: {
      ...cursor,
      historyId: profile.historyId,
      inboxFolder: "INBOX",
      sentFolder: "SENT",
      draftsFolder: "DRAFT",
      lastSyncAt: new Date().toISOString(),
      reconnectRequired: false,
    },
    fullBackfill: true,
  };
}

async function incrementalSync(
  account: MailAccountWithSecret,
  cursor: GmailSyncCursor,
): Promise<SyncResult> {
  const historyId = cursor.historyId;
  if (!historyId) {
    return fullBackfill(account, cursor);
  }

  const changedIds = new Set<string>();
  const deletedIds = new Set<string>();
  let nextPageToken: string | undefined;
  let latestHistoryId = historyId;

  try {
    do {
      const params = new URLSearchParams({
        startHistoryId: historyId,
        historyTypes: "messageAdded",
      });
      params.append("historyTypes", "messageDeleted");
      params.append("historyTypes", "labelAdded");
      params.append("historyTypes", "labelRemoved");
      if (nextPageToken) params.set("pageToken", nextPageToken);

      const data = await gmailFetch<GmailHistoryResponse>(
        account,
        `/history?${params.toString()}`,
      );

      if (data.historyId) latestHistoryId = data.historyId;

      for (const entry of data.history || []) {
        for (const added of entry.messagesAdded || []) {
          changedIds.add(added.message.id);
        }
        for (const msg of entry.messages || []) {
          changedIds.add(msg.id);
        }
        for (const removed of entry.messagesDeleted || []) {
          deletedIds.add(removed.message.id);
          changedIds.delete(removed.message.id);
        }
        for (const labelChange of [
          ...(entry.labelsAdded || []),
          ...(entry.labelsRemoved || []),
        ]) {
          changedIds.add(labelChange.message.id);
        }
      }
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) {
      return fullBackfill(account, cursor);
    }
    throw error;
  }

  const messages = await fetchMessagesMetadataBatch(
    account,
    [...changedIds],
  );

  return {
    messages,
    deletedProviderMessageIds: [...deletedIds],
    cursor: {
      ...cursor,
      historyId: latestHistoryId,
      lastSyncAt: new Date().toISOString(),
      reconnectRequired: false,
    },
  };
}

function collectBodyParts(
  part: GmailMessagePart | undefined,
  out: { html: string; text: string; attachments: MessageBodyResult["attachments"] },
): void {
  if (!part) return;
  const mime = part.mimeType || "";
  const data = part.body?.data;

  if (data && mime === "text/html") {
    out.html = decodeBase64Url(data);
  } else if (data && mime === "text/plain" && !out.text) {
    out.text = decodeBase64Url(data);
  } else if (part.filename && part.body?.attachmentId) {
    out.attachments = out.attachments || [];
    const isIcs =
      mime === "text/calendar" || /\.ics$/i.test(part.filename);
    out.attachments.push({
      name: part.filename,
      size: formatAttachmentSize(part.body.size || 0),
      type: mime || "application/octet-stream",
      icsContent: isIcs && data ? decodeBase64Url(data) : undefined,
    });
  }

  for (const child of part.parts || []) {
    collectBodyParts(child, out);
  }
}

export const gmailApiProvider: MailProvider = {
  async sync(account, cursor, scope): Promise<SyncResult> {
    const gmailCursor = cursor as GmailSyncCursor;
    if (
      scope === "initial" ||
      !gmailCursor.historyId
    ) {
      return fullBackfill(account, gmailCursor);
    }
    return incrementalSync(account, gmailCursor);
  },

  async fetchBody(account, ref) {
    const messageId = ref.providerMessageId;
    if (!messageId) return null;

    const msg = await gmailFetch<GmailMessage>(
      account,
      `/messages/${encodeURIComponent(messageId)}?format=full`,
    );

    const out: {
      html: string;
      text: string;
      attachments: MessageBodyResult["attachments"];
    } = { html: "", text: "", attachments: undefined };

    collectBodyParts(msg.payload, out);

    return {
      htmlBody: out.html,
      textBody: out.text || msg.snippet || "",
      attachments: out.attachments,
    };
  },

  async updateFlags(account, ref, changes) {
    const messageId = ref.providerMessageId;
    if (!messageId) return;

    const add: string[] = [];
    const remove: string[] = [];

    if (changes.isRead === true) remove.push("UNREAD");
    if (changes.isRead === false) add.push("UNREAD");
    if (changes.isStarred === true) add.push("STARRED");
    if (changes.isStarred === false) remove.push("STARRED");

    if (!add.length && !remove.length) return;

    await providerFetch(
      `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken(account)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addLabelIds: add.length ? add : undefined,
          removeLabelIds: remove.length ? remove : undefined,
        }),
      },
    );
  },

  async send(account, input) {
    const nodemailer = (await import("nodemailer")).default;
    const composer = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });

    const info = await composer.sendMail({
      from: account.email_address,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    });

    const rawBuffer = info.message;
    const raw = Buffer.isBuffer(rawBuffer)
      ? rawBuffer.toString("utf8")
      : String(rawBuffer ?? "");

    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await gmailFetch<{ id?: string }>(account, "/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });

    return { messageId: result.id };
  },
};
