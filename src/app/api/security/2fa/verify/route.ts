import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { verifyUserMfaCode } from "@/lib/mfa/verify";
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
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }
  try {
    const result = await verifyUserMfaCode(user.id, code);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not_enabled" ? "TOTP not enabled" : "Invalid code" },
        { status: 400 },
      );
    }
    const response = NextResponse.json({
      verified: true,
      usedBackup: result.usedBackup,
    });
    response.headers.set("Set-Cookie", buildSetCookieHeader(createStepUpToken(user.id)));
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to verify 2FA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
