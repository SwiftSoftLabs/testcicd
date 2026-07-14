import {
  query,
  buildInsert,
  buildSet,
  getUserFromRequest,
  SCHEMA,
} from "@/lib/db";
import { assertMailAccountWritable } from "@/lib/billing/quota-locks";
import { sendExternalEmail } from "@/lib/email/delivery";
import {
  buildStoredContent,
  parseStoredEmailContent,
} from "@/lib/email/contentMeta";
import { getPrimaryMailAccountWithSecret } from "@/lib/email/accounts";
import { runMailboxSync } from "@/lib/email/sync";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import {
  hydrateMailboxMessageBody,
  pushMailboxFlagChangesViaProvider,
} from "@/lib/email/providers/mailboxOps";
import { ensureEmailAccountScopedSchema } from "@/lib/email/schema";
import { getDigestSummaryByMessageIds } from "@/lib/email/emailAiService";
import { plainTextToMinimalHtml } from "@/lib/email/escapeHtml";
import { NextResponse } from "next/server";
import { toAccessResponse } from "@/lib/rbac/http";
import { requireEmailWorkspaceAccess } from "@/lib/rbac/email-access";
import { WorkspaceAccessError } from "@/lib/rbac/workspace-access";

export const runtime = "nodejs";

function emailAccessResponse(e: unknown) {
  const access = toAccessResponse(e);
  if (access) return access;
  if (e instanceof WorkspaceAccessError) {
    const status = e.message === "Unauthorized" ? 401 : 403;
    return NextResponse.json({ error: e.message }, { status });
  }
  return null;
}

type EmailPostPayload = {
  workspace_id: string | null;
  recipient_id?: string;
  recipient_email?: string;
  subject?: string;
  content?: string;
  is_draft?: boolean;
  is_read?: boolean;
  is_starred?: boolean;
  is_archived?: boolean;
};

