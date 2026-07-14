import {
  getSecuritySettings,
  saveSecuritySettings,
  isTotpEnrolled,
} from "@/lib/security-settings";
import { countPasskeysForUser } from "@/lib/passkeys/db";

export async function syncMfaEnabledFlag(userId: string): Promise<void> {
  const settings = await getSecuritySettings(userId);
  const passkeyCount = await countPasskeysForUser(userId);
  const hasMfa = isTotpEnrolled(settings) || passkeyCount > 0;
  if (settings.twoFactorEnabled !== hasMfa) {
    await saveSecuritySettings(userId, { twoFactorEnabled: hasMfa });
  }
}
