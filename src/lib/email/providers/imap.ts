import type { MailAccountWithSecret } from "@/lib/email/accounts";

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  accessToken?: string;
};

export function imapConfigFromAccount(
  account: MailAccountWithSecret,
): ImapConfig {
  if (account.auth_method === "oauth") {
    return {
      host: account.imap_host,
      port: Number(account.imap_port),
      secure: Boolean(account.imap_secure),
      username: account.username,
      accessToken: account.decryptedPassword,
    };
  }
  return {
    host: account.imap_host,
    port: Number(account.imap_port),
    secure: Boolean(account.imap_secure),
    username: account.username,
    password: account.decryptedPassword,
  };
}

function imapFlowAuth(config: ImapConfig): {
  user: string;
  pass?: string;
  accessToken?: string;
} {
  if (config.accessToken) {
    return { user: config.username, accessToken: config.accessToken };
  }
  if (!config.password) {
    throw new Error("IMAP password or access token required");
  }
  return { user: config.username, pass: config.password };
}

export type MailFolderKey = "inbox" | "sent" | "drafts";

export type SyncMessage = {
  externalMessageId: string;
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

export type MailFolderPathHints = Partial<Record<MailFolderKey, string>>;

export function resolveImapFolderPath(
  folder: MailFolderKey | string,
  folderHints: MailFolderPathHints = {},
): string | null {
  if (folder === "inbox") return folderHints.inbox || "INBOX";
  if (folder === "sent") return folderHints.sent || null;
  if (folder === "drafts") return folderHints.drafts || null;
  return null;
}

function messageHasFlag(flags: unknown, flag: string): boolean {
  if (flags instanceof Set) return flags.has(flag);
  if (Array.isArray(flags)) return flags.includes(flag);
  return false;
}

export type ImapMessageFlagChanges = {
  isRead?: boolean;
  isStarred?: boolean;
};

export async function updateMessageFlagsOnMailbox(
  config: ImapConfig,
  folderPath: string,
  uid: number,
  changes: ImapMessageFlagChanges,
): Promise<void> {
  if (changes.isRead === undefined && changes.isStarred === undefined) return;

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: imapFlowAuth(config),
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folderPath);
    try {
      const storeOptions = { uid: true as const };

      if (changes.isRead === true) {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], storeOptions);
      } else if (changes.isRead === false) {
        await client.messageFlagsRemove(String(uid), ["\\Seen"], storeOptions);
      }

      if (changes.isStarred === true) {
        await client.messageFlagsAdd(String(uid), ["\\Flagged"], storeOptions);
      } else if (changes.isStarred === false) {
        await client.messageFlagsRemove(String(uid), ["\\Flagged"], storeOptions);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

type ParsedAttachment = {
  name: string;
  size: string;
  type: string;
  icsContent?: string;
};

function formatAttachmentSize(sizeBytes: number): string {
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

async function parseMimeSource(source: Buffer): Promise<{
  subject?: string;
  htmlBody: string;
  textBody: string;
  from: { name?: string; address: string } | null;
  to: Array<{ name?: string; address: string }>;
  cc: Array<{ name?: string; address: string }>;
  bcc: Array<{ name?: string; address: string }>;
  date?: string;
  messageId?: string;
  attachments?: ParsedAttachment[];
}> {
  const { simpleParser } = await import("mailparser");
  // skipHtmlToText: when html-to-text throws on complex HTML (common for marketing /
  // verification templates), mailparser would drop the raw HTML and only keep linkified
  // plain text — which matches broken rendering like `Label [https://...]`.
  const parsed = await simpleParser(source, {
    skipHtmlToText: true,
    maxHtmlLengthToParse: 256 * 1024 * 1024,
  });

  const toList = (addr: any): Array<{ name?: string; address: string }> => {
    if (!addr?.value || !Array.isArray(addr.value)) return [];
    return addr.value
      .filter(
        (entry: any) =>
          typeof entry?.address === "string" && entry.address.length > 0,
      )
      .map((entry: any) => ({
        address: entry.address,
        name:
          typeof entry?.name === "string" && entry.name.length > 0
            ? entry.name
            : undefined,
      }));
  };

  const fromEntry = parsed.from?.value?.find(
    (entry: any) =>
      typeof entry?.address === "string" && entry.address.length > 0,
  );
  const from = fromEntry
    ? {
        address: fromEntry.address as string,
        name:
          typeof fromEntry?.name === "string" && fromEntry.name.length > 0
            ? fromEntry.name
            : undefined,
      }
    : null;
  const attachments: ParsedAttachment[] = parsed.attachments.map(
    (attachment) => {
      const name = attachment.filename || "attachment";
      const type = attachment.contentType || "application/octet-stream";
      const isIcs = type === "text/calendar" || /\.ics$/i.test(name);
      return {
        name,
        size: formatAttachmentSize(
          attachment.size || attachment.content.length || 0,
        ),
        type,
        icsContent: isIcs ? attachment.content.toString("utf-8") : undefined,
      };
    },
  );

  const rawHtml = parsed.html as string | Buffer | false | undefined;
  let htmlBody = "";
  if (typeof rawHtml === "string") htmlBody = rawHtml;
  else if (Buffer.isBuffer(rawHtml)) htmlBody = rawHtml.toString("utf8");

  const textAsHtml = (parsed as { textAsHtml?: string | false }).textAsHtml;
  if (!htmlBody.trim() && typeof textAsHtml === "string" && textAsHtml.trim()) {
    htmlBody = textAsHtml.trim();
  }

  return {
    subject: parsed.subject || undefined,
    htmlBody,
    textBody: parsed.text || "",
    from,
    to: toList(parsed.to),
    cc: toList(parsed.cc),
    bcc: toList(parsed.bcc),
    date: parsed.date ? parsed.date.toISOString() : undefined,
    messageId: parsed.messageId || undefined,
    attachments,
  };
}

export async function verifyImapConnection(config: ImapConfig): Promise<void> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: imapFlowAuth(config),
  });

  try {
    await client.connect();
    await client.getMailboxLock("INBOX").then((lock) => lock.release());
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function detectFolder(path: string): MailFolderKey | null {
  const lower = path.toLowerCase();
  if (lower === "inbox") return "inbox";
  if (lower.includes("sent")) return "sent";
  if (lower.includes("draft")) return "drafts";
  return null;
}

function flattenAddresses(
  value: unknown,
): Array<{ name?: string; address: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name?: string; address: string }> = [];
  for (const group of value as any[]) {
    const entries = Array.isArray(group) ? group : [group];
    for (const item of entries) {
      if (item?.address && typeof item.address === "string") {
        out.push({
          address: item.address,
          name: typeof item.name === "string" ? item.name : undefined,
        });
      }
    }
  }
  return out;
}

