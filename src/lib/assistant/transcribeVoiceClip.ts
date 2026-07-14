import { GoogleGenAI } from "@google/genai";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiMultimodalModelId } from "@/lib/ai/geminiModel";
import { normalizeVoiceCommandText } from "./assistantNavigation";

export const MIN_VOICE_AUDIO_BYTES = 1200;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_WORDS = 16;
const MAX_TRANSCRIPT_CHARS = 120;

export type VoiceTranscriptionResult = {
  transcript: string;
};

export function normalizeVoiceMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
  if (base.startsWith("audio/") || base.startsWith("video/webm")) {
    return base.startsWith("video/") ? "audio/webm" : base;
  }
  return "audio/webm";
}

function parseRawTranscript(text: string): string {
  const trimmed = text
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (/^\[empty\]$/i.test(trimmed)) return "";

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const raw =
      (typeof parsed.raw === "string" && parsed.raw.trim()) ||
      (typeof parsed.transcript === "string" && parsed.transcript.trim()) ||
      "";
    if (raw) return raw;
  } catch {
    /* fall through to plain text */
  }

  return trimmed.replace(/^["']|["']$/g, "").trim();
}

export function looksLikeHallucinatedSummary(text: string): boolean {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_TRANSCRIPT_WORDS) return true;
  if (text.length > MAX_TRANSCRIPT_CHARS) return true;
  if ((text.match(/[.!?]/g) ?? []).length >= 2) return true;
  return (
    /\b(team has|focused on|several tasks|current efforts|require immediate|completed several|high-priority bugs|ui improvements)\b/i.test(
      lower,
    ) || /\b(summary|summarize|overview|digest)\b/i.test(lower)
  );
}

function validateVoiceTranscript(transcript: string): void {
  if (!transcript.trim()) {
    throw new Error("Could not transcribe audio.");
  }
  if (looksLikeHallucinatedSummary(transcript)) {
    throw new Error(
      "Voice was not recognized as a short command. Try again or type below.",
    );
  }
}

export async function transcribeVoiceClip(opts: {
  apiKey: string;
  audioBuffer: Buffer;
  mimeType: string;
}): Promise<VoiceTranscriptionResult> {
  const { apiKey, audioBuffer, mimeType } = opts;
  if (audioBuffer.length === 0) {
    throw new Error("Empty audio recording.");
  }
  if (audioBuffer.length < MIN_VOICE_AUDIO_BYTES) {
    throw new Error(
      "Recording too quiet or too short. Hold the mic longer while you speak.",
    );
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    throw new Error("Recording is too long. Keep commands under 30 seconds.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const normalizedMime = normalizeVoiceMimeType(mimeType);

  try {
    const result = await ai.models.generateContent({
      model: getGeminiMultimodalModelId(),
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: normalizedMime,
                data: audioBuffer.toString("base64"),
              },
            },
            {
              text: [
                "Listen to the audio and write ONLY the exact words spoken.",
                "This is a short voice command (under 12 words).",
                "Do not summarize, answer, explain, or describe tasks or teams.",
                "If the clip is silent or unintelligible, reply with exactly: [empty]",
                "Otherwise reply with plain text only — no JSON, no quotes, no punctuation unless spoken.",
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 64,
      },
    });

    const text = result.text?.trim() ?? "";
    const transcript = normalizeVoiceCommandText(parseRawTranscript(text));
    validateVoiceTranscript(transcript);

    return { transcript };
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Voice was not recognized")) {
      throw e;
    }
    if (e instanceof Error && e.message.includes("Recording too quiet")) {
      throw e;
    }
    const mapped = mapGeminiClientError(e);
    throw Object.assign(new Error(mapped.message), {
      httpStatus: mapped.httpStatus,
    });
  }
}
