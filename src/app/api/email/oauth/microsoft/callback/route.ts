import { NextResponse } from "next/server";

import {
  handleMailOAuthCallback,
  mailOAuthPopupResponse,
  redirectWithMailOAuth,
} from "@/lib/email/oauth/complete";
import { verifyMailOAuthState } from "@/lib/email/oauth/state";

export const runtime = "nodejs";

function safeOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* continue */
    }
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (oauthError) {
    const desc = (errorDescription || oauthError).trim();
    if (state) {
      try {
        const p = verifyMailOAuthState(state);
        if (p.popup) {
          return mailOAuthPopupResponse({ status: "error", error: desc });
        }
        return redirectWithMailOAuth(request, p.returnTo, {
          mailOAuth: "error",
          error: desc,
        });
      } catch {
        /* fall through */
      }
    }
    const origin = safeOrigin(request);
    return NextResponse.redirect(
      `${origin}/settings/plugins?mailOAuth=error&error=${encodeURIComponent(desc)}`,
    );
  }

  if (!code || !state) {
    const origin = safeOrigin(request);
    return NextResponse.redirect(
      `${origin}/settings/plugins?mailOAuth=error&error=${encodeURIComponent("Missing OAuth parameters")}`,
    );
  }

  return handleMailOAuthCallback(request, "microsoft", code, state);
}
