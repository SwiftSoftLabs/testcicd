import { NextResponse } from "next/server";
import {
  createDiscoverableLoginOptions,
  createLoginOptions,
} from "@/lib/passkeys/login";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    discoverable?: boolean;
  };
  try {
    if (body.discoverable || !body.email?.trim()) {
      return NextResponse.json(await createDiscoverableLoginOptions());
    }
    return NextResponse.json(await createLoginOptions(body.email.trim()));
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to start passkey login";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
