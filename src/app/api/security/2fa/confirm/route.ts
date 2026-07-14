import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import {
  getSecuritySettings,
  saveSecuritySettings,
} from "@/lib/security-settings";
import { decryptMfaSecret } from "@/lib/mfa/crypto";
import { verifyTotpCode } from "@/lib/mfa/totp";
import {
  generateBackupCodes,
  hashBackupCodes,
} from "@/lib/mfa/backup-codes";
import {
  buildSetCookieHeader,
  createStepUpToken,
} from "@/lib/mfa/step-up";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
  }
  try {
    const settings = await getSecuritySettings(user.id);
    if (!settings.pendingTotp) {
      return NextResponse.json(
        { error: "No pending setup. Start setup again." },
        { status: 400 },
      );
    }
    const { createdAt: _c, ...encrypted } = settings.pendingTotp;
    const secret = decryptMfaSecret(encrypted);
    if (!verifyTotpCode(secret, code)) {
      return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
    }
    const backupCodes = generateBackupCodes();
    const backupCodeHashes = await hashBackupCodes(backupCodes);
    await saveSecuritySettings(user.id, {
      twoFactorEnabled: true,
      totpSecret: encrypted,
      backupCodeHashes,
      pendingTotp: undefined,
    });
    // The user just proved possession of the authenticator, so grant the
    // vault step-up for this session instead of immediately re-prompting.
    const response = NextResponse.json({ backupCodes });
    response.headers.set(
      "Set-Cookie",
      buildSetCookieHeader(createStepUpToken(user.id)),
    );
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to confirm 2FA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
