import crypto from "crypto";
import { getVaultMasterKey } from "@/lib/vault/crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptMfaSecret(plaintext: string): EncryptedBlob {
  const key = getVaultMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

export function decryptMfaSecret(blob: EncryptedBlob): string {
  const key = getVaultMasterKey();
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.authTag, "base64");
  const data = Buffer.from(blob.ciphertext, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
