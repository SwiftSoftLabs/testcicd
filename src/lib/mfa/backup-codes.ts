import crypto from "crypto";
import bcrypt from "bcryptjs";

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(8);
    codes.push(
      raw
        .toString("base64url")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8)
        .toUpperCase(),
    );
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
}

export async function verifyBackupCode(
  code: string,
  hashes: string[],
): Promise<{ valid: boolean; remainingHashes: string[] }> {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      return { valid: true, remainingHashes: hashes.filter((_, idx) => idx !== i) };
    }
  }
  return { valid: false, remainingHashes: hashes };
}
