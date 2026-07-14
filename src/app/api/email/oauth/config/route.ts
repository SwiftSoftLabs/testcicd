import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const google = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  const microsoft = Boolean(
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() &&
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim(),
  );
  return NextResponse.json({
    googleConfigured: google,
    microsoftConfigured: microsoft,
  });
}
