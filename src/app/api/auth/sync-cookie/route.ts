/**
 * POST /api/auth/sync-cookie
 * Set sb-access-token (+ optional httpOnly refresh) server-side for API auth.
 */
import {
  OW_REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_HINT_COOKIE,
} from "@/lib/auth/access-token-cookie";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    const { accessToken, refreshToken } = body;

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "accessToken is required" },
        { status: 400 },
      );
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set("sb-access-token", accessToken, {
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: false,
    });
    response.cookies.set(SESSION_HINT_COOKIE, "1", {
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: false,
    });

    if (refreshToken && typeof refreshToken === "string") {
      response.cookies.set(OW_REFRESH_TOKEN_COOKIE, refreshToken, {
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
