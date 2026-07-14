import {
  getSecuritySettings,
  isTotpEnrolled,
  saveSecuritySettings,
  type SecuritySettings,
} from "@/lib/security-settings";
import { decryptMfaSecret } from "@/lib/mfa/crypto";
import { verifyTotpCode } from "@/lib/mfa/totp";
import { verifyBackupCode } from "@/lib/mfa/backup-codes";

export async function verifyUserMfaCode(
  userId: string,
  code: string,
): Promise<
  | { ok: true; usedBackup: boolean; settings: SecuritySettings }
  | { ok: false; reason: "not_enabled" | "invalid_code" }
> {
  const settings = await getSecuritySettings(userId);
  if (!isTotpEnrolled(settings) || !settings.totpSecret) {
    return { ok: false, reason: "not_enabled" };
  }

  const secret = decryptMfaSecret(settings.totpSecret);
  if (verifyTotpCode(secret, code)) {
    return { ok: true, usedBackup: false, settings };
  }

  const hashes = settings.backupCodeHashes ?? [];
  if (hashes.length > 0) {
    const backup = await verifyBackupCode(code, hashes);
    if (backup.valid) {
      const updated = await saveSecuritySettings(userId, {
        backupCodeHashes: backup.remainingHashes,
      });
      return { ok: true, usedBackup: true, settings: updated };
    }
  }

  return { ok: false, reason: "invalid_code" };
}
