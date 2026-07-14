import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { GoogleGenAI } from "@google/genai";
import type { ChatMessageRow } from "./chatAccess";

export type ChatAiKind =
  | "improve"
  | "proofread"
  | "suggest_reply"
  | "thread_digest";

const MAX_MSG_CHARS = 2_000;
const MAX_TOTAL_CHARS = 24_000;

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function formatMessagesForPrompt(
  rows: ChatMessageRow[],
  currentUserId: string,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const row of rows) {
    const who =
      row.sender_id === currentUserId
        ? "You"
        : (row.sender_name || "User").trim().slice(0, 60);
    const body = truncate(row.content, MAX_MSG_CHARS);
    const line = `[${who}]: ${body}`;
    if (total + line.length > MAX_TOTAL_CHARS) {
      lines.push("[…earlier messages omitted]");
      break;
    }
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

async function generateJson(
  apiKey: string,
  systemInstruction: string,
  userTurn: string,
  maxOutputTokens: number,
  temperature: number,
): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: getGeminiModelId(),
    contents: userTurn,
    config: {
      systemInstruction,
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  });
  const text = result.text?.trim();
  if (!text) throw new Error("Empty AI response");
  return parseJsonObject(text);
}

function sanitizeReplies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.slice(0, 1_200));
    if (out.length >= 3) break;
  }
  return out;
}

export async function runChatAi(input: {
  apiKey: string;
  kind: ChatAiKind;
  userId: string;
  conversationName: string;
  conversationType: string;
  draft?: string;
  messages: ChatMessageRow[];
}): Promise<Record<string, unknown>> {
  const {
    apiKey,
    kind,
    userId,
    conversationName,
    conversationType,
    draft,
    messages,
  } = input;
  const thread = formatMessagesForPrompt(messages, userId);
  const label =
    conversationType === "dm"
      ? "direct message"
      : `channel #${conversationName || "chat"}`;

  if (kind === "thread_digest") {
    if (!messages.length) {
      return {
        summary: "No new messages since you last read this conversation.",
        focus: [],
        open_questions: [],
      };
    }
    const userTurn = [
      `Conversation (${label}):`,
      "",
      "Messages to summarize:",
      thread,
    ].join("\n");
    const parsed = await generateJson(
      apiKey,
      "Summarize the chat thread for someone catching up. Be factual; only use messages shown. " +
        'Respond with one JSON object only: {"summary":"2-4 sentences","focus":["up to 5 short bullets"],"open_questions":["0-3 bullets of unanswered asks"]}. ' +
        "No markdown.",
      userTurn,
      900,
      0.25,
    );
    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary.trim().slice(0, 2_000)
        : "";
    const focus = Array.isArray(parsed.focus)
      ? parsed.focus
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const open_questions = Array.isArray(parsed.open_questions)
      ? parsed.open_questions
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return {
      summary: summary || "No summary generated.",
      focus,
      open_questions,
    };
  }

  if (kind === "proofread") {
    const d = (draft || "").trim();
    if (!d) throw new Error("draft is required");
    const userTurn = [
      `Conversation (${label}):`,
      thread ? `\nRecent context:\n${thread.slice(-6_000)}` : "",
      `\nDraft to proofread:\n${truncate(d, 4_000)}`,
    ].join("\n");
    const parsed = await generateJson(
      apiKey,
      "Proofread the user's chat message: fix spelling, grammar, and punctuation only. " +
        "Do not change meaning, tone, or length noticeably. Do not add content. " +
        'Respond with one JSON object only: {"text":"..."}. Plain text only.',
      userTurn,
      700,
      0.1,
    );
    const text =
      typeof parsed.text === "string" ? parsed.text.trim().slice(0, 4_000) : "";
    if (!text) throw new Error("Could not parse proofread text");
    return { text };
  }

  if (kind === "suggest_reply") {
    if (!messages.length) throw new Error("No messages to reply to");
    const userTurn = [
      `Conversation (${label}):`,
      "",
      "Recent messages:",
      thread,
      draft?.trim() ? `\nUser's draft so far:\n${truncate(draft, 1_500)}` : "",
    ].join("\n");
    const parsed = await generateJson(
      apiKey,
      "Suggest 2-3 short reply options the user could send next. Match the thread tone; do not invent facts or commitments. " +
        'Respond with one JSON object only: {"replies":["...","..."]}. Each reply one short paragraph max. No markdown.',
      userTurn,
      700,
      0.35,
    );
    const replies = sanitizeReplies(parsed.replies);
    if (!replies.length) throw new Error("Could not parse reply suggestions");
    return { replies };
  }

  if (kind === "improve") {
    const d = (draft || "").trim();
    if (!d) throw new Error("draft is required");
    const userTurn = [
      `Conversation (${label}):`,
      thread ? `\nRecent context:\n${thread.slice(-8_000)}` : "",
      `\nDraft to improve:\n${truncate(d, 4_000)}`,
    ].join("\n");
    const parsed = await generateJson(
      apiKey,
      "Improve the user's chat message: clarity, grammar, natural tone. Keep intent and facts; do not add new promises. " +
        'Respond with one JSON object only: {"text":"..."}. Plain text only, no markdown.',
      userTurn,
      800,
      0.2,
    );
    const text =
      typeof parsed.text === "string" ? parsed.text.trim().slice(0, 4_000) : "";
    if (!text) throw new Error("Could not parse improved text");
    return { text };
  }

  throw new Error("Unsupported kind");
}

export function mapChatAiError(e: unknown): {
  httpStatus: number;
  message: string;
} {
  return mapGeminiClientError(e);
}
