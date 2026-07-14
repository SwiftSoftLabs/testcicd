import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import { runCallPostProcessing } from "@/lib/calls/callGeminiPostProcess";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { CALL_AI_RATE_LIMIT_PER_DAY } from "@/lib/calls/constants";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const host = await isCallHost(id, user.id);
  if (!host) return NextResponse.json({ error: "Host only" }, { status: 403 });

  const rate = checkSimpleRateLimit(
    `call-ai:${user.id}`,
    CALL_AI_RATE_LIMIT_PER_DAY,
    86_400_000,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Daily AI limit reached" },
      { status: 429 },
    );
  }

  void runCallPostProcessing(id).catch((e: unknown) => {
    console.error("[process-ai]", id, e);
  });
  return NextResponse.json({ ok: true, started: true });
}