export async function fetchRecentMessagesByDate(
  config: ImapConfig,
  since: Date,
  folderHints: Partial<Record<MailFolderKey, string>> = {},
): Promise<{
  messages: SyncMessage[];
  folderMap: Partial<Record<MailFolderKey, string>>;
}> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: imapFlowAuth(config),
  });

  const folderMap: Partial<Record<MailFolderKey, string>> = {
    inbox: folderHints.inbox || "INBOX",
    sent: folderHints.sent,
    drafts: folderHints.drafts,
  };
  const messages: SyncMessage[] = [];

  try {
    await client.connect();

    const listing = await client.list();
    for (const box of listing) {
      const folder = detectFolder(box.path);
      if (folder && !folderMap[folder]) {
        folderMap[folder] = box.path;
      }
    }

    for (const key of ["inbox", "sent", "drafts"] as MailFolderKey[]) {
      const mailboxPath = folderMap[key];
      if (!mailboxPath) continue;
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        let sequence = await client.search({ since });
        if (sequence === false || sequence.length === 0) {
          // Some providers/folders can return empty for SINCE even when mail exists.
          // Fallback to ALL and cap to recent tail for predictable sync cost.
          const allSequence = await client.search({ all: true });
          if (allSequence === false || allSequence.length === 0) continue;
          sequence = allSequence.slice(-500);
        }

        for await (const message of client.fetch(sequence, {
          uid: true,
          envelope: true,
          bodyStructure: true,
          flags: true,
          source: true,
        })) {
          const envelope = message.envelope;
          const source = message.source || Buffer.from("");
          const mime = source.length > 0 ? await parseMimeSource(source) : null;

          const msgId =
            mime?.messageId ||
            envelope?.messageId ||
            `${mailboxPath}:${message.uid}`;
          const received =
            mime?.date ||
            (envelope?.date
              ? new Date(envelope.date).toISOString()
              : new Date().toISOString());
          const parsedTo = mime?.to?.length
            ? mime.to
            : flattenAddresses(envelope?.to);
          const parsedCc = mime?.cc?.length
            ? mime.cc
            : flattenAddresses(envelope?.cc);
          const parsedBcc = mime?.bcc?.length
            ? mime.bcc
            : flattenAddresses(envelope?.bcc);
          const parsedFrom =
            mime?.from || flattenAddresses(envelope?.from)[0] || null;
          const htmlBody = mime?.htmlBody || "";
          const textBody = mime?.textBody || "";
          const subject = mime?.subject || envelope?.subject || "";
          const receivedDate = new Date(received);
          if (Number.isFinite(receivedDate.getTime()) && receivedDate < since) {
            continue;
          }

          messages.push({
            externalMessageId: msgId,
            externalUid: message.uid || undefined,
            threadId: envelope?.inReplyTo || undefined,
            folder: key,
            from: parsedFrom,
            to: parsedTo,
            cc: parsedCc,
            bcc: parsedBcc,
            subject,
            htmlBody,
            textBody,
            isRead: messageHasFlag(message.flags, "\\Seen"),
            isStarred: messageHasFlag(message.flags, "\\Flagged"),
            isDraft: messageHasFlag(message.flags, "\\Draft"),
            receivedAt: received,
          });
        }
      } finally {
        lock.release();
      }
    }

    if (messages.length === 0) {
      const inboxPath = folderMap.inbox || "INBOX";
      const lock = await client.getMailboxLock(inboxPath);
      try {
        const allSequence = await client.search({ all: true });
        if (allSequence && allSequence.length > 0) {
          const fallbackSeq = allSequence.slice(-200);
          for await (const message of client.fetch(fallbackSeq, {
            uid: true,
            envelope: true,
            flags: true,
            source: true,
          })) {
            const envelope = message.envelope;
            const source = message.source || Buffer.from("");
            const mime =
              source.length > 0 ? await parseMimeSource(source) : null;
            const received =
              mime?.date ||
              (envelope?.date
                ? new Date(envelope.date).toISOString()
                : new Date().toISOString());
            const receivedDate = new Date(received);
            if (Number.isFinite(receivedDate.getTime()) && receivedDate < since)
              continue;

            const msgId =
              mime?.messageId ||
              envelope?.messageId ||
              `${inboxPath}:${message.uid}`;
            messages.push({
              externalMessageId: msgId,
              externalUid: message.uid || undefined,
              threadId: envelope?.inReplyTo || undefined,
              folder: "inbox",
              from: mime?.from || flattenAddresses(envelope?.from)[0] || null,
              to: mime?.to?.length ? mime.to : flattenAddresses(envelope?.to),
              cc: mime?.cc?.length ? mime.cc : flattenAddresses(envelope?.cc),
              bcc: mime?.bcc?.length
                ? mime.bcc
                : flattenAddresses(envelope?.bcc),
              subject: mime?.subject || envelope?.subject || "",
              htmlBody: mime?.htmlBody || "",
              textBody: mime?.textBody || "",
              isRead: messageHasFlag(message.flags, "\\Seen"),
              isStarred: messageHasFlag(message.flags, "\\Flagged"),
              isDraft: messageHasFlag(message.flags, "\\Draft"),
              receivedAt: received,
            });
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { messages, folderMap };
}

export async function fetchMessageBodyByUid(
  config: ImapConfig,
  folderPath: string,
  uid: number,
): Promise<{
  htmlBody: string;
  textBody: string;
  attachments?: ParsedAttachment[];
} | null> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: imapFlowAuth(config),
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folderPath);
    try {
      const fetched = await client.fetchOne(
        uid,
        { source: true },
        { uid: true },
      );
      if (!fetched) return null;
      const source = fetched.source || null;
      if (!source) return null;
      const parsed = await parseMimeSource(source);
      return {
        htmlBody: parsed.htmlBody || "",
        textBody: parsed.textBody || "",
        attachments: parsed.attachments,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
