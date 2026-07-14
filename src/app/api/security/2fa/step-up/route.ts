import { NextResponse } from "next/server";
import { buildClearCookieHeader } from "@/lib/mfa/step-up";

export async function DELETE() {
  const response = NextResponse.json({ cleared: true });
  response.headers.set("Set-Cookie", buildClearCookieHeader());
  return response;
}
