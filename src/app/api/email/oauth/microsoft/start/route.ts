import { randomBytes } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserFromRequest } from "@/lib/db";
import {
  mailOAuthCallbackUrl,
  signMailOAuthState,
} from "@/lib/email/oauth/state";
import { getAppOrigin } from "@/lib/integrations/git/oauth";

export const runtime = "nodejs";

const startQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  returnTo: z.string().optional(),
  popup: z.enum(["1", "true", "0", "false"]).optional(),
});

function safeReturnTo(request: Request, pathOrUrl: string | undefined): string {
  const origin = (() => {
    try {
      return getAppOrigin();
    } catch {
      return new URL(request.url).origin;
    }
  })();
  const raw = pathOrUrl?.trim() || "/settings/plugins";
  if (raw.startsWith("http")) {
    try {
      const u = new URL(raw);
      const o = new URL(origin);
      if (u.origin === o.origin && u.pathname.startsWith("/")) {
        return raw;
      }
    } catch {
      /* fallback */
    }
    return `${origin}/settings/plugins`;
  }
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/settings/plugins`;
}

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = startQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );
    const popup = q.popup === "1" || q.popup === "true";

    const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
      return NextResponse.json(
        { error: "Microsoft mailbox OAuth is not configured" },
        { status: 503 },
      );
    }

    const returnToAbsolute = safeReturnTo(request, q.returnTo);
    const state = signMailOAuthState({
      userId: user.id,
      workspaceId: q.workspaceId ?? null,
      returnTo: returnToAbsolute,
      provider: "microsoft",
      popup,
      exp: Date.now() + 10 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    });

    const redirectUri = mailOAuthCallbackUrl("microsoft");
    const scope = [
      "offline_access",
      "openid",
      "email",
      "https://graph.microsoft.com/Mail.ReadWrite",
      "https://graph.microsoft.com/Mail.Send",
    ].join(" ");

    const auth = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      state,
    });

    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${auth.toString()}`;
    return NextResponse.redirect(url);
  } catch (e: unknown) {
    const msg =
      e instanceof z.ZodError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Invalid request";
    const origin = (() => {
      try {
        return getAppOrigin();
      } catch {
        return new URL(request.url).origin;
      }
    })();
    return NextResponse.redirect(
      `${origin}/settings/plugins?mailOAuth=error&error=${encodeURIComponent(msg)}`,
    );
  }
}
