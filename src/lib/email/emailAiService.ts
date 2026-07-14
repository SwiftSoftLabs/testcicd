import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { query, SCHEMA } from "@/lib/db";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import {
  loadOwnedEmailPlainContext,
  loadThreadPlainForAi,
  type OwnedEmailPlainContext,
} from "@/lib/email/messagePlainForAi";
import { ensureMailAiTables } from "@/lib/email/mailAiSchema";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";

export type EmailAiKind =
  | "digest"
  | "reply_hint"
  | "reply_drafts"
  | "thread_digest"
  | "compare";

export type EmailAiTone = "neutral" | "concise" | "formal" | "friendly";

export type DigestPayload = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  evidence: { keyPointIndex: number; quote: string }[];
  sourceTruncated: boolean;
};

function clampStrings(
  arr: unknown,
  maxItems: number,
  maxLen: number,
): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const x of arr) {
    if (out.length >= maxItems) break;
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t) continue;
    out.push(t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t);
  }
  return out;
}

function parseDigestJson(text: string):
  | (Omit<DigestPayload, "evidence" | "sourceTruncated"> & {
      evidence?: unknown;
    })
  | null {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const summary =
      typeof raw.summary === "string" ? raw.summary.trim().slice(0, 800) : "";
    if (!summary) return null;
    const kp = raw.keyPoints ?? raw.key_points;
    const ai = raw.actionItems ?? raw.action_items;
    return {
      summary,
      keyPoints: clampStrings(kp, 4, 200),
      actionItems: clampStrings(ai, 3, 220),
      evidence: raw.evidence,
    };
  } catch {
    return null;
  }
}

function sanitizeEvidence(
  ev: unknown,
  bodyPlain: string,
  keyPointCount: number,
): { keyPointIndex: number; quote: string }[] {
  if (!Array.isArray(ev)) return [];
  const out: { keyPointIndex: number; quote: string }[] = [];
  for (const item of ev) {
    if (out.length >= 4) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const ki = rec.keyPointIndex ?? rec.key_point_index;
    const quoteRaw = rec.quote;
    if (typeof quoteRaw !== "string") continue;
    const quote = quoteRaw.trim();
    if (!quote || quote.length > 240) continue;
    const idx =
      typeof ki === "number" && Number.isInteger(ki)
        ? ki
        : Number.parseInt(String(ki), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= keyPointCount) continue;
    if (!bodyPlain.includes(quote)) continue;
    out.push({
      keyPointIndex: idx,
      quote: quote.length > 180 ? `${quote.slice(0, 179)}…` : quote,
    });
  }
  return out;
}

function toneClause(tone: EmailAiTone): string {
  switch (tone) {
    case "concise":
      return "Be extremely concise; short sentences.";
    case "formal":
      return "Use formal, professional wording.";
    case "friendly":
      return "Use warm, collaborative wording while staying factual.";
    default:
      return "Use clear neutral professional wording.";
  }
}

function cacheKey(
  kind: EmailAiKind,
  tone: EmailAiTone,
  instructions: string,
  extra?: string,
): string {
  const h = crypto
    .createHash("sha256")
    .update(`${kind}|${tone}|${instructions.trim()}|${extra ?? ""}|v3`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}:${tone}:${h}`;
}

async function readCache(
  userId: string,
  messageId: string,
  kind: EmailAiKind,
  key: string,
): Promise<Record<string, unknown> | null> {
  await ensureMailAiTables();
  const res = await query<{ payload_json: unknown; source_truncated: boolean }>(
    `SELECT payload_json, source_truncated
       FROM ${SCHEMA}.mail_ai_cache
      WHERE user_id = $1 AND message_id = $2::uuid AND kind = $3 AND cache_key = $4
        AND expires_at > NOW()
      LIMIT 1`,
    [userId, messageId, kind, key],
  );
  const row = res.rows[0];
  if (!row?.payload_json || typeof row.payload_json !== "object") return null;
  return {
    ...(row.payload_json as Record<string, unknown>),
    sourceTruncated: row.source_truncated,
  };
}

async function writeCache(
  userId: string,
  messageId: string,
  kind: EmailAiKind,
  key: string,
  payload: Record<string, unknown>,
  sourceTruncated: boolean,
): Promise<void> {
  await ensureMailAiTables();
  await query(
    `INSERT INTO ${SCHEMA}.mail_ai_cache
       (user_id, message_id, kind, cache_key, payload_json, source_truncated, expires_at)
     VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6, NOW() + INTERVAL '30 days')
     ON CONFLICT (user_id, message_id, kind, cache_key)
     DO UPDATE SET
       payload_json = EXCLUDED.payload_json,
       source_truncated = EXCLUDED.source_truncated,
       created_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [userId, messageId, kind, key, JSON.stringify(payload), sourceTruncated],
  );
}

