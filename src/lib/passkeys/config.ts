export function getWebAuthnConfig() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  const parsed = new URL(appUrl);
  const origin = parsed.origin;
  const rpID =
    process.env.WEBAUTHN_RP_ID?.trim() ||
    (parsed.hostname === "127.0.0.1" ? "localhost" : parsed.hostname);
  const rpName = process.env.WEBAUTHN_RP_NAME?.trim() || "OneWork";
  return { origin, rpID, rpName };
}

export function webAuthnUserIdBytes(userId: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(userId);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return new Uint8Array(buffer);
}