type EmailPatchPayload = Partial<EmailPostPayload> & {
  snoozed_until?: string | null;
};
type EmailPatchControl = { retry_delivery?: boolean };

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function parseJsonBody(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parsePostPayload(raw: unknown): {
  data?: EmailPostPayload;
  error?: string;
} {
  const body = parseJsonBody(raw);
  if (!body) return { error: "Invalid JSON body" };

  const workspace_id =
    typeof body.workspace_id === "string" && body.workspace_id.trim()
      ? body.workspace_id.trim()
      : null;

  const is_draft = Boolean(body.is_draft);
  const recipient_id =
    typeof body.recipient_id === "string"
      ? body.recipient_id.trim()
      : undefined;
  const recipient_email =
    typeof body.recipient_email === "string"
      ? body.recipient_email.trim().toLowerCase()
      : undefined;
  const subject =
    typeof body.subject === "string" ? body.subject.trim() : undefined;
  const content = typeof body.content === "string" ? body.content : undefined;
  const is_read = typeof body.is_read === "boolean" ? body.is_read : false;
  const is_starred =
    typeof body.is_starred === "boolean" ? body.is_starred : false;
  const is_archived =
    typeof body.is_archived === "boolean" ? body.is_archived : false;

  if (!is_draft && !recipient_id && !recipient_email)
    return {
      error: "recipient_id or recipient_email is required for sent email",
    };
  if (!subject) return { error: "subject is required" };
  if (typeof content !== "string" || !content.trim())
    return { error: "content is required" };

  return {
    data: {
      workspace_id,
      recipient_id,
      recipient_email,
      subject,
      content,
      is_draft,
      is_read,
      is_starred,
      is_archived,
    },
  };
}

function parsePatchPayload(raw: unknown): {
  data?: EmailPatchPayload;
  control?: EmailPatchControl;
  error?: string;
} {
  const body = parseJsonBody(raw);
  if (!body) return { error: "Invalid JSON body" };

  const allowed: EmailPatchPayload = {};
  const allowedKeys = new Set([
    "workspace_id",
    "recipient_id",
    "recipient_email",
    "subject",
    "content",
    "is_draft",
    "is_read",
    "is_starred",
    "is_archived",
    "snoozed_until",
    "retry_delivery",
  ]);
  const control: EmailPatchControl = {};

  if ("retry_delivery" in body) {
    if (typeof body.retry_delivery !== "boolean")
      return { error: "retry_delivery must be boolean" };
    control.retry_delivery = body.retry_delivery;
  }

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) return { error: `Unsupported field: ${key}` };
  }

  if ("workspace_id" in body) {
    if (body.workspace_id !== null && typeof body.workspace_id !== "string")
      return { error: "workspace_id must be a string or null" };
    const workspaceId =
      typeof body.workspace_id === "string" ? body.workspace_id.trim() : null;
    allowed.workspace_id = workspaceId || null;
  }
  if ("recipient_id" in body) {
    if (typeof body.recipient_id !== "string" || !body.recipient_id.trim())
      return { error: "recipient_id must be a non-empty string" };
    allowed.recipient_id = body.recipient_id.trim();
  }
  if ("recipient_email" in body) {
    if (
      typeof body.recipient_email !== "string" ||
      !body.recipient_email.trim()
    )
      return { error: "recipient_email must be a non-empty string" };
    allowed.recipient_email = body.recipient_email.trim().toLowerCase();
  }
  if ("subject" in body) {
    if (typeof body.subject !== "string" || !body.subject.trim())
      return { error: "subject must be a non-empty string" };
    allowed.subject = body.subject.trim();
  }
  if ("content" in body) {
    if (typeof body.content !== "string" || !body.content.trim())
      return { error: "content must be a non-empty string" };
    allowed.content = body.content;
  }
  if ("is_draft" in body) {
    if (typeof body.is_draft !== "boolean")
      return { error: "is_draft must be boolean" };
    allowed.is_draft = body.is_draft;
  }
  if ("is_read" in body) {
    if (typeof body.is_read !== "boolean")
      return { error: "is_read must be boolean" };
    allowed.is_read = body.is_read;
  }
  if ("is_starred" in body) {
    if (typeof body.is_starred !== "boolean")
      return { error: "is_starred must be boolean" };
    allowed.is_starred = body.is_starred;
  }
  if ("is_archived" in body) {
    if (typeof body.is_archived !== "boolean")
      return { error: "is_archived must be boolean" };
    allowed.is_archived = body.is_archived;
  }
  if ("snoozed_until" in body) {
    if (body.snoozed_until === null) {
      allowed.snoozed_until = null;
    } else if (typeof body.snoozed_until === "string") {
      const parsed = new Date(body.snoozed_until);
      if (Number.isNaN(parsed.getTime()))
        return { error: "snoozed_until must be a valid ISO datetime" };
      if (parsed.getTime() <= Date.now())
        return { error: "snoozed_until must be in the future" };
      allowed.snoozed_until = parsed.toISOString();
    } else {
      return { error: "snoozed_until must be an ISO datetime or null" };
    }
  }

  if (Object.keys(allowed).length === 0 && !control.retry_delivery)
    return { error: "No valid fields supplied" };
  return { data: allowed, control };
}

type EmailRow = Record<string, unknown> & {
  id: string;
  workspace_id: string | null;
  recipient_id: string;
  subject: string;
  content: string;
  sender_id: string;
  is_draft: boolean;
};

type MailMessageRow = {
  id: string;
  workspace_id: string | null;
  folder: "inbox" | "sent" | "drafts";
  subject: string;
  html_body: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  snoozed_until?: string | null;
  from_json: { name?: string; address?: string };
  to_json: Array<{ name?: string; address?: string }>;
  external_uid?: number | null;
  provider_message_id?: string | null;
  text_body?: string;
  thread_id?: string | null;
};

async function resolveProfileEmails(
  ids: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const result = await query<{ id: string; email: string }>(
    `SELECT id, email FROM ${SCHEMA}.profiles WHERE id = ANY($1::uuid[])`,
    [uniqueIds],
  );

  const map = new Map<string, string>();
  for (const row of result.rows) {
    if (row.id && row.email?.trim()) map.set(row.id, row.email.trim());
  }
  return map;
}

async function getLatestActiveMailAccountId(userId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id
       FROM ${SCHEMA}.mail_accounts
      WHERE user_id = $1
        AND status <> 'disconnected'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.id ?? null;
}

