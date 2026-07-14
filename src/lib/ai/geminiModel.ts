/**
 * Gemini model id for all server-side @google/genai calls.
 *
 * Default is a Flash-Lite tier (lowest typical cost). Override for production quality:
 *   GEMINI_MODEL=gemini-2.5-flash
 *
 * @see https://ai.google.dev/gemini-api/docs/models
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

/** Flash (not lite) handles audio/video reliably for call recordings. */
export const DEFAULT_GEMINI_MULTIMODAL_MODEL = "gemini-2.5-flash";

export function getGeminiModelId(): string {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return fromEnv || DEFAULT_GEMINI_MODEL;
}

export function getGeminiMultimodalModelId(): string {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return fromEnv || DEFAULT_GEMINI_MULTIMODAL_MODEL;
}
