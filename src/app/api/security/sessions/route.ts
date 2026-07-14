import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { createClient } from "@/lib/insforge/server";

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const insforge = await createClient();
    const { error } = await insforge.auth.signOut({ scope: "others" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to sign out other sessions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
