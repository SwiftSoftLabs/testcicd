import crypto from "crypto";

import type { GitProvider } from "@/types/git";

function oauthStateSecret(): Buffer {
  const key = process.env.INSFORGE_API_KEY?.trim();
  if (!key) {
    throw new Error("INSFORGE_API_KEY is required for OAuth state signing");
  }
  return crypto
    .createHash("sha256")
    .update(`git-oauth-state:${key}`, "utf8")
    .digest();
}

export interface OAuthStatePayload {
  workspaceId: string;
  /** Project that will receive the linked repository selection after OAuth */
  projectId: string;
  userId: string;
  returnTo: string;
  provider: GitProvider;
  exp: number;
  nonce: string;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", oauthStateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(token: string): OAuthStatePayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    throw new Error("Invalid OAuth state");
  }
  const expected = crypto
    .createHmac("sha256", oauthStateSecret())
    .update(body)
    .digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new Error("Invalid OAuth state signature");
  }
  const raw = Buffer.from(body, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as OAuthStatePayload;
  if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) {
    throw new Error("OAuth state expired");
  }
  if (
    !parsed.workspaceId ||
    !parsed.projectId ||
    !parsed.userId ||
    !parsed.provider ||
    !parsed.returnTo
  ) {
    throw new Error("Malformed OAuth state");
  }
  return parsed;
}

export function getAppOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!u) {
    throw new Error("NEXT_PUBLIC_APP_URL is required for Git OAuth callbacks");
  }
  return new URL(u).origin;
}

export function oauthCallbackUrl(provider: GitProvider): string {
  return `${getAppOrigin()}/api/integrations/git/${provider}/oauth/callback`;
}