function normalizeEmailToken(token: string): string | null {
  const value = token.trim().toLowerCase();
  if (!value) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  return null;
}

async function attemptExternalDelivery(
  email: EmailRow,
  senderReplyTo?: string,
): Promise<{ status: "sent" | "failed"; content: string; error?: string }> {
  const parsed = parseStoredEmailContent(email.content || "");
  const bodyHtml = parsed.bodyHtml || "<p></p>";
  const meta = parsed.meta;
  const recipientIds = [email.recipient_id, ...meta.cc, ...meta.bcc].filter(
    Boolean,
  );
  const profileEmails = await resolveProfileEmails(recipientIds);

  const to = [profileEmails.get(email.recipient_id)].filter((v): v is string =>
    Boolean(v),
  );
  const cc = meta.cc
    .map((id: string) => profileEmails.get(id))
    .filter((v): v is string => Boolean(v));
  const bcc = meta.bcc
    .map((id: string) => profileEmails.get(id))
    .filter((v): v is string => Boolean(v));

  const senderMailbox = await getPrimaryMailAccountWithSecret(email.sender_id);
  const delivery = await sendExternalEmail({
    to,
    cc,
    bcc,
    subject: email.subject,
    html: bodyHtml,
    replyTo: senderReplyTo,
    mailbox: senderMailbox,
  });

  const nextMeta = {
    ...meta,
    delivery:
      delivery.status === "sent"
        ? {
            status: "sent" as const,
            providerMessageId: delivery.providerMessageId,
            attemptedAt: delivery.attemptedAt,
          }
        : {
            status: "failed" as const,
            error: delivery.error,
            attemptedAt: delivery.attemptedAt,
          },
  };
  const nextContent = buildStoredContent(bodyHtml, nextMeta);

  await query(`UPDATE ${SCHEMA}.emails SET content = $1 WHERE id = $2`, [
    nextContent,
    email.id,
  ]);

  return delivery.status === "sent"
    ? { status: "sent", content: nextContent }
    : { status: "failed", content: nextContent, error: delivery.error };
}

function mapMailboxMessage(row: MailMessageRow) {
  const senderName =
    row.from_json?.name || row.from_json?.address || "External Sender";
  const recipientAddress = row.to_json?.[0]?.address || "";
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    thread_id: row.thread_id ?? null,
    sender_id: `external:${row.from_json?.address || "unknown"}`,
    recipient_id: `external:${recipientAddress || "unknown"}`,
    subject: row.subject,
    content: row.html_body || (row.text_body ? `<p>${row.text_body}</p>` : ""),
    is_read: row.is_read,
    is_starred: row.is_starred,
    is_archived: false,
    is_draft: row.is_draft || row.folder === "drafts",
    snoozed_until: row.snoozed_until ?? null,
    created_at: row.received_at,
    sender: {
      id: `external:${row.from_json?.address || "unknown"}`,
      full_name: senderName,
      avatar_url: "",
    },
    recipient: {
      id: `external:${recipientAddress || "unknown"}`,
      full_name: recipientAddress || "Unknown Recipient",
      avatar_url: "",
    },
  };
}

const EMAIL_SELECT = `
    e.*,
    json_build_object('id', s.id, 'full_name', s.full_name, 'avatar_url', s.avatar_url) as sender,
    json_build_object('id', r.id, 'full_name', r.full_name, 'avatar_url', r.avatar_url) as recipient
`;

