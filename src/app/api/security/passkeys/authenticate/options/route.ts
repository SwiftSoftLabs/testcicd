import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { createAuthenticationOptions } from "@/lib/passkeys/authenticate";
import { userHasMfaEnabled } from "@/lib/mfa/enabled";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    if (!(await userHasMfaEnabled(user.id))) {
      return NextResponse.json({ error: "Enable 2FA or add a passkey first" }, { status: 400 });
    }
    return NextResponse.json(
      await createAuthenticationOptions(user.id, "authentication"),
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create auth options";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
