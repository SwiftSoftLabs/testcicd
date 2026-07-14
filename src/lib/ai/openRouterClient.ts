/** InsForge Model Gateway — OpenRouter key (run `npx @insforge/cli ai setup`). */

export const WHISPER_LARGE_V3 =
  process.env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() ||
  "openai/whisper-large-v3";

export function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key || null;
}

export function requireOpenRouterApiKey(): string {
  const key = getOpenRouterApiKey();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY not configured. Run: npx @insforge/cli@latest ai setup",
    );
  }
  return key;
}

export function openRouterDefaultHeaders(): Record<string, string> {
  const referer =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return {
    "HTTP-Referer": referer,
    "X-Title": "OneWork",
  };
}
