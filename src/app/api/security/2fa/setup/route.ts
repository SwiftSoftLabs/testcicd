import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getUserFromRequest } from "@/lib/db";
import {
  getSecuritySettings,
  saveSecuritySettings,
} from "@/lib/security-settings";
import { encryptMfaSecret } from "@/lib/mfa/crypto";
import { generateTotpSecret, buildTotpUri } from "@/lib/mfa/totp";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getSecuritySettings(user.id);
    if (settings.twoFactorEnabled && settings.totpSecret) {
      return NextResponse.json(
        { error: "TOTP is already enabled" },
        { status: 400 },
      );
    }
    const secret = generateTotpSecret();
    const encrypted = encryptMfaSecret(secret);
    await saveSecuritySettings(user.id, {
      pendingTotp: { ...encrypted, createdAt: new Date().toISOString() },
    });
    const uri = buildTotpUri(secret, user.email);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return NextResponse.json({ qrDataUrl, secret, manualEntryKey: secret });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to start 2FA setup";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
