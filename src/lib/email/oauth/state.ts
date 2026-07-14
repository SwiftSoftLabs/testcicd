import crypto from "crypto";

import { getAppOrigin } from "@/lib/integrations/git/oauth";

export type MailOAuthProvider = "google" | "microsoft";

function mailOAuthStateSecret(): Buffer {
  const key = process.env.INSFORGE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "INSFORGE_API_KEY is required for mail OAuth state signing",
    );
  }
  return crypto
    .createHash("sha256")
    .update(`mail-oauth-state:${key}`, "utf8")
    .digest();
}

export interface MailOAuthStatePayload {
  userId: string;
  workspaceId: string | null;
  returnTo: string;
  provider: MailOAuthProvider;
  popup: boolean;
  exp: number;
  nonce: string;
}

export function signMailOAuthState(payload: MailOAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", mailOAuthStateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMailOAuthState(token: string): MailOAuthStatePayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    throw new Error("Invalid mail OAuth state");
  }
  const expected = crypto
    .createHmac("sha256", mailOAuthStateSecret())
    .update(body)
    .digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new Error("Invalid mail OAuth state signature");
  }
  const raw = Buffer.from(body, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as MailOAuthStatePayload;
  if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) {
    throw new Error("Mail OAuth state expired");
  }
  if (!parsed.userId || !parsed.provider || !parsed.returnTo) {
    throw new Error("Malformed mail OAuth state");
  }
  if (parsed.workspaceId !== null && typeof parsed.workspaceId !== "string") {
    throw new Error("Malformed mail OAuth state workspace");
  }
  if (typeof parsed.popup !== "boolean") {
    throw new Error("Malformed mail OAuth state popup flag");
  }
  return parsed;
}

export function mailOAuthCallbackUrl(provider: MailOAuthProvider): string {
  return `${getAppOrigin()}/api/email/oauth/${provider}/callback`;
}
