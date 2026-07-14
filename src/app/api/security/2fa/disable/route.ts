import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import {
  isTotpEnrolled,
  saveSecuritySettings,
} from "@/lib/security-settings";
import { getSecuritySettings } from "@/lib/security-settings";
import { verifyUserMfaCode } from "@/lib/mfa/verify";
import { buildClearCookieHeader } from "@/lib/mfa/step-up";
import { deleteAllPasskeysForUser } from "@/lib/passkeys/db";
import { userHasMfaEnabled } from "@/lib/mfa/enabled";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }
  try {
    if (!(await userHasMfaEnabled(user.id))) {
      return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 });
    }
    const settings = await getSecuritySettings(user.id);
    if (!isTotpEnrolled(settings)) {
      return NextResponse.json(
        { error: "Remove passkeys individually, or enable TOTP to disable all MFA with a code" },
        { status: 400 },
      );
    }
    const result = await verifyUserMfaCode(user.id, code);
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }
    await saveSecuritySettings(user.id, {
      twoFactorEnabled: false,
      totpSecret: undefined,
      backupCodeHashes: undefined,
      pendingTotp: undefined,
    });
    await deleteAllPasskeysForUser(user.id);
    const response = NextResponse.json({ disabled: true });
    response.headers.set("Set-Cookie", buildClearCookieHeader());
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to disable 2FA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
