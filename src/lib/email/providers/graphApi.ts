import type { MailAccountWithSecret } from "@/lib/email/accounts";
import { providerFetch, providerFetchJson } from "@/lib/email/providers/http";
import type {
  GraphSyncCursor,
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
  ReconnectRequiredError,
} from "@/lib/email/providers/types";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const BACKFILL_DAYS = 30;

const FOLDER_CONFIG: Record<
  MailFolderKey,
  { wellKnown: string; cursorKey: MailFolderKey }
> = {
  inbox: { wellKnown: "inbox", cursorKey: "inbox" },
  sent: { wellKnown: "sentitems", cursorKey: "sent" },
  drafts: { wellKnown: "drafts", cursorKey: "drafts" },
};

const SELECT_FIELDS = [
  "id",
  "conversationId",
  "subject",
  "bodyPreview",
  "body",
  "from",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "flag",
  "isDraft",
  "internetMessageId",
  "parentFolderId",
  "hasAttachments",
].join(",");

type GraphRecipient = {
  emailAddress?: { name?: string; address?: string };
};

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  isDraft?: boolean;
  internetMessageId?: string;
  hasAttachments?: boolean;
  "@removed"?: { reason?: string };
};

type GraphListResponse = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

function accessToken(account: MailAccountWithSecret): string {
  return account.decryptedPassword;
}

function graphHeaders(account: MailAccountWithSecret): HeadersInit {
  return { Authorization: `Bearer ${accessToken(account)}` };
}

function mapRecipients(
  recipients: GraphRecipient[] | undefined,
): Array<{ name?: string; address: string }> {
  if (!recipients?.length) return [];
  return recipients
    .map((r) => r.emailAddress)
    .filter((a): a is { name?: string; address: string } =>
      Boolean(a?.address),
    )
    .map((a) => ({
      address: a.address!.toLowerCase(),
      name: a.name?.trim() || undefined,
    }));
}

function mapFrom(
  from: GraphMessage["from"],
): { name?: string; address: string } | null {
  const addr = from?.emailAddress?.address;
  if (!addr) return null;
  return {
    address: addr.toLowerCase(),
    name: from?.emailAddress?.name?.trim() || undefined,
  };
}

function messageToSyncInput(
  msg: GraphMessage,
  folder: MailFolderKey,
): SyncMessageInput | null {
  if (msg["@removed"]) return null;

  const externalMessageId =
    msg.internetMessageId?.trim() || `graph:${msg.id}`;
  const receivedAt =
    msg.receivedDateTime ||
    msg.sentDateTime ||
    new Date().toISOString();

  return {
    externalMessageId,
    providerMessageId: msg.id,
    threadId: msg.conversationId,
    folder,
    from: mapFrom(msg.from),
    to: mapRecipients(msg.toRecipients),
    cc: mapRecipients(msg.ccRecipients),
    bcc: mapRecipients(msg.bccRecipients),
    subject: msg.subject || "",
    htmlBody: "",
    textBody: buildSnippet(msg.bodyPreview || "", ""),
    isRead: Boolean(msg.isRead),
    isStarred: msg.flag?.flagStatus === "flagged",
    isDraft: Boolean(msg.isDraft),
    receivedAt,
  };
}

function handleGraphAuthError(error: unknown): never {
  const status = (error as Error & { status?: number }).status;
  const message = error instanceof Error ? error.message : "";
  if (
    status === 401 ||
    status === 403 ||
    message.toLowerCase().includes("insufficient") ||
    message.toLowerCase().includes("invalid audience")
  ) {
    throw new ReconnectRequiredError(
      "Outlook mailbox must be reconnected to use Microsoft Graph sync.",
    );
  }
  throw error;
}

