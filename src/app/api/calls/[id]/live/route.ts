import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { loadCallLivePayload } from "@/lib/calls/liveSession";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const lite = url.searchParams.get("lite") === "1";

  try {
    const payload = await loadCallLivePayload(
      id,
      (call.metadata ?? {}) as Record<string, unknown>,
      call.ai_enabled,
      {
        includeTranscript: !lite,
        agentDispatchId: call.livekit_agent_dispatch_id,
      },
    );
    return NextResponse.json(payload);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load live call data";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
