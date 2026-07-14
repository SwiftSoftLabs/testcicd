/**
 * POST /api/auth/logout — deactivate presence, then clear app-origin auth cookies.
 */
import { NextResponse } from "next/server";
import {
  OW_REFRESH_TOKEN_COOKIE,
  SESSION_HINT_COOKIE,
} from "@/lib/auth/access-token-cookie";
import { getUserFromRequest } from "@/lib/db";
import { deactivateUserPresence } from "@/lib/presence/sync-presence";

function applyClearedAuthCookies(response: NextResponse): NextResponse {
  const base = {
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
  };

  response.cookies.set("sb-access-token", "", base);
  response.cookies.set(SESSION_HINT_COOKIE, "", base);
  response.cookies.set("insforge_csrf_token", "", base);
  response.cookies.set(OW_REFRESH_TOKEN_COOKIE, "", {
    ...base,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

export async function POST(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (user) {
      await deactivateUserPresence(user.id);
    }
  } catch (error: unknown) {
    console.error("[logout] deactivateUserPresence failed:", error);
  }

  return applyClearedAuthCookies(NextResponse.json({ ok: true }));
}
