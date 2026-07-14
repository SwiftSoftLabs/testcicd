import {
  getSecuritySettings,
  isTotpEnrolled,
  type SecuritySettings,
} from "@/lib/security-settings";
import { countPasskeysForUser } from "@/lib/passkeys/db";

export async function userHasMfaEnabled(userId: string): Promise<boolean> {
  const settings = await getSecuritySettings(userId);
  return isUserMfaEnabled(settings, await countPasskeysForUser(userId));
}

export function isUserMfaEnabled(
  settings: SecuritySettings,
  passkeyCount: number,
): boolean {
  return isTotpEnrolled(settings) || passkeyCount > 0;
}
