import { randomBytes } from "crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserFromRequest } from "@/lib/db";
import {
  calendarOAuthCallbackUrl,
  safeReturnTo,
  signCalendarOAuthState,
  type CalendarIntegrationProvider,
} from "@/lib/integrations/calendar/oauth";

const querySchema = z.object({
  returnTo: z.string().optional(),
  popup: z.enum(["1", "true", "0", "false"]).optional(),
});

function parseProvider(raw: string): CalendarIntegrationProvider {
  if (raw === "google") return "google_calendar";
  if (raw === "zoom") return "zoom";
  throw new Error("Unsupported calendar integration provider");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const provider = parseProvider((await context.params).provider);
    const q = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const popup = q.popup === "1" || q.popup === "true";
    const returnTo = safeReturnTo(request, q.returnTo);
    const state = signCalendarOAuthState({
      userId: user.id,
      provider,
      returnTo,
      popup,
      exp: Date.now() + 10 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    });

    if (provider === "google_calendar") {
      const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim();
      if (!clientId)
        return NextResponse.json(
          { error: "Google Calendar OAuth is not configured" },
          { status: 503 },
        );
      const auth = new URLSearchParams({
        client_id: clientId,
        redirect_uri: calendarOAuthCallbackUrl(provider),
        response_type: "code",
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/calendar",
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${auth.toString()}`,
      );
    }

    const clientId = process.env.ZOOM_CLIENT_ID?.trim();
    if (!clientId)
      return NextResponse.json(
        { error: "Zoom OAuth is not configured" },
        { status: 503 },
      );
    const auth = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: calendarOAuthCallbackUrl(provider),
      state,
    });
    return NextResponse.redirect(
      `https://zoom.us/oauth/authorize?${auth.toString()}`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.redirect(
      `${safeReturnTo(request, "/settings/plugins")}?calendarOAuth=error&error=${encodeURIComponent(msg)}`,
    );
  }
}
