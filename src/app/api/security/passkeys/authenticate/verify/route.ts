import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getUserFromRequest } from "@/lib/db";
import { verifyAuthentication } from "@/lib/passkeys/authenticate";
import {
  buildSetCookieHeader,
  createStepUpToken,
} from "@/lib/mfa/step-up";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;
  if (!body?.response) {
    return NextResponse.json({ error: "Missing authentication response" }, { status: 400 });
  }
  try {
    const result = await verifyAuthentication(
      user.id,
      body.response,
      "authentication",
    );
    if (!result.verified) {
      return NextResponse.json({ error: result.error ?? "Verification failed" }, { status: 400 });
    }
    const response = NextResponse.json({ verified: true });
    response.headers.set("Set-Cookie", buildSetCookieHeader(createStepUpToken(user.id)));
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to verify passkey";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