const MAIL_MESSAGE_SELECT = `
  id, workspace_id, folder, subject, html_body, text_body, received_at,
  is_read, is_starred, is_draft, snoozed_until, from_json, to_json, thread_id
`;

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const emailId = searchParams.get("id");
  const parsedLimit = Number.parseInt(searchParams.get("limit") || "", 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 50)
      : null;
  const listCap = limit != null ? limit : 200;
  const includeAiDigest =
    searchParams.get("includeAiDigest") === "1" ||
    searchParams.get("includeAiDigest") === "true";
  const workspaceIdFilter = searchParams.get("workspaceId")?.trim() || null;

  try {
    await ensureEmailAccountScopedSchema();
    await requireEmailWorkspaceAccess(workspaceIdFilter, user.id);

    const mailboxAccount = await getPrimaryMailAccountWithSecret(user.id);
    if (mailboxAccount) {
      if (emailId) {
        const single = await query<MailMessageRow>(
          `SELECT ${MAIL_MESSAGE_SELECT}, external_uid, provider_message_id
                     FROM ${SCHEMA}.mail_messages
                     WHERE account_id = $1
                       AND id = $2
                     LIMIT 1`,
          [mailboxAccount.id, emailId],
        );
        const row = single.rows[0];
        if (!row)
          return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (!row.html_body?.trim()) {
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
              row.html_body = hydrated.htmlBody;
              row.text_body = hydrated.textBody || row.text_body;
            }
          } catch {
            // If source refresh fails, still return cached snippet row.
          }
        }

        return NextResponse.json(mapMailboxMessage(row));
      }

      const type = searchParams.get("type") || "inbox";
      const params: unknown[] = [mailboxAccount.id];
      const conditions = ["account_id = $1"];

      if (type === "sent") {
        conditions.push("folder = 'sent'");
      } else if (type === "drafts") {
        conditions.push("folder = 'drafts'");
      } else if (type === "starred") {
        conditions.push("is_starred = true");
      } else if (type === "snoozed") {
        conditions.push("snoozed_until IS NOT NULL");
        conditions.push("snoozed_until > NOW()");
      } else if (type === "inbox") {
        conditions.push("folder = 'inbox'");
        conditions.push("is_draft = false");
        conditions.push(
          "(snoozed_until IS NULL OR snoozed_until <= NOW())",
        );
      } else {
        return badRequest("Invalid folder type");
      }

      const orderBy =
        type === "snoozed" ? "snoozed_until ASC" : "received_at DESC";

      let workspaceClause = "";
      if (workspaceIdFilter) {
        params.push(workspaceIdFilter);
        workspaceClause = ` AND workspace_id = $${params.length}`;
      }
      const rows = await query<MailMessageRow>(
        `SELECT ${MAIL_MESSAGE_SELECT}
                 FROM ${SCHEMA}.mail_messages
                 WHERE ${conditions.join(" AND ")}${workspaceClause}
                 ORDER BY ${orderBy}
                 LIMIT ${listCap}`,
        params,
      );
      const mapped = rows.rows.map(mapMailboxMessage);
      if (includeAiDigest && mapped.length) {
        try {
          const smap = await getDigestSummaryByMessageIds(
            user.id,
            mapped.map((m) => m.id),
          );
          for (const m of mapped) {
            const s = smap.get(m.id);
            if (s) (m as Record<string, unknown>).ai_digest_summary = s;
          }
        } catch {
          /* optional enrichment */
        }
      }
      return NextResponse.json(mapped);
    }

    if (emailId) {
      const result = await query(
        `SELECT ${EMAIL_SELECT}
                 FROM ${SCHEMA}.emails e
                 LEFT JOIN ${SCHEMA}.profiles s ON s.id = e.sender_id
                 LEFT JOIN ${SCHEMA}.profiles r ON r.id = e.recipient_id
                 WHERE e.id = $1
                   AND (e.sender_id = $2 OR e.recipient_id = $2)
                 LIMIT 1`,
        [emailId, user.id],
      );
      if (!result.rows[0])
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(result.rows[0]);
    }

    const type = searchParams.get("type") || "inbox";
    let whereExtra = "";
    let orderBy = "e.created_at DESC";
    const params: unknown[] = [user.id];

    if (type === "inbox") {
      whereExtra = `AND e.recipient_id = $1 AND e.is_archived = false AND e.is_draft = false AND (e.snoozed_until IS NULL OR e.snoozed_until <= NOW())`;
    } else if (type === "sent") {
      whereExtra = `AND e.sender_id = $1 AND e.is_draft = false`;
    } else if (type === "starred") {
      whereExtra = `AND e.is_starred = true AND (e.sender_id = $1 OR e.recipient_id = $1)`;
    } else if (type === "archived") {
      whereExtra = `AND e.is_archived = true AND (e.sender_id = $1 OR e.recipient_id = $1)`;
    } else if (type === "drafts") {
      whereExtra = `AND e.sender_id = $1 AND e.is_draft = true`;
    } else if (type === "snoozed") {
      whereExtra = `AND e.recipient_id = $1 AND e.snoozed_until IS NOT NULL AND e.snoozed_until > NOW()`;
      orderBy = "e.snoozed_until ASC";
    } else {
      return badRequest("Invalid folder type");
    }

    const result = await query(
      `SELECT ${EMAIL_SELECT}
             FROM ${SCHEMA}.emails e
             LEFT JOIN ${SCHEMA}.profiles s ON s.id = e.sender_id
             LEFT JOIN ${SCHEMA}.profiles r ON r.id = e.recipient_id
             WHERE 1 = 1 ${whereExtra}
             ORDER BY ${orderBy}
             LIMIT ${listCap}`,
      params,
    );
    return NextResponse.json(result.rows);
  } catch (e: unknown) {
    const access = emailAccessResponse(e);
    if (access) return access;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = parsePostPayload(body);
  if (parsed.error) return badRequest(parsed.error);
  const payload = parsed.data!;

  try {
    await requireEmailWorkspaceAccess(payload.workspace_id, user.id);
  } catch (e: unknown) {
    const access = emailAccessResponse(e);
    if (access) return access;
    throw e;
  }

  const sendRate = checkSimpleRateLimit(`mail-send:${user.id}`, 20, 60_000);
  if (!sendRate.allowed) {
    return NextResponse.json(
      { error: "Too many send requests. Please retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((sendRate.retryAfterMs || 0) / 1000)),
        },
      },
    );
  }

  const { sql, params } = buildInsert(`${SCHEMA}.emails`, {
    ...payload,
    sender_id: user.id,
  });

  try {
    await ensureEmailAccountScopedSchema();
    const mailboxAccount = await getPrimaryMailAccountWithSecret(user.id);
    await assertMailAccountWritable(
      mailboxAccount?.id ?? (await getLatestActiveMailAccountId(user.id)),
    );
    if (mailboxAccount && !payload.is_draft) {
      const to = payload.recipient_email ? [payload.recipient_email] : [];
      if (!to.length)
        return badRequest(
          "recipient_email is required when mailbox is connected",
        );
      const parsedContent = parseStoredEmailContent(payload.content || "");
      const idBackedRecipientTokens = parsedContent.meta.cc
        .concat(parsedContent.meta.bcc)
        .filter(
          (v): v is string => typeof v === "string" && v.trim().length > 0,
        );
      const idBackedEmails = await resolveProfileEmails(
        idBackedRecipientTokens,
      );
      const resolveToken = (token: string): string | null =>
        normalizeEmailToken(token) || idBackedEmails.get(token) || null;
      const cc = parsedContent.meta.cc
        .map(resolveToken)
        .filter((v): v is string => Boolean(v));
      const bcc = parsedContent.meta.bcc
        .map(resolveToken)
        .filter((v): v is string => Boolean(v));

      const delivery = await sendExternalEmail({
        to,
        cc,
        bcc,
        subject: payload.subject || "",
        html: parsedContent.bodyHtml || payload.content || "",
        replyTo: user.email || undefined,
        mailbox: mailboxAccount,
      });
      if (delivery.status === "failed") {
        return NextResponse.json({ error: delivery.error }, { status: 400 });
      }

      const row = await query<MailMessageRow>(
        `INSERT INTO ${SCHEMA}.mail_messages (
                    account_id, workspace_id, external_message_id, folder, subject, html_body, text_body,
                    from_json, to_json, cc_json, bcc_json, is_read, is_starred, is_draft, received_at
                 ) VALUES (
                    $1, $2, $3, 'sent', $4, $5, $6, $7::jsonb, $8::jsonb, '[]'::jsonb, '[]'::jsonb, true, false, false, NOW()
                 )
                 RETURNING id, workspace_id, folder, subject, html_body, received_at, is_read, is_starred, is_draft, from_json, to_json`,
        [
          mailboxAccount.id,
          null,
          delivery.providerMessageId || `onework-${Date.now()}`,
          payload.subject || "",
          payload.content || "",
          "",
          JSON.stringify({
            address: mailboxAccount.email_address,
            name: "OneWork User",
          }),
          JSON.stringify(to.map((address) => ({ address }))),
        ],
      );
      return NextResponse.json(mapMailboxMessage(row.rows[0]));
    }

    const insertRes = await query<EmailRow>(sql, params);
    const data = insertRes.rows[0];

    let responseRow: Record<string, unknown> = { ...data };
    if (payload.recipient_id && !payload.is_draft) {
      const delivery = await attemptExternalDelivery(
        data,
        user.email || undefined,
      );
      responseRow = { ...data, content: delivery.content };

      await query(
        `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                 VALUES ($1, $2, $3, 'mention', $4)`,
        [
          payload.recipient_id,
          `New Email from ${user.email?.split("@")[0] || "someone"}`,
          payload.subject,
          data.id,
        ],
      );

      if (delivery.status === "failed") {
        return NextResponse.json(
          {
            ...responseRow,
            delivery_error: delivery.error || "External delivery failed",
          },
          { status: 202 },
        );
      }
    }
    return NextResponse.json(responseRow);
  } catch (e: unknown) {
    const access = emailAccessResponse(e);
    if (access) return access;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "ID is required" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = parsePatchPayload(body);
  if (parsed.error) return badRequest(parsed.error);
  const patchData = parsed.data || {};
  const control = parsed.control || {};

  try {
    await ensureEmailAccountScopedSchema();
    if ("workspace_id" in patchData) {
      await requireEmailWorkspaceAccess(patchData.workspace_id, user.id);
    }

    const mailboxAccount = await getPrimaryMailAccountWithSecret(user.id);
    await assertMailAccountWritable(
      mailboxAccount?.id ?? (await getLatestActiveMailAccountId(user.id)),
    );
    if (mailboxAccount) {
      const mailboxRow = await query<{
        id: string;
        external_uid: number | null;
        provider_message_id: string | null;
        folder: string;
      }>(
        `SELECT id, external_uid, provider_message_id, folder
                 FROM ${SCHEMA}.mail_messages
                 WHERE id = $1 AND account_id = $2
                 LIMIT 1`,
        [id, mailboxAccount.id],
      );
      const messageRow = mailboxRow.rows[0];
      if (!messageRow)
        return NextResponse.json({ error: "Not found" }, { status: 404 });

      const updatePayload: Record<string, unknown> = {};
      if (typeof patchData.is_read === "boolean")
        updatePayload.is_read = patchData.is_read;
      if (typeof patchData.is_starred === "boolean")
        updatePayload.is_starred = patchData.is_starred;
      if ("snoozed_until" in patchData)
        updatePayload.snoozed_until = patchData.snoozed_until ?? null;
      if (typeof patchData.is_draft === "boolean")
        updatePayload.is_draft = patchData.is_draft;
      if (typeof patchData.subject === "string")
        updatePayload.subject = patchData.subject;
      if (typeof patchData.content === "string")
        updatePayload.html_body = patchData.content;
      if (!Object.keys(updatePayload).length && !control.retry_delivery) {
        return NextResponse.json(
          { error: "No valid fields supplied" },
          { status: 400 },
        );
      }

      if (control.retry_delivery) {
        await runMailboxSync(mailboxAccount, null, "incremental");
      }

      if (Object.keys(updatePayload).length > 0) {
        try {
          await pushMailboxFlagChangesViaProvider(
            mailboxAccount,
            messageRow,
            updatePayload,
          );
        } catch (e) {
          return NextResponse.json(
            {
              error:
                e instanceof Error
                  ? e.message
                  : "Could not sync read/star state with your mailbox.",
            },
            { status: 502 },
          );
        }

        const { clause, params: setParams, nextIdx } = buildSet(updatePayload);
        const updated = await query(
          `UPDATE ${SCHEMA}.mail_messages
                     SET ${clause}, updated_at = NOW()
                     WHERE id = $${nextIdx}
                     RETURNING ${MAIL_MESSAGE_SELECT}`,
          [...setParams, id],
        );
        return NextResponse.json(
          mapMailboxMessage(updated.rows[0] as MailMessageRow),
        );
      }

      const fetched = await query(
        `SELECT ${MAIL_MESSAGE_SELECT}
                 FROM ${SCHEMA}.mail_messages
                 WHERE id = $1`,
        [id],
      );
      return NextResponse.json(
        mapMailboxMessage(fetched.rows[0] as MailMessageRow),
      );
    }

    const accessRes = await query<{
      sender_id: string;
      recipient_id: string;
      is_draft: boolean;
    }>(
      `SELECT sender_id, recipient_id, is_draft FROM ${SCHEMA}.emails
             WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = accessRes.rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const canEdit = row.sender_id === user.id || row.recipient_id === user.id;
    if (!canEdit)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const recipientOnlyKeys = new Set([
      "is_read",
      "is_starred",
      "is_archived",
      "snoozed_until",
    ]);
    if (row.sender_id !== user.id) {
      const invalid = Object.keys(patchData).find(
        (k) => !recipientOnlyKeys.has(k),
      );
      if (invalid)
        return NextResponse.json(
          { error: `Forbidden field update: ${invalid}` },
          { status: 403 },
        );
      if (control.retry_delivery)
        return NextResponse.json(
          { error: "Forbidden field update: retry_delivery" },
          { status: 403 },
        );
    }

    let updatedRow: Record<string, unknown>;
    if (Object.keys(patchData).length > 0) {
      const {
        clause,
        params: setParams,
        nextIdx,
      } = buildSet(patchData as Record<string, unknown>);
      const updateRes = await query(
        `UPDATE ${SCHEMA}.emails SET ${clause} WHERE id = $${nextIdx} RETURNING *`,
        [...setParams, id],
      );
      updatedRow = updateRes.rows[0] as Record<string, unknown>;
    } else {
      const fetchRes = await query(
        `SELECT * FROM ${SCHEMA}.emails WHERE id = $1 LIMIT 1`,
        [id],
      );
      updatedRow = fetchRes.rows[0] as Record<string, unknown>;
    }

    const shouldDeliverFromDraft =
      row.sender_id === user.id && row.is_draft && patchData.is_draft === false;
    const shouldRetryDelivery =
      row.sender_id === user.id && control.retry_delivery === true;
    if (shouldDeliverFromDraft || shouldRetryDelivery) {
      const delivery = await attemptExternalDelivery(
        updatedRow as EmailRow,
        user.email || undefined,
      );
      updatedRow = { ...updatedRow, content: delivery.content };
      if (delivery.status === "failed") {
        return NextResponse.json(
          {
            ...updatedRow,
            delivery_error: delivery.error || "External delivery failed",
          },
          { status: 202 },
        );
      }
    }

    return NextResponse.json(updatedRow);
  } catch (e: unknown) {
    const access = emailAccessResponse(e);
    if (access) return access;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "ID is required" }, { status: 400 });

  try {
    const mailboxAccount = await getPrimaryMailAccountWithSecret(user.id);
    await assertMailAccountWritable(
      mailboxAccount?.id ?? (await getLatestActiveMailAccountId(user.id)),
    );
    if (mailboxAccount) {
      const hit = await query<{ id: string }>(
        `SELECT id
                 FROM ${SCHEMA}.mail_messages
                 WHERE id = $1 AND account_id = $2
                 LIMIT 1`,
        [id, mailboxAccount.id],
      );
      if (!hit.rows[0])
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      await query(`DELETE FROM ${SCHEMA}.mail_messages WHERE id = $1`, [id]);
      return NextResponse.json({ ok: true });
    }

    const accessRes = await query<{ sender_id: string; recipient_id: string }>(
      `SELECT sender_id, recipient_id FROM ${SCHEMA}.emails WHERE id = $1 LIMIT 1`,
      [id],
    );
    const row = accessRes.rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const canDelete = row.sender_id === user.id || row.recipient_id === user.id;
    if (!canDelete)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await query(`DELETE FROM ${SCHEMA}.emails WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const access = emailAccessResponse(e);
    if (access) return access;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
