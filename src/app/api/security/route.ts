import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import {
  getSecuritySettings,
  toPublicMfaStatus,
} from "@/lib/security-settings";
import { countPasskeysForUser } from "@/lib/passkeys/db";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getSecuritySettings(user.id);
    const passkeyCount = await countPasskeysForUser(user.id);
    return NextResponse.json({
      settings: toPublicMfaStatus(settings, passkeyCount),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch security settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && typeof body.twoFactorEnabled === "boolean") {
    return NextResponse.json(
      {
        error:
          "Use POST /api/security/2fa/setup and /confirm to enable TOTP, or passkey routes to add passkeys",
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: "No supported security fields in request body" },
    { status: 400 },
  );
}
