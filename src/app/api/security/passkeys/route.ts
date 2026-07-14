import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { listPasskeysForUser } from "@/lib/passkeys/db";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ passkeys: await listPasskeysForUser(user.id) });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to list passkeys";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
