/**
 * POST /api/auth/refresh-session
 * Refresh access JWT using (in order): SSR session, httpOnly refresh cookie,
 * or InsForge refresh via same-origin proxy cookies.
 */
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  OW_REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_HINT_COOKIE,
} from "@/lib/auth/access-token-cookie";
import { createClient } from "@/lib/insforge/server";

const INSFORGE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_INSFORGE_URL!).origin;
  } catch {
    return null;
  }
})();

const INSFORGE_ANON_KEY = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? "";


async function refreshViaInsforgeBrowserRefresh(
  refreshToken: string,
  csrf?: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: unknown;
} | null> {
  if (!INSFORGE_ORIGIN || !INSFORGE_ANON_KEY) return null;

  const res = await fetch(`${INSFORGE_ORIGIN}/api/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INSFORGE_ANON_KEY}`,
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
    },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    user?: unknown;
  } | null;

  if (!payload?.accessToken) return null;

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? refreshToken,
    user: payload.user ?? null,
  };
}

async function refreshViaInsforgeMobile(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: unknown;
} | null> {
  if (!INSFORGE_ORIGIN || !INSFORGE_ANON_KEY) return null;

  const res = await fetch(
    `${INSFORGE_ORIGIN}/api/auth/refresh?client_type=mobile`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INSFORGE_ANON_KEY}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    return null;
  }

  const payload = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    user?: unknown;
  } | null;

  if (!payload?.accessToken) return null;

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? refreshToken,
    user: payload.user ?? null,
  };
}

function jsonWithSessionCookies(
  accessToken: string,
  refreshToken: string,
  user: unknown,
): NextResponse {
  const response = NextResponse.json({
    accessToken,
    refreshToken,
    user,
  });

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
  response.cookies.set(OW_REFRESH_TOKEN_COOKIE, refreshToken, {
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    const supabase = await createClient();
    const {
      data: { session: existing },
    } = await supabase.auth.getSession();

    if (existing?.refresh_token) {
      const { data, error } = await supabase.auth.refreshSession();
      const session = data.session;
      if (!error && session?.access_token && session.refresh_token) {
        return jsonWithSessionCookies(
          session.access_token,
          session.refresh_token,
          session.user,
        );
      }
    }

    const owRefresh = cookieStore.get(OW_REFRESH_TOKEN_COOKIE)?.value;
    const csrf = cookieStore.get("insforge_csrf_token")?.value;

    if (owRefresh && csrf) {
      const refreshed = await refreshViaInsforgeBrowserRefresh(owRefresh, csrf);
      if (refreshed) {
        return jsonWithSessionCookies(
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.user,
        );
      }
    }

    if (owRefresh) {
      const refreshed = await refreshViaInsforgeMobile(owRefresh);
      if (refreshed) {
        return jsonWithSessionCookies(
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.user,
        );
      }
    }

    const accessCookie = cookieStore.get("sb-access-token")?.value;
    if (accessCookie) {
      const refreshed = await refreshViaInsforgeMobile(accessCookie);
      if (refreshed) {
        return jsonWithSessionCookies(
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.user,
        );
      }
    }

    const origin = request.nextUrl.origin;
    const browserRes = await fetch(`${origin}/auth/v1/refresh`, {
      method: "POST",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
      },
      body: JSON.stringify(
        owRefresh ? { refreshToken: owRefresh } : {},
      ),
      cache: "no-store",
    });

    if (browserRes.ok) {
      const payload = (await browserRes.json().catch(() => null)) as {
        accessToken?: string;
        refreshToken?: string;
        user?: unknown;
      } | null;
      if (payload?.accessToken) {
        const nextRt = payload.refreshToken ?? owRefresh ?? payload.accessToken;
        return jsonWithSessionCookies(
          payload.accessToken,
          nextRt,
          payload.user ?? null,
        );
      }
    }

    // Forward browser cookies to same-origin proxy refresh (login-time cookies)
    const proxyRefreshToken = owRefresh ?? accessCookie ?? "";
    const proxyRes = await fetch(
      `${origin}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ refresh_token: proxyRefreshToken }),
        cache: "no-store",
      },
    );

    if (proxyRes.ok) {
      const payload = (await proxyRes.json().catch(() => null)) as {
        accessToken?: string;
        refreshToken?: string;
        user?: unknown;
      } | null;
      if (payload?.accessToken) {
        const nextRt = payload.refreshToken ?? owRefresh ?? payload.accessToken;
        return jsonWithSessionCookies(
          payload.accessToken,
          nextRt,
          payload.user ?? null,
        );
      }
    }

    return NextResponse.json({ error: "No refresh session" }, { status: 401 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Refresh error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
