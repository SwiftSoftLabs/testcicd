import {
  openRouterDefaultHeaders,
  requireOpenRouterApiKey,
  WHISPER_LARGE_V3,
} from "@/lib/ai/openRouterClient";

const OPENROUTER_STT_URL =
  "https://openrouter.ai/api/v1/audio/transcriptions";

/** Matches LiveKit agent initial prompt for consistent meeting vocabulary. */
export const MEETING_TRANSCRIPTION_PROMPT =
  "OneWork video meeting. Participants discuss projects, tasks, deadlines, " +
  "action items, pull requests, and workspace updates.";

/** OpenRouter STT accepts ~25 MB per request; stay under Gemini inline limit. */
export const MAX_TRANSCRIPTION_BYTES = 18 * 1024 * 1024;

export function mimeToWhisperFormat(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "webm";
  if (base.includes("webm")) return "webm";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("wav")) return "wav";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("flac")) return "flac";
  if (base.includes("aac")) return "aac";
  return "webm";
}

type TranscriptionResponse = { text?: string; error?: { message?: string } };

/** Transcribe audio via InsForge Model Gateway (OpenRouter Whisper Large V3). */
export async function transcribeWithWhisperLargeV3(opts: {
  buffer: Buffer;
  mimeType: string;
  language?: string;
  prompt?: string;
  model?: string;
}): Promise<string> {
  const apiKey = requireOpenRouterApiKey();
  const format = mimeToWhisperFormat(opts.mimeType);
  const model = opts.model?.trim() || WHISPER_LARGE_V3;

  const body: Record<string, unknown> = {
    model,
    input_audio: {
      data: opts.buffer.toString("base64"),
      format,
    },
  };
  const lang = opts.language?.trim();
  if (lang) body.language = lang.split("-")[0];

  const prompt = opts.prompt?.trim();
  if (prompt) {
    body.provider = { options: { groq: { prompt } } };
  }

  const res = await fetch(OPENROUTER_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...openRouterDefaultHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = (await res.json().catch(() => ({}))) as TranscriptionResponse;
  if (!res.ok) {
    const detail =
      payload.error?.message ?? (await res.text().catch(() => res.statusText));
    throw new Error(`Whisper transcription failed (${res.status}): ${detail}`);
  }

  const text = (payload.text ?? "").trim();
  if (!text) {
    throw new Error("Whisper returned an empty transcript");
  }
  return text;
}

export function getWhisperTranscriptionModelId(): string {
  return WHISPER_LARGE_V3;
}
