import { getUserFromRequest } from "@/lib/db";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { escapeHtmlText } from "@/lib/email/escapeHtml";
import { stripHtmlToPlainText } from "@/lib/email/stripHtmlPreview";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IN = 12_000;
const MAX_OUT_SUBJECT = 200;

function htmlToPlain(html: string): string {
  const t = stripHtmlToPlainText(html || "").trim();
  if (t.length <= MAX_IN) return t || "(empty)";
  return `${t.slice(0, MAX_IN)}\n[…truncated]`;
}

function plainToEmailHtml(plain: string): string {
  const blocks = plain
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (!blocks.length) return "<p></p>";
  return blocks
    .map((block) => {
      const inner = escapeHtmlText(block).replace(/\n/g, "<br/>");
      return `<p>${inner}</p>`;
    })
    .join("");
}

type ComposeMode =
  | "improve"
  | "proofread"
  | "shorter"
  | "expand"
  | "tone"
  | "subject";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI is not configured." },
      { status: 503 },
    );
  }

  const rate = checkSimpleRateLimit(`email-compose-ai:${user.id}`, 20, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many compose AI requests. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rate.retryAfterMs ?? 60_000) / 1000),
          ),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const modeRaw = typeof body.mode === "string" ? body.mode.trim() : "improve";
  const mode = (
    ["improve", "proofread", "shorter", "expand", "tone", "subject"].includes(
      modeRaw,
    )
      ? modeRaw
      : "improve"
  ) as ComposeMode;

  const subject =
    typeof body.subject === "string" ? body.subject.trim().slice(0, 400) : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.trim().slice(0, 400)
      : "";
  const toneRaw =
    typeof body.tone === "string" ? body.tone.trim().toLowerCase() : "neutral";
  const tone = ["formal", "friendly", "neutral"].includes(toneRaw)
    ? toneRaw
    : "neutral";

  const plain = htmlToPlain(bodyHtml);

  const ai = new GoogleGenAI({ apiKey });

  try {
    if (mode === "subject") {
      const userTurn = [
        "Draft email body (plain text):",
        plain,
        subject ? `Current subject line: ${subject}` : "No subject yet.",
        instruction ? `User hint: ${instruction}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await ai.models.generateContent({
        model: getGeminiModelId(),
        contents: userTurn,
        config: {
          systemInstruction:
            "Suggest one clear email subject line (max 12 words). Use only what the body implies; do not invent events or names. " +
            'Respond with one JSON object only: {"subject":"..."}',
          temperature: 0.2,
          maxOutputTokens: 120,
          responseMimeType: "application/json",
        },
      });
      const text = result.text?.trim();
      if (!text)
        return NextResponse.json(
          { error: "Empty AI response" },
          { status: 502 },
        );
      const parsed = JSON.parse(
        text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
      ) as {
        subject?: string;
      };
      const sub =
        typeof parsed.subject === "string"
          ? parsed.subject.trim().slice(0, MAX_OUT_SUBJECT)
          : "";
      if (!sub)
        return NextResponse.json(
          { error: "Could not parse subject" },
          { status: 502 },
        );
      return NextResponse.json({ subject: sub });
    }

    const toneLine =
      mode === "tone"
        ? `Rewrite in a ${tone} tone while preserving meaning.`
        : "Keep a professional neutral tone unless the user asks otherwise.";

    const taskLine =
      mode === "proofread"
        ? "Proofread only: fix spelling, grammar, and punctuation. Keep wording, tone, and length as close as possible. Do not add facts, names, or new sentences."
        : mode === "improve"
          ? "Improve clarity, grammar, and flow. Keep the same intent and facts; do not add new commitments or names."
          : mode === "shorter"
            ? "Make the message noticeably shorter while keeping essential facts and intent."
            : mode === "expand"
              ? "Expand with helpful structure (short paragraphs). Do not invent facts, dates, or names not implied by the original."
              : toneLine;

    const userTurn = [
      "Current subject (for context only):",
      subject || "(none)",
      "",
      "Email body as plain text:",
      plain,
      instruction ? `\nUser instruction: ${instruction}` : "",
    ].join("\n");

    const result = await ai.models.generateContent({
      model: getGeminiModelId(),
      contents: userTurn,
      config: {
        systemInstruction: [
          "You help refine an email draft the user is composing.",
          taskLine,
          'Respond with one JSON object only: {"bodyPlain":"..."} where bodyPlain uses blank lines between paragraphs.',
          "No markdown, no HTML tags inside bodyPlain.",
        ].join(" "),
        temperature: mode === "expand" ? 0.25 : 0.15,
        maxOutputTokens: mode === "shorter" ? 900 : 1400,
        responseMimeType: "application/json",
      },
    });

    const text = result.text?.trim();
    if (!text)
      return NextResponse.json({ error: "Empty AI response" }, { status: 502 });
    const trimmed = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(trimmed) as { bodyPlain?: string };
    const bp =
      typeof parsed.bodyPlain === "string" ? parsed.bodyPlain.trim() : "";
    if (!bp)
      return NextResponse.json(
        { error: "Could not parse body" },
        { status: 502 },
      );

    return NextResponse.json({
      bodyHtml: plainToEmailHtml(bp),
      sourceTruncated: plain.includes("[…truncated]"),
    });
  } catch (e: unknown) {
    const { httpStatus, message } = mapGeminiClientError(e);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
