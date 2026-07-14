import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { createRegistrationOptions } from "@/lib/passkeys/register";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { friendlyName?: string };
  try {
    const options = await createRegistrationOptions(
      user.id,
      user.email,
      body.friendlyName,
    );
    return NextResponse.json(options);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to create passkey options";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
