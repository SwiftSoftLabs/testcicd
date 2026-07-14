import {
  getOpenRouterApiKey,
  openRouterDefaultHeaders,
  requireOpenRouterApiKey,
} from "@/lib/ai/openRouterClient";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Live notes during calls — high frequency (~1/min). */
export const DEFAULT_OPENROUTER_CHAT_MODEL = "google/gemini-2.5-flash-lite";

/** End-of-call summary + action items — low frequency. */
export const DEFAULT_OPENROUTER_SUMMARY_MODEL = "google/gemini-2.5-flash";

/** Cap transcript sent to summary models (matches live final pass). */
export const MEETING_AI_TRANSCRIPT_CAP = 12_000;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export function isOpenRouterMeetingAiConfigured(): boolean {
  return !!getOpenRouterApiKey();
}

export function getOpenRouterChatModelId(): string {
  return (
    process.env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_OPENROUTER_CHAT_MODEL
  );
}

export function getOpenRouterSummaryModelId(): string {
  return (
    process.env.OPENROUTER_SUMMARY_MODEL?.trim() ||
    process.env.OPENROUTER_CHAT_MODEL?.trim() ||
    DEFAULT_OPENROUTER_SUMMARY_MODEL
  );
}

export function capTranscriptForMeetingAi(transcript: string): string {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  return trimmed.slice(-MEETING_AI_TRANSCRIPT_CAP);
}

export function mapOpenRouterClientError(error: unknown): {
  httpStatus: number;
  message: string;
} {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized")
  ) {
    return {
      httpStatus: 503,
      message:
        "OpenRouter rejected the API key. Run: npx @insforge/cli@latest ai setup",
    };
  }

  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      httpStatus: 503,
      message: "Model gateway rate limit reached. Try again in a minute.",
    };
  }

  if (lower.includes("402") || lower.includes("insufficient")) {
    return {
      httpStatus: 503,
      message: "Model gateway credits depleted. Add credits in InsForge dashboard.",
    };
  }

  const safe =
    raw.length > 320 ? `${raw.slice(0, 317).trimEnd()}…` : raw.trim();
  return { httpStatus: 502, message: safe || "Model gateway request failed." };
}

export async function openRouterChatCompletion(opts: {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<{ text: string; model: string }> {
  const apiKey = requireOpenRouterApiKey();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemInstruction },
      { role: "user", content: opts.userPrompt },
    ],
    temperature: opts.temperature ?? 0.15,
    max_tokens: opts.maxTokens ?? 2000,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...openRouterDefaultHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!res.ok) {
    const detail =
      payload.error?.message ?? (await res.text().catch(() => res.statusText));
    throw new Error(`OpenRouter chat failed (${res.status}): ${detail}`);
  }

  const text = (payload.choices?.[0]?.message?.content ?? "").trim();
  if (!text) {
    throw new Error("OpenRouter returned an empty response");
  }
  return { text, model: opts.model };
}
