const rawInsforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
const insforgeAnonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!rawInsforgeUrl) {
  throw new Error("Missing NEXT_PUBLIC_INSFORGE_URL");
}

if (!insforgeAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_INSFORGE_ANON_KEY");
}

let parsedInsforgeUrl: URL;

try {
  parsedInsforgeUrl = new URL(rawInsforgeUrl);
} catch {
  throw new Error(
    `Invalid NEXT_PUBLIC_INSFORGE_URL: "${rawInsforgeUrl}". Use a full URL like https://your-project.insforge.app`,
  );
}

export const INSFORGE_URL = parsedInsforgeUrl.origin;
export const INSFORGE_ANON_KEY = insforgeAnonKey;

// Supabase-compatible clients call /auth/v1 and /rest/v1.
// In this app, those paths are rewritten by proxy.ts to InsForge /api endpoints.
export const INSFORGE_PROXY_URL = appUrl?.trim() || "http://localhost:3000";