async function graphFetch<T>(
  account: MailAccountWithSecret,
  url: string,
  init?: RequestInit,
): Promise<T> {
  try {
    if (url.startsWith(GRAPH_BASE)) {
      return await providerFetchJson<T>(url, {
        ...init,
        headers: { ...graphHeaders(account), ...(init?.headers || {}) },
      });
    }
    return await providerFetchJson<T>(url, {
      ...init,
      headers: { ...graphHeaders(account), ...(init?.headers || {}) },
    });
  } catch (error) {
    handleGraphAuthError(error);
  }
}

function isWithinSince(msg: GraphMessage, since: Date): boolean {
  const received = msg.receivedDateTime || msg.sentDateTime;
  if (!received) return true;
  return new Date(received).getTime() >= since.getTime();
}

async function syncFolderDelta(
  account: MailAccountWithSecret,
  folder: MailFolderKey,
  deltaLink: string | undefined,
  since: Date,
  filterBySince: boolean,
): Promise<{
  messages: SyncMessageInput[];
  deletedIds: string[];
  nextDeltaLink?: string;
}> {
  const messages: SyncMessageInput[] = [];
  const deletedIds: string[] = [];
  let url: string;

  if (deltaLink) {
    url = deltaLink;
  } else {
    url = `${GRAPH_BASE}/me/mailFolders/${FOLDER_CONFIG[folder].wellKnown}/messages/delta?$select=${SELECT_FIELDS}`;
  }

  let nextUrl: string | undefined = url;
  let finalDeltaLink: string | undefined;

  while (nextUrl) {
    const currentUrl = nextUrl;
    const data: GraphListResponse = await graphFetch<GraphListResponse>(
      account,
      currentUrl,
    );
    for (const msg of data.value || []) {
      if (msg["@removed"]) {
        deletedIds.push(msg.id);
        continue;
      }
      if (filterBySince && !isWithinSince(msg, since)) continue;
      const mapped = messageToSyncInput(msg, folder);
      if (mapped) messages.push(mapped);
    }
    if (data["@odata.deltaLink"]) {
      finalDeltaLink = data["@odata.deltaLink"];
      nextUrl = undefined;
    } else {
      nextUrl = data["@odata.nextLink"];
    }
  }

  return {
    messages,
    deletedIds,
    nextDeltaLink: finalDeltaLink,
  };
}

async function fullBackfill(
  account: MailAccountWithSecret,
  cursor: GraphSyncCursor,
): Promise<SyncResult> {
  const since = new Date();
  since.setDate(since.getDate() - BACKFILL_DAYS);

  const allMessages: SyncMessageInput[] = [];
  const allDeleted: string[] = [];
  const deltaLinks: Partial<Record<MailFolderKey, string>> = {
    ...(cursor.deltaLinks || {}),
  };

  for (const folder of ["inbox", "sent", "drafts"] as MailFolderKey[]) {
    const result = await syncFolderDelta(
      account,
      folder,
      undefined,
      since,
      true,
    );
    allMessages.push(...result.messages);
    allDeleted.push(...result.deletedIds);
    if (result.nextDeltaLink) {
      deltaLinks[folder] = result.nextDeltaLink;
    }
  }

  return {
    messages: allMessages,
    deletedProviderMessageIds: allDeleted,
    cursor: {
      ...cursor,
      deltaLinks,
      inboxFolder: "inbox",
      sentFolder: "sentitems",
      draftsFolder: "drafts",
      lastSyncAt: new Date().toISOString(),
      reconnectRequired: false,
    },
    fullBackfill: true,
  };
}

