import crypto from "crypto";

const algorithm = "aes-256-gcm";
const ivLength = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.GIT_INTEGRATION_TOKEN_KEY?.trim();
  if (!raw) {
    throw new Error(
      "GIT_INTEGRATION_TOKEN_KEY is required for Git integration token encryption",
    );
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptGitToken(value: string): string {
  const iv = crypto.randomBytes(ivLength);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptGitToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted git token payload");
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
