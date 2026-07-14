import crypto from "crypto";

const algorithm = "aes-256-gcm";
const ivLength = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.MAIL_CREDENTIALS_SECRET?.trim();
  if (!raw) {
    throw new Error(
      "MAIL_CREDENTIALS_SECRET is required for mailbox credential encryption",
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptMailboxSecret(value: string): string {
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

export function decryptMailboxSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted mailbox credential payload");
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
