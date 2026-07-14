import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/db";
import {
  safeReturnTo,
  verifyCalendarOAuthState,
  type CalendarIntegrationProvider,
} from "@/lib/integrations/calendar/oauth";
import {
  exchangeGoogleCalendarCode,
  fetchGoogleCalendarUser,
} from "@/lib/integrations/calendar/google";
import { upsertCalendarIntegration } from "@/lib/integrations/calendar/repository";
import {
  exchangeZoomCode,
  fetchZoomUser,
} from "@/lib/integrations/calendar/zoom";

function parseProvider(raw: string): CalendarIntegrationProvider {
  if (raw === "google") return "google_calendar";
  if (raw === "zoom") return "zoom";
  throw new Error("Unsupported calendar integration provider");
}

function popupResponse(payload: {
  status: "connected" | "error";
  error?: string;
}): NextResponse {
  const body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Calendar integration</title></head>
<body>
<script>
(function () {
  var msg = ${JSON.stringify({ source: "onework-calendar-oauth", ...payload })};
  try {
    if (window.opener && !window.opener.closed) window.opener.postMessage(msg, location.origin);
  } catch (e) {}
  window.close();
})();
</script>
<p style="font-family:system-ui">You can close this window.</p>
</body>
</html>`;
  return new NextResponse(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirectWith(
  returnTo: string,
  params: Record<string, string>,
): NextResponse {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return NextResponse.redirect(url.toString());
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const provider = parseProvider((await context.params).provider);
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") ?? "";
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");

  let payload;
  try {
    payload = verifyCalendarOAuthState(state);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Invalid OAuth state";
    return redirectWith(safeReturnTo(request, "/settings/plugins"), {
      calendarOAuth: "error",
      error: msg,
    });
  }

  const fail = (message: string) => {
    if (payload.popup)
      return popupResponse({ status: "error", error: message });
    return redirectWith(payload.returnTo, {
      calendarOAuth: "error",
      error: message,
    });
  };

  if (payload.provider !== provider)
    return fail("Provider mismatch. Try connecting again.");
  if (oauthError) return fail(oauthErrorDescription || oauthError);
  if (!code) return fail("Missing authorization code");

  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.redirect(
      `${new URL(payload.returnTo).origin}/login?error=calendar_oauth_unauthorized`,
    );
  if (user.id !== payload.userId)
    return fail("Session mismatch. Try connecting again.");

  try {
    if (provider === "google_calendar") {
      const token = await exchangeGoogleCalendarCode(code);
      const profile = await fetchGoogleCalendarUser(token.access_token);
      await upsertCalendarIntegration({
        userId: user.id,
        provider,
        accountEmail: profile.email,
        accountName: profile.name,
        accountId: profile.id,
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [
          "https://www.googleapis.com/auth/calendar",
        ],
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      });
    } else {
      const token = await exchangeZoomCode(code);
      const profile = await fetchZoomUser(token.access_token);
      await upsertCalendarIntegration({
        userId: user.id,
        provider,
        accountEmail: profile.email,
        accountName: profile.name,
        accountId: profile.id,
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      });
    }

    if (payload.popup) return popupResponse({ status: "connected" });
    return redirectWith(payload.returnTo, { calendarOAuth: "connected" });
  } catch (error: unknown) {
    return fail(
      error instanceof Error ? error.message : "Calendar integration failed",
    );
  }
}
