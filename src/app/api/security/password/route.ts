import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";

export async function POST(request: Request) {
  const fallbackUser = await getUserFromRequest(request);
  if (!fallbackUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword) {
    return NextResponse.json(
      { error: "Current password is required" },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 },
    );
  }
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must be different from current password" },
      { status: 400 },
    );
  }

  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const tokenPart = cookieHeader
      .split(";")
      .find((c) => c.trim().startsWith("sb-access-token="));
    const accessToken = tokenPart?.split("=").slice(1).join("=").trim();
    if (!accessToken) {
      return NextResponse.json(
        { error: "Auth session missing" },
        { status: 401 },
      );
    }

    const verifyUrl = new URL(
      "/auth/v1/token?grant_type=password",
      request.url,
    );
    const verifyRes = await fetch(verifyUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        email: fallbackUser.email,
        password: currentPassword,
      }),
    });
    if (!verifyRes.ok) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 },
      );
    }

    const insforgeBase = new URL(
      process.env.NEXT_PUBLIC_INSFORGE_URL || request.url,
    ).origin;
    const apikey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || "";
    const attempts: Array<{ method: "PUT" | "PATCH"; path: string }> = [
      { method: "PUT", path: "/api/auth/sessions/current" },
      { method: "PATCH", path: "/api/auth/sessions/current" },
      { method: "PUT", path: "/api/auth/users/me" },
      { method: "PATCH", path: "/api/auth/users/me" },
      { method: "PUT", path: `/api/auth/users/${fallbackUser.id}` },
      { method: "PATCH", path: `/api/auth/users/${fallbackUser.id}` },
      { method: "PUT", path: "/api/auth/users" },
      { method: "PATCH", path: "/api/auth/users" },
    ];

    let lastError = "Failed to update password";
    let updated = false;

    for (const attempt of attempts) {
      const url = `${insforgeBase}${attempt.path}`;
      const res = await fetch(url, {
        method: attempt.method,
        headers: {
          "Content-Type": "application/json",
          apikey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: fallbackUser.id,
          password: newPassword,
        }),
        cache: "no-store",
      });

      if (res.ok) {
        updated = true;
        break;
      }

      const payload = await res.json().catch(async () => {
        const text = await res.text().catch(() => "");
        return { error: text || undefined };
      });
      lastError =
        payload?.error ||
        payload?.message ||
        `${attempt.method} ${attempt.path} failed (${res.status})`;
    }

    if (!updated) {
      return NextResponse.json({ error: lastError }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update password";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
