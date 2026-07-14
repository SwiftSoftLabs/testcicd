import { type NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: [
    "/auth/v1/:path*",
    "/rest/v1/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map|mp4|webm|obj|mtl)$).*)",
  ],
};

/** Routes that are always public — no session required. */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/auth/",
  "/api/",
  "/verify",
  "/models/",
];

/** The marketing homepage is public but authenticated users get redirected away. */
const MARKETING_HOME = "/";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Auth/DB Proxy: translate Supabase-compatible paths → InsForge endpoints ──
  if (pathname.startsWith("/auth/v1") || pathname.startsWith("/rest/v1")) {
    const targetUrl = new URL(process.env.NEXT_PUBLIC_INSFORGE_URL!);
    const rewriteUrl = new URL(targetUrl.origin);

    if (pathname === "/auth/v1/signup") {
      rewriteUrl.pathname = "/api/auth/users";
      // Mobile flow returns refreshToken in JSON (long-lived session via refresh).
      rewriteUrl.search = "?client_type=mobile";
    } else if (pathname === "/auth/v1/refresh") {
      // Browser session refresh (httpOnly refresh cookie + CSRF) — not mobile JSON body.
      rewriteUrl.pathname = "/api/auth/refresh";
    } else if (pathname === "/auth/v1/token") {
      const grantType = request.nextUrl.searchParams.get("grant_type");
      rewriteUrl.pathname =
        grantType === "refresh_token"
          ? "/api/auth/refresh"
          : "/api/auth/sessions";
      rewriteUrl.search = "?client_type=mobile";
    } else if (pathname === "/auth/v1/user") {
      rewriteUrl.pathname = "/api/auth/sessions/current";
    } else if (pathname === "/auth/v1/logout") {
      rewriteUrl.pathname = "/api/auth/logout";
    } else if (pathname.startsWith("/auth/v1")) {
      rewriteUrl.pathname = pathname.replace("/auth/v1", "/api/auth");
    } else if (pathname.startsWith("/rest/v1")) {
      rewriteUrl.pathname = pathname.replace(
        "/rest/v1",
        "/api/database/records",
      );
    }

    if (!rewriteUrl.search) rewriteUrl.search = request.nextUrl.search;

    const headers = new Headers(request.headers);
    if (!headers.has("Authorization")) {
      const apikey =
        headers.get("apikey") || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!;
      headers.set("Authorization", `Bearer ${apikey}`);
    }
    headers.delete("apikey");
    if (
      !headers.has("X-Role") &&
      rewriteUrl.pathname.startsWith("/api/database")
    ) {
      headers.set(
        "X-Role",
        `${process.env.NEXT_PUBLIC_DB_SCHEMA ?? "app_onework"}_user`,
      );
    }

    return NextResponse.rewrite(rewriteUrl, { request: { headers } });
  }

  // ── Session guard ─────────────────────────────────────────────────────────
  // Accept stale access JWT or session hint — client refreshes token after load.
  const token = request.cookies.get("sb-access-token")?.value;
  const sessionHint = request.cookies.get("ow-session")?.value === "1";
  const hasSession = Boolean(token) || sessionHint;

  // Public routes — always allow through
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  // Marketing homepage: public for unauthenticated, redirect auth users to dashboard
  if (pathname === MARKETING_HOME) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
