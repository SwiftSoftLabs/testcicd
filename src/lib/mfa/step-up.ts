import crypto from "crypto";

export const MFA_STEP_UP_COOKIE = "ow-mfa-step-up";

function signingKey(): string {
  const key =
    process.env.MFA_STEP_UP_SECRET?.trim() ||
    process.env.INSFORGE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "MFA_STEP_UP_SECRET or INSFORGE_API_KEY is required for Vault step-up",
    );
  }
  return key;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/** Session-only Vault step-up — cleared when leaving /vault. */
export function createStepUpToken(userId: string): string {
  const payload = `${userId}.vault`;
  return `${payload}.${sign(payload)}`;
}

export function verifyStepUpToken(
  token: string | undefined,
  userId: string,
): boolean {
  if (!token) return false;
  const decoded = decodeURIComponent(token);
  const parts = decoded.split(".");
  if (parts.length !== 3) return false;
  const [tokenUserId, marker, signature] = parts;
  if (tokenUserId !== userId || marker !== "vault") return false;
  const payload = `${tokenUserId}.vault`;
  const expected = sign(payload);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

export function readStepUpCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie") || "";
  const part = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${MFA_STEP_UP_COOKIE}=`));
  return part?.split("=").slice(1).join("=").trim();
}

export function buildSetCookieHeader(value: string): string {
  const segments = [
    `${MFA_STEP_UP_COOKIE}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") segments.push("Secure");
  return segments.join("; ");
}

export function buildClearCookieHeader(): string {
  const segments = [
    `${MFA_STEP_UP_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") segments.push("Secure");
  return segments.join("; ");
}

export function hasValidStepUp(request: Request, userId: string): boolean {
  return verifyStepUpToken(readStepUpCookie(request), userId);
}
