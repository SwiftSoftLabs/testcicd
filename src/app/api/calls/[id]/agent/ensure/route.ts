import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { forceRedispatchAgent } from "@/lib/calls/lifecycle";

/** Re-dispatch the LiveKit STT agent (e.g. worker was offline when the call started). */
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

  if (!call.ai_enabled) {
    return NextResponse.json(
      { error: "AI disabled for this call" },
      { status: 400 },
    );
  }

  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  await forceRedispatchAgent(call, appBase);

  return NextResponse.json({ ok: true });
}
