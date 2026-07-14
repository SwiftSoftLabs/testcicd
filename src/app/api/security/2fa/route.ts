import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import {
  getSecuritySettings,
  toPublicMfaStatus,
} from "@/lib/security-settings";
import { hasValidStepUp } from "@/lib/mfa/step-up";
import { userHasMfaEnabled } from "@/lib/mfa/enabled";
import { countPasskeysForUser } from "@/lib/passkeys/db";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getSecuritySettings(user.id);
    const passkeyCount = await countPasskeysForUser(user.id);
    const mfaOn = await userHasMfaEnabled(user.id);
    return NextResponse.json({
      ...toPublicMfaStatus(settings, passkeyCount),
      vaultStepUpVerified: mfaOn ? hasValidStepUp(request, user.id) : true,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch 2FA status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
