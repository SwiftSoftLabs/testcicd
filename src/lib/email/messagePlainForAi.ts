import { query, SCHEMA } from "@/lib/db";
import { parseStoredEmailContent } from "@/lib/email/contentMeta";
import { getPrimaryMailAccountWithSecret } from "@/lib/email/accounts";
import { hydrateMailboxMessageBody } from "@/lib/email/providers/mailboxOps";

/** Rough cap on body characters sent to the model (~2.5k tokens) to control cost. */
export const EMAIL_AI_MAX_BODY_CHARS = 10_000;

type MailMessageRow = {
  id: string;
  workspace_id: string | null;
  folder: "inbox" | "sent" | "drafts";
  subject: string;
  html_body: string;
  text_body?: string;
  received_at: string;
  from_json: { name?: string; address?: string };
  external_uid?: number | null;
  provider_message_id?: string | null;
};

function stripHtmlToPlain(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const collapsed = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeBasicEntities(collapsed)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function truncateBody(plain: string): {
  bodyPlain: string;
  bodyTruncated: boolean;
} {
  const t = plain.trim();
  if (t.length <= EMAIL_AI_MAX_BODY_CHARS)
    return { bodyPlain: t || "(no body text)", bodyTruncated: false };
  return {
    bodyPlain: `${t.slice(0, EMAIL_AI_MAX_BODY_CHARS)}\n[…truncated]`,
    bodyTruncated: true,
  };
}

export type OwnedEmailPlainContext = {
  subject: string;
  fromLine: string;
  dateLine: string;
  bodyPlain: string;
  bodyTruncated: boolean;
};

/**
 * Loads one message the user may access (mailbox or internal `emails` row) and
 * returns compact plain text suitable for an LLM.
 */
export async function loadOwnedEmailPlainContext(
  userId: string,
  emailId: string,
): Promise<OwnedEmailPlainContext | null> {
  const mailboxAccount = await getPrimaryMailAccountWithSecret(userId);
  if (mailboxAccount) {
    const single = await query<MailMessageRow>(
      `SELECT id, workspace_id, folder, subject, html_body, text_body, received_at, from_json, external_uid, provider_message_id
         FROM ${SCHEMA}.mail_messages
         WHERE account_id = $1 AND id = $2
         LIMIT 1`,
      [mailboxAccount.id, emailId],
    );
    const row0 = single.rows[0];
    if (!row0) return null;
    let row: MailMessageRow = { ...row0 };

    if (!row.html_body?.trim() && !row.text_body?.trim()) {
      try {
        const hydrated = await hydrateMailboxMessageBody(mailboxAccount, {
          providerMessageId: row.provider_message_id ?? null,
          externalUid: row.external_uid ?? null,
          folder: row.folder,
          htmlBody: row.html_body || "",
        });
        if (hydrated) {
          await query(
            `UPDATE ${SCHEMA}.mail_messages
               SET html_body = $1, text_body = COALESCE(NULLIF($2, ''), text_body), updated_at = NOW()
               WHERE id = $3`,
            [hydrated.htmlBody, hydrated.textBody, row.id],
          );
          row = {
            ...row,
            html_body: hydrated.htmlBody,
            text_body: hydrated.textBody || row.text_body,
          };
        }
      } catch {
        /* keep cached row */
      }
    }

    let plain = (row.text_body || "").trim();
    if (!plain) plain = stripHtmlToPlain(row.html_body || "");
    const addr = row.from_json?.address || "unknown";
    const name = row.from_json?.name?.trim();
    const fromLine = name ? `${name} <${addr}>` : addr;
    const { bodyPlain, bodyTruncated } = truncateBody(plain);
    return {
      subject: (row.subject || "").trim() || "(no subject)",
      fromLine,
      dateLine: row.received_at,
      bodyPlain,
      bodyTruncated,
    };
  }

  type InternalRow = {
    subject: string;
    content: string;
    created_at: string;
    sender_name: string | null;
    sender_email: string | null;
  };

  const internal = await query<InternalRow>(
    `SELECT e.subject, e.content, e.created_at,
            s.full_name AS sender_name, s.email AS sender_email
       FROM ${SCHEMA}.emails e
       LEFT JOIN ${SCHEMA}.profiles s ON s.id = e.sender_id
      WHERE e.id = $1 AND (e.sender_id = $2 OR e.recipient_id = $2)
      LIMIT 1`,
    [emailId, userId],
  );
  const ir = internal.rows[0];
  if (!ir) return null;

  const { bodyHtml } = parseStoredEmailContent(ir.content || "");
  const plain = stripHtmlToPlain(bodyHtml || "");
  const fromLine =
    ir.sender_name && ir.sender_email
      ? `${ir.sender_name} <${ir.sender_email}>`
      : ir.sender_email || ir.sender_name || "Unknown sender";
  const { bodyPlain, bodyTruncated } = truncateBody(plain);
  return {
    subject: (ir.subject || "").trim() || "(no subject)",
    fromLine,
    dateLine: ir.created_at,
    bodyPlain,
    bodyTruncated,
  };
}

/** Combined plain thread for LLM when `thread_id` is present on mailbox messages. */
export type ThreadPlainForAi = {
  combinedUserTurn: string;
  bodyTruncated: boolean;
  messageCount: number;
};

type ThreadPartRow = {
  subject: string;
  html_body: string;
  text_body?: string;
  received_at: string;
  from_json: { name?: string; address?: string };
};

export async function loadThreadPlainForAi(
  userId: string,
  anchorMessageId: string,
): Promise<ThreadPlainForAi | null> {
  const mailboxAccount = await getPrimaryMailAccountWithSecret(userId);
  if (!mailboxAccount) return null;

  const anchorRes = await query<{ thread_id: string | null }>(
    `SELECT thread_id FROM ${SCHEMA}.mail_messages
      WHERE account_id = $1 AND id = $2::uuid
      LIMIT 1`,
    [mailboxAccount.id, anchorMessageId],
  );
  if (!anchorRes.rows[0]) return null;
  const threadId = anchorRes.rows[0].thread_id?.trim();

  if (!threadId) {
    const single = await loadOwnedEmailPlainContext(userId, anchorMessageId);
    if (!single) return null;
    const combined = [
      "Thread (single message — no conversation id from provider):",
      `Subject: ${single.subject}`,
      `From: ${single.fromLine}`,
      `Date: ${single.dateLine}`,
      "",
      single.bodyPlain,
    ].join("\n");
    return {
      combinedUserTurn: combined,
      bodyTruncated: single.bodyTruncated,
      messageCount: 1,
    };
  }

  const rows = await query<ThreadPartRow>(
    `SELECT subject, html_body, text_body, received_at, from_json
       FROM ${SCHEMA}.mail_messages
      WHERE account_id = $1 AND thread_id = $2
      ORDER BY received_at ASC
      LIMIT 30`,
    [mailboxAccount.id, threadId],
  );
  if (!rows.rows.length) return null;

  let totalLen = 0;
  let truncated = false;
  const parts: string[] = [];
  for (const row of rows.rows) {
    let plain = (row.text_body || "").trim();
    if (!plain) plain = stripHtmlToPlain(row.html_body || "");
    const addr = row.from_json?.address || "unknown";
    const name = row.from_json?.name?.trim();
    const fromLine = name ? `${name} <${addr}>` : addr;
    const header = `---\nWhen: ${row.received_at}\nFrom: ${fromLine}\nSubject: ${(row.subject || "").trim() || "(no subject)"}\n`;
    const block = `${header}\n${plain}\n`;
    if (totalLen + block.length > EMAIL_AI_MAX_BODY_CHARS) {
      const room = Math.max(0, EMAIL_AI_MAX_BODY_CHARS - totalLen);
      if (room > 0) parts.push(block.slice(0, room));
      parts.push("\n[…thread truncated…]");
      truncated = true;
      break;
    }
    parts.push(block);
    totalLen += block.length;
  }

  return {
    combinedUserTurn: parts.join("\n"),
    bodyTruncated: truncated,
    messageCount: rows.rows.length,
  };
}
