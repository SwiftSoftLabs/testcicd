import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getUserFromRequest } from "@/lib/db";
import { verifyRegistration } from "@/lib/passkeys/register";
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
    response?: RegistrationResponseJSON;
    friendlyName?: string;
  } | null;
  if (!body?.response) {
    return NextResponse.json({ error: "Missing registration response" }, { status: 400 });
  }
  try {
    const result = await verifyRegistration(
      user.id,
      body.response,
      body.friendlyName,
    );
    if (!result.verified) {
      return NextResponse.json({ error: result.error ?? "Verification failed" }, { status: 400 });
    }
    // Registration is a fresh WebAuthn ceremony with user verification, so
    // grant the vault step-up instead of immediately re-prompting.
    const response = NextResponse.json({ verified: true });
    response.headers.set(
      "Set-Cookie",
      buildSetCookieHeader(createStepUpToken(user.id)),
    );
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to verify passkey";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
