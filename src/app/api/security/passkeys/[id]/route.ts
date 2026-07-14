import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { deletePasskeyForUser } from "@/lib/passkeys/db";
import { syncMfaEnabledFlag } from "@/lib/passkeys/sync-mfa";
import {
  getSecuritySettings,
  saveSecuritySettings,
  isTotpEnrolled,
} from "@/lib/security-settings";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(_request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const removed = await deletePasskeyForUser(user.id, id);
    if (!removed) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }
    await syncMfaEnabledFlag(user.id);
    const settings = await getSecuritySettings(user.id);
    if (!isTotpEnrolled(settings)) {
      await saveSecuritySettings(user.id, { twoFactorEnabled: false });
    }
    return NextResponse.json({ removed: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to remove passkey";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
