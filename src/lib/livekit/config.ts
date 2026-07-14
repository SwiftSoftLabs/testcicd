import "server-only";

const IS_DEV = process.env.NODE_ENV === "development";

/** Built-in credentials for `livekit-server --dev`. */
const DEV_KEY = "devkey";
const DEV_SECRET = "secret";
const DEV_SERVER_URL = "http://127.0.0.1:7880";
const DEV_PUBLIC_URL = "ws://127.0.0.1:7880";

function requiredEnv(name: string, devFallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (IS_DEV && devFallback) return devFallback;
  throw new Error(`${name} is not configured`);
}

export function liveKitApiKey(): string {
  return requiredEnv("LIVEKIT_API_KEY", DEV_KEY);
}

export function liveKitApiSecret(): string {
  return requiredEnv("LIVEKIT_API_SECRET", DEV_SECRET);
}

export function liveKitServerUrl(): string {
  return requiredEnv("LIVEKIT_URL", DEV_SERVER_URL).replace(/\/$/, "");
}

export function liveKitPublicUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() ||
    process.env.LIVEKIT_URL?.trim() ||
    (IS_DEV ? DEV_PUBLIC_URL : undefined);
  if (!url) throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not configured");
  return url.replace(/\/$/, "");
}

export function liveKitAgentName(): string {
  return process.env.LIVEKIT_AGENT_NAME?.trim() || "onework-meeting-assistant";
}
