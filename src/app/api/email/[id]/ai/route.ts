import { getUserFromRequest } from "@/lib/db";
import {
  getLatestDigestPayload,
  handleEmailAiPost,
  type EmailAiPostBody,
} from "@/lib/email/emailAiService";
import { ensureMailAiTables } from "@/lib/email/mailAiSchema";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: emailId } = await params;
  if (!emailId?.trim()) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  try {
    await ensureMailAiTables();
    const digest = await getLatestDigestPayload(user.id, emailId);
    if (!digest) return NextResponse.json(null, { status: 204 });
    return NextResponse.json(digest);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI is not configured." },
      { status: 503 },
    );
  }

  const { id: emailId } = await params;
  if (!emailId?.trim()) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  let body: EmailAiPostBody = {};
  try {
    body = (await request.json()) as EmailAiPostBody;
  } catch {
    body = {};
  }

  try {
    await ensureMailAiTables();
    const result = await handleEmailAiPost({
      userId: user.id,
      emailId,
      body,
      apiKey,
    });
    if (result.status === 429) {
      const retry = result.json.retryAfterSec as number | undefined;
      return NextResponse.json(
        { error: result.json.error },
        {
          status: 429,
          headers: retry ? { "Retry-After": String(retry) } : undefined,
        },
      );
    }
    return NextResponse.json(result.json, { status: result.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
