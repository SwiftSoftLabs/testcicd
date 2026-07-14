import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_HINT_COOKIE,
} from "@/lib/auth/access-token-cookie";
import { createClient } from "@/lib/insforge/server";
import { query } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const insforge = await createClient();
    const { data, error } = await insforge.auth.exchangeCodeForSession(code);

    if (!error && data?.session) {
      const { session } = data;

      // MANIFEST §3: tag OAuth users with app_origin at sign-in time
      const appOrigin = process.env.NEXT_PUBLIC_DB_SCHEMA ?? "app_onework";
      await query(
        `UPDATE auth.users
                 SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('app_origin', $2)
                 WHERE id = $1
                   AND (metadata->>'app_origin' IS NULL OR metadata->>'app_origin' != $2)`,
        [session.user.id, appOrigin],
      ).catch(() => {});

      const redirectUrl =
        process.env.NODE_ENV === "development"
          ? `${origin}${next}`
          : `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("x-forwarded-host") || new URL(origin).host}${next}`;

      const response = NextResponse.redirect(redirectUrl);

      // Set our manual cookie so proxy session guard can read it.
      // InsForge OAuth returns a session with access_token via Supabase SSR.
      const accessToken = session.access_token;
      if (accessToken) {
        response.cookies.set("sb-access-token", accessToken, {
          path: "/",
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
          sameSite: "lax",
          httpOnly: false, // needs to be readable by JS for AppContext fallback
        });
        response.cookies.set(SESSION_HINT_COOKIE, "1", {
          path: "/",
          maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
          sameSite: "lax",
          httpOnly: false,
        });
      }

      return response;
    }
  }

  // OAuth failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
}
