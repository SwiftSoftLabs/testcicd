export interface StoredAttachmentMeta {
  name: string;
  size?: string;
  type?: string;
  icsContent?: string;
}

export interface EmailStoredMeta {
  attachments: StoredAttachmentMeta[];
  cc: string[];
  bcc: string[];
  delivery?: {
    status: "queued" | "sent" | "failed";
    providerMessageId?: string;
    error?: string;
    attemptedAt?: string;
  };
}

const META_PREFIX = "<!--onework:";
const META_SUFFIX = "-->";

export function buildStoredContent(
  bodyHtml: string,
  meta: Partial<EmailStoredMeta>,
): string {
  const payload: EmailStoredMeta = {
    attachments: meta.attachments ?? [],
    cc: meta.cc ?? [],
    bcc: meta.bcc ?? [],
    delivery: meta.delivery,
  };
  return `${META_PREFIX}${JSON.stringify(payload)}${META_SUFFIX}\n${bodyHtml.trimStart()}`;
}

export function parseStoredEmailContent(raw: string): {
  bodyHtml: string;
  meta: EmailStoredMeta;
} {
  const defaultMeta: EmailStoredMeta = { attachments: [], cc: [], bcc: [] };
  if (!raw || !raw.startsWith(META_PREFIX)) {
    return { bodyHtml: raw || "", meta: defaultMeta };
  }
  const close = raw.indexOf(META_SUFFIX);
  if (close === -1) {
    return { bodyHtml: raw, meta: defaultMeta };
  }
  const jsonPart = raw.slice(META_PREFIX.length, close);
  let meta = defaultMeta;
  try {
    const parsed = JSON.parse(jsonPart) as Partial<EmailStoredMeta>;
    meta = {
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments.map((attachment) => {
            const item =
              attachment && typeof attachment === "object"
                ? (attachment as Partial<StoredAttachmentMeta>)
                : {};
            return {
              name: typeof item.name === "string" ? item.name : "",
              size: typeof item.size === "string" ? item.size : undefined,
              type: typeof item.type === "string" ? item.type : undefined,
              icsContent:
                typeof item.icsContent === "string"
                  ? item.icsContent
                  : undefined,
            };
          })
        : [],
      cc: Array.isArray(parsed.cc) ? parsed.cc : [],
      bcc: Array.isArray(parsed.bcc) ? parsed.bcc : [],
      delivery:
        parsed.delivery &&
        typeof parsed.delivery === "object" &&
        (parsed.delivery.status === "queued" ||
          parsed.delivery.status === "sent" ||
          parsed.delivery.status === "failed")
          ? {
              status: parsed.delivery.status,
              providerMessageId:
                typeof parsed.delivery.providerMessageId === "string"
                  ? parsed.delivery.providerMessageId
                  : undefined,
              error:
                typeof parsed.delivery.error === "string"
                  ? parsed.delivery.error
                  : undefined,
              attemptedAt:
                typeof parsed.delivery.attemptedAt === "string"
                  ? parsed.delivery.attemptedAt
                  : undefined,
            }
          : undefined,
    };
  } catch {
    /* ignore */
  }
  const bodyHtml = raw.slice(close + META_SUFFIX.length).trimStart();
  return { bodyHtml, meta };
}

/** Strip leading OneWork meta + HTML for plain-text previews (e.g. inbox list). */
export function stripStoredMetaForPreview(raw: string): string {
  const { bodyHtml } = parseStoredEmailContent(raw);
  return bodyHtml;
}
