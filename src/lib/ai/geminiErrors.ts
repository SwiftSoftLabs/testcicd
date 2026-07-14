type GeminiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function tryParseGeminiJson(s: string): GeminiErrorBody | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as GeminiErrorBody;
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as GeminiErrorBody;
  } catch {
    return null;
  }
}

/**
 * Normalizes @google/genai failures into an HTTP status and a safe user-facing string.
 * The SDK often puts API error JSON in `Error.message`.
 */
export function mapGeminiClientError(error: unknown): {
  httpStatus: number;
  message: string;
} {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  const parsed = tryParseGeminiJson(raw);
  const api = parsed?.error;
  const apiCode = typeof api?.code === "number" ? api.code : undefined;
  const apiStatus = typeof api?.status === "string" ? api.status : undefined;
  const apiMessage =
    typeof api?.message === "string" && api.message.trim()
      ? api.message.trim()
      : raw.trim();

  const combined = `${apiMessage} ${apiStatus || ""}`.toLowerCase();

  if (
    apiCode === 429 ||
    apiStatus === "RESOURCE_EXHAUSTED" ||
    combined.includes("resource_exhausted") ||
    combined.includes("prepayment credits are depleted") ||
    combined.includes("quota exceeded")
  ) {
    return {
      httpStatus: 503,
      message:
        "Gemini has no usable quota for this API key (credits or billing). In Google AI Studio, open your project → Billing / API keys, add prepaid credits or a billing account, then try again. Docs: https://ai.google.dev/gemini-api/docs/billing",
    };
  }

  if (
    apiCode === 403 ||
    combined.includes("permission denied") ||
    combined.includes("consumer_suspended")
  ) {
    return {
      httpStatus: 503,
      message:
        "Gemini rejected the request (API disabled, key restrictions, or permissions). Check the key in Google AI Studio and that the Generative Language API is enabled.",
    };
  }

  if (
    combined.includes("api key not valid") ||
    combined.includes("invalid api key")
  ) {
    return {
      httpStatus: 503,
      message:
        "Gemini returned an invalid-request or API key error. Verify GEMINI_API_KEY and that it belongs to the intended Google Cloud / AI Studio project.",
    };
  }

  if (
    combined.includes("not a valid model") ||
    combined.includes("invalid model")
  ) {
    return {
      httpStatus: 503,
      message:
        "Gemini rejected the model id. Set GEMINI_MODEL in .env to a model your key supports (see https://ai.google.dev/gemini-api/docs/models).",
    };
  }

  const safe =
    apiMessage.length > 320
      ? `${apiMessage.slice(0, 317).trimEnd()}…`
      : apiMessage;
  return { httpStatus: 502, message: safe || "AI request failed." };
}
