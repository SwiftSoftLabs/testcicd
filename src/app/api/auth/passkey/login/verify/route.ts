import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { query, SCHEMA } from "@/lib/db";
import { verifyLoginAuthentication } from "@/lib/passkeys/authenticate";
import { mintInsForgeSessionForUser } from "@/lib/passkeys/session-mint";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;
  if (!body?.response) {
    return NextResponse.json({ error: "Missing authentication response" }, { status: 400 });
  }
  try {
    const result = await verifyLoginAuthentication(body.response);
    if (!result.verified || !result.userId) {
      return NextResponse.json(
        { error: result.error ?? "Passkey verification failed" },
        { status: 400 },
      );
    }
    const profile = await query<{
      id: string;
      email: string;
      full_name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT u.id, u.email, p.full_name, p.avatar_url
       FROM auth.users u
       LEFT JOIN ${SCHEMA}.profiles p ON p.id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [result.userId],
    );
    const row = profile.rows[0];
    if (!row) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const session = await mintInsForgeSessionForUser(result.userId);
    if (!session) {
      return NextResponse.json(
        {
          error:
            "Passkey verified but session could not be created. Use password sign-in.",
          passkeyVerified: true,
        },
        { status: 501 },
      );
    }
    return NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: row.id,
        email: row.email,
        profile: {
          name: row.full_name ?? row.email.split("@")[0],
          avatar_url: row.avatar_url,
        },
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to complete passkey login";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