async function incrementalSync(
  account: MailAccountWithSecret,
  cursor: GraphSyncCursor,
): Promise<SyncResult> {
  const deltaLinks = cursor.deltaLinks || {};
  const hasAnyDelta = Boolean(
    deltaLinks.inbox || deltaLinks.sent || deltaLinks.drafts,
  );
  if (!hasAnyDelta) {
    return fullBackfill(account, cursor);
  }

  const allMessages: SyncMessageInput[] = [];
  const allDeleted: string[] = [];
  const nextDeltaLinks: Partial<Record<MailFolderKey, string>> = {
    ...deltaLinks,
  };

  for (const folder of ["inbox", "sent", "drafts"] as MailFolderKey[]) {
    const link = deltaLinks[folder];
    if (!link) continue;
    try {
      const result = await syncFolderDelta(
        account,
        folder,
        link,
        new Date(0),
        false,
      );
      allMessages.push(...result.messages);
      allDeleted.push(...result.deletedIds);
      if (result.nextDeltaLink) {
        nextDeltaLinks[folder] = result.nextDeltaLink;
      }
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 410) {
        const since = new Date();
        since.setDate(since.getDate() - BACKFILL_DAYS);
        const fallback = await syncFolderDelta(
          account,
          folder,
          undefined,
          since,
          true,
        );
        allMessages.push(...fallback.messages);
        allDeleted.push(...fallback.deletedIds);
        if (fallback.nextDeltaLink) {
          nextDeltaLinks[folder] = fallback.nextDeltaLink;
        }
        continue;
      }
      throw error;
    }
  }

  return {
    messages: allMessages,
    deletedProviderMessageIds: allDeleted,
    cursor: {
      ...cursor,
      deltaLinks: nextDeltaLinks,
      lastSyncAt: new Date().toISOString(),
      reconnectRequired: false,
    },
  };
}

export const graphApiProvider: MailProvider = {
  async sync(account, cursor, scope): Promise<SyncResult> {
    const graphCursor = cursor as GraphSyncCursor;
    if (scope === "initial" || !graphCursor.deltaLinks) {
      return fullBackfill(account, graphCursor);
    }
    return incrementalSync(account, graphCursor);
  },

  async fetchBody(account, ref) {
    const messageId = ref.providerMessageId;
    if (!messageId) return null;

    const msg = await graphFetch<GraphMessage>(
      account,
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=id,body,bodyPreview,hasAttachments`,
    );

    let htmlBody = "";
    let textBody = msg.bodyPreview || "";
    if (msg.body?.contentType === "html") {
      htmlBody = msg.body.content || "";
    } else if (msg.body?.contentType === "text") {
      textBody = msg.body.content || textBody;
    }

    let attachments: MessageBodyResult["attachments"];
    if (msg.hasAttachments) {
      const attRes = await graphFetch<{
        value?: Array<{
          name?: string;
          contentType?: string;
          size?: number;
        }>;
      }>(
        account,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=name,contentType,size`,
      );
      attachments = (attRes.value || []).map((a) => ({
        name: a.name || "attachment",
        size: formatAttachmentSize(a.size || 0),
        type: a.contentType || "application/octet-stream",
      }));
    }

    return { htmlBody, textBody, attachments };
  },

  async updateFlags(account, ref, changes) {
    const messageId = ref.providerMessageId;
    if (!messageId) return;

    const patch: Record<string, unknown> = {};
    if (typeof changes.isRead === "boolean") {
      patch.isRead = changes.isRead;
    }
    if (typeof changes.isStarred === "boolean") {
      patch.flag = {
        flagStatus: changes.isStarred ? "flagged" : "notFlagged",
      };
    }
    if (!Object.keys(patch).length) return;

    await providerFetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: {
          ...graphHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      },
    );
  },

  async send(account, input) {
    const result = await graphFetch<{ id?: string }>(
      account,
      `${GRAPH_BASE}/me/sendMail`,
      {
        method: "POST",
        headers: {
          ...graphHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: input.subject,
            body: { contentType: "HTML", content: input.html },
            toRecipients: input.to.map((address) => ({
              emailAddress: { address },
            })),
            ccRecipients: (input.cc || []).map((address) => ({
              emailAddress: { address },
            })),
            bccRecipients: (input.bcc || []).map((address) => ({
              emailAddress: { address },
            })),
            from: {
              emailAddress: { address: account.email_address },
            },
          },
          saveToSentItems: true,
        }),
      },
    );
    return { messageId: result.id };
  },
};