async function writeAudit(
  userId: string,
  messageId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await ensureMailAiTables();
  await query(
    `INSERT INTO ${SCHEMA}.mail_ai_audit (user_id, message_id, action, meta_json)
     VALUES ($1, $2::uuid, $3, $4::jsonb)`,
    [userId, messageId, action, JSON.stringify(meta)],
  );
}

async function generateJson(
  apiKey: string,
  systemInstruction: string,
  userTurn: string,
  maxOutputTokens: number,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: getGeminiModelId(),
    contents: userTurn,
    config: {
      systemInstruction,
      temperature: 0.15,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  });
  const text = result.text?.trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

function buildUserTurnSingle(
  ctx: OwnedEmailPlainContext,
  instructions?: string,
): string {
  const lines = [
    "Message (plain text):",
    `Subject: ${ctx.subject}`,
    `From: ${ctx.fromLine}`,
    `Date: ${ctx.dateLine}`,
    ctx.bodyTruncated ? "Note: body was shortened before sending." : "",
    "",
    ctx.bodyPlain,
  ].filter(Boolean);
  if (instructions?.trim()) {
    lines.push("", "Additional user instructions:", instructions.trim());
  }
  return lines.join("\n");
}

export async function getLatestDigestPayload(
  userId: string,
  messageId: string,
): Promise<DigestPayload | null> {
  await ensureMailAiTables();
  const res = await query<{ payload_json: unknown; source_truncated: boolean }>(
    `SELECT payload_json, source_truncated
       FROM ${SCHEMA}.mail_ai_cache
      WHERE user_id = $1 AND message_id = $2::uuid AND kind = 'digest' AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, messageId],
  );
  const row = res.rows[0];
  if (!row?.payload_json || typeof row.payload_json !== "object") return null;
  const payload = row.payload_json as Record<string, unknown>;
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  if (!summary) return null;
  return {
    summary,
    keyPoints: clampStrings(payload.keyPoints, 4, 200),
    actionItems: clampStrings(payload.actionItems, 3, 220),
    evidence: Array.isArray(payload.evidence)
      ? (payload.evidence as { keyPointIndex: number; quote: string }[])
      : [],
    sourceTruncated: Boolean(row.source_truncated),
  };
}

export async function getDigestSummaryByMessageIds(
  userId: string,
  messageIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!messageIds.length) return map;
  await ensureMailAiTables();
  const res = await query<{ message_id: string; summary: string | null }>(
    `SELECT message_id, payload_json->>'summary' AS summary
       FROM (
         SELECT message_id, payload_json, created_at,
                ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY created_at DESC) AS rn
           FROM ${SCHEMA}.mail_ai_cache
          WHERE user_id = $1
            AND kind = 'digest'
            AND message_id = ANY($2::uuid[])
            AND expires_at > NOW()
       ) x
      WHERE rn = 1`,
    [userId, messageIds],
  );
  for (const row of res.rows) {
    const s = row.summary?.trim();
    if (s) map.set(row.message_id, s.length > 200 ? `${s.slice(0, 199)}…` : s);
  }
  return map;
}

export type EmailAiPostBody = {
  kind?: string;
  tone?: string;
  instructions?: string;
  store?: boolean;
  compareWithMessageId?: string;
  skipCache?: boolean;
};

export async function handleEmailAiPost(opts: {
  userId: string;
  emailId: string;
  body: EmailAiPostBody;
  apiKey: string;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { userId, emailId, apiKey } = opts;
  const body = opts.body;
  const kindRaw = typeof body.kind === "string" ? body.kind.trim() : "digest";
  const kind = (
    [
      "digest",
      "reply_hint",
      "reply_drafts",
      "thread_digest",
      "compare",
    ].includes(kindRaw)
      ? kindRaw
      : "digest"
  ) as EmailAiKind;
  const toneRaw = typeof body.tone === "string" ? body.tone.trim() : "neutral";
  const tone = (
    ["neutral", "concise", "formal", "friendly"].includes(toneRaw)
      ? toneRaw
      : "neutral"
  ) as EmailAiTone;
  const instructions =
    typeof body.instructions === "string"
      ? body.instructions.trim().slice(0, 500)
      : "";
  const store = body.store === true;
  const skipCache = body.skipCache === true;
  const compareId =
    typeof body.compareWithMessageId === "string"
      ? body.compareWithMessageId.trim()
      : "";

  const rate = checkSimpleRateLimit(`email-ai:${userId}`, 24, 900_000);
  if (!rate.allowed) {
    return {
      status: 429,
      json: {
        error: "Too many AI requests. Try again later.",
        retryAfterSec: Math.ceil((rate.retryAfterMs ?? 60_000) / 1000),
      },
    };
  }

  const key = cacheKey(
    kind,
    tone,
    instructions,
    kind === "compare" ? compareId : undefined,
  );

  if (!skipCache && (kind === "digest" || kind === "thread_digest")) {
    const cached = await readCache(userId, emailId, kind, key);
    if (cached && typeof cached.summary === "string") {
      await writeAudit(userId, emailId, `ai:${kind}`, { cacheHit: true, tone });
      return {
        status: 200,
        json: cached as unknown as Record<string, unknown>,
      };
    }
  }

  try {
    if (kind === "compare") {
      if (!compareId || compareId === emailId) {
        return {
          status: 400,
          json: { error: "compareWithMessageId is required and must differ." },
        };
      }
      const a = await loadOwnedEmailPlainContext(userId, emailId);
      const b = await loadOwnedEmailPlainContext(userId, compareId);
      if (!a || !b)
        return {
          status: 404,
          json: { error: "One or both messages were not found." },
        };

      const userTurn = [
        "Compare these two email messages (A then B). Use only their text.",
        "",
        "--- MESSAGE A ---",
        buildUserTurnSingle(a, undefined),
        "",
        "--- MESSAGE B ---",
        buildUserTurnSingle(b, instructions || undefined),
      ].join("\n");

      const systemInstruction = [
        toneClause(tone),
        "You compare two emails for a busy professional. Use only facts present in the messages.",
        "Respond with one JSON object only (no markdown). Keys:",
        'summary (string, max 3 sentences), differences (array, max 6 short strings), whichIsNewer ("A"|"B"|"unknown") — infer from Date lines if possible.',
      ].join(" ");

      const text = await generateJson(apiKey, systemInstruction, userTurn, 520);
      let trimmed = text.trim();
      if (trimmed.startsWith("```")) {
        trimmed = trimmed
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
      }
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const out = {
        summary:
          typeof parsed.summary === "string"
            ? parsed.summary.slice(0, 900)
            : "",
        differences: clampStrings(parsed.differences, 6, 220),
        whichIsNewer:
          parsed.whichIsNewer === "A" ||
          parsed.whichIsNewer === "B" ||
          parsed.whichIsNewer === "unknown"
            ? parsed.whichIsNewer
            : "unknown",
      };
      await writeAudit(userId, emailId, "ai:compare", {
        tone,
        otherId: compareId,
      });
      return { status: 200, json: out };
    }

    if (kind === "reply_hint") {
      const ctx = await loadOwnedEmailPlainContext(userId, emailId);
      if (!ctx) return { status: 404, json: { error: "Not found" } };
      const userTurn = buildUserTurnSingle(ctx, instructions || undefined);
      const systemInstruction = [
        toneClause(tone),
        "You help the reader decide how to reply. Use only facts from the email; do not invent obligations.",
        "Respond with one JSON object only (no markdown). Keys:",
        "openQuestions (array, max 5 short strings the reader may need to answer),",
        "missingInfo (array, max 4 strings of unclear or missing details),",
        "risks (array, max 4 strings: misunderstandings, commitments, or tone pitfalls). Use [] when none.",
      ].join(" ");

      const text = await generateJson(apiKey, systemInstruction, userTurn, 520);
      let trimmed = text.trim();
      if (trimmed.startsWith("```")) {
        trimmed = trimmed
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
      }
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const out = {
        openQuestions: clampStrings(
          parsed.openQuestions ?? parsed.open_questions,
          5,
          200,
        ),
        missingInfo: clampStrings(
          parsed.missingInfo ?? parsed.missing_info,
          4,
          200,
        ),
        risks: clampStrings(parsed.risks, 4, 200),
        sourceTruncated: ctx.bodyTruncated,
      };
      await writeAudit(userId, emailId, "ai:reply_hint", { tone, store });
      if (store)
        await writeCache(
          userId,
          emailId,
          "reply_hint",
          key,
          out,
          ctx.bodyTruncated,
        );
      return { status: 200, json: out };
    }

    if (kind === "reply_drafts") {
      const ctx = await loadOwnedEmailPlainContext(userId, emailId);
      if (!ctx) return { status: 404, json: { error: "Not found" } };
      const userTurn = buildUserTurnSingle(ctx, instructions || undefined);
      const systemInstruction = [
        toneClause(tone),
        "Write reply drafts as the reader replying to the sender. Stay faithful to the thread; no fabricated facts.",
        "Respond with one JSON object only (no markdown). Keys:",
        'drafts (array of exactly 3 objects, each { "label": string, "body": string }).',
        'Labels must be "Short", "Formal", and "Direct" (English).',
        "Bodies: plain text email replies, max ~120 words each.",
      ].join(" ");

      const text = await generateJson(apiKey, systemInstruction, userTurn, 900);
      let trimmed = text.trim();
      if (trimmed.startsWith("```")) {
        trimmed = trimmed
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
      }
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const draftsRaw = parsed.drafts;
      const drafts: { label: string; body: string }[] = [];
      if (Array.isArray(draftsRaw)) {
        for (const d of draftsRaw) {
          if (drafts.length >= 3) break;
          if (!d || typeof d !== "object") continue;
          const o = d as Record<string, unknown>;
          const label =
            typeof o.label === "string" ? o.label.trim().slice(0, 40) : "";
          const bodyDraft =
            typeof o.body === "string" ? o.body.trim().slice(0, 2500) : "";
          if (label && bodyDraft) drafts.push({ label, body: bodyDraft });
        }
      }
      const out = { drafts, sourceTruncated: ctx.bodyTruncated };
      await writeAudit(userId, emailId, "ai:reply_drafts", { tone, store });
      if (store)
        await writeCache(
          userId,
          emailId,
          "reply_drafts",
          key,
          out,
          ctx.bodyTruncated,
        );
      return { status: 200, json: out };
    }

    const threadBundle =
      kind === "thread_digest"
        ? await loadThreadPlainForAi(userId, emailId)
        : null;
    const singleCtx =
      kind === "digest"
        ? await loadOwnedEmailPlainContext(userId, emailId)
        : null;

    if (kind === "digest" && !singleCtx)
      return { status: 404, json: { error: "Not found" } };
    if (kind === "thread_digest" && !threadBundle)
      return { status: 404, json: { error: "Not found" } };

    const userTurn =
      kind === "thread_digest" && threadBundle
        ? [
            "Email thread (plain text, chronological):",
            threadBundle.bodyTruncated
              ? "Note: thread was shortened before sending."
              : "",
            "",
            threadBundle.combinedUserTurn,
            instructions
              ? ["", "Additional user instructions:", instructions].join("\n")
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : buildUserTurnSingle(singleCtx!, instructions || undefined);

    const bodyForEvidence =
      kind === "thread_digest" && threadBundle
        ? threadBundle.combinedUserTurn
        : singleCtx!.bodyPlain;
    const sourceTruncated =
      kind === "thread_digest" && threadBundle
        ? threadBundle.bodyTruncated
        : singleCtx!.bodyTruncated;

    const systemInstruction = [
      toneClause(tone),
      "You summarize email for a busy professional. Use only facts present in the message(s); do not invent names, dates, or commitments.",
      "Respond with one JSON object only (no markdown). Keys:",
      "summary (string, max 2 sentences),",
      "keyPoints (array, max 4 short bullet strings),",
      "actionItems (array, max 3 concrete next steps requested of the reader; use [] if none),",
      'evidence (array, max 4 objects: each { "keyPointIndex": number, "quote": string }) where keyPointIndex is 0-based index into keyPoints,',
      "and quote is a SHORT verbatim excerpt from the provided text supporting that key point. Use [] if none.",
    ].join(" ");

    const text = await generateJson(apiKey, systemInstruction, userTurn, 520);
    const parsedBase = parseDigestJson(text);
    if (!parsedBase)
      return { status: 502, json: { error: "Could not parse AI response" } };

    const evidence = sanitizeEvidence(
      parsedBase.evidence,
      bodyForEvidence,
      parsedBase.keyPoints.length,
    );

    const out: DigestPayload = {
      summary: parsedBase.summary,
      keyPoints: parsedBase.keyPoints,
      actionItems: parsedBase.actionItems,
      evidence,
      sourceTruncated: sourceTruncated,
    };

    const cacheKind: EmailAiKind =
      kind === "thread_digest" ? "thread_digest" : "digest";
    await writeAudit(userId, emailId, `ai:${cacheKind}`, {
      tone,
      store,
      messageCount: kind === "thread_digest" ? threadBundle?.messageCount : 1,
    });
    if (store)
      await writeCache(
        userId,
        emailId,
        cacheKind,
        key,
        out as unknown as Record<string, unknown>,
        sourceTruncated,
      );

    return { status: 200, json: out as unknown as Record<string, unknown> };
  } catch (e: unknown) {
    const { httpStatus, message } = mapGeminiClientError(e);
    return { status: httpStatus, json: { error: message } };
  }
}
