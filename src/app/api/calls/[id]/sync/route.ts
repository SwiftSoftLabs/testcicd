import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { loadCallSync } from "@/lib/calls/serialize";
import { assertCallWithinDurationLimit } from "@/lib/billing/enforceCalls";

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

  if (call.status === "live" && call.started_at) {
    const durationLimit = await assertCallWithinDurationLimit(
      call.workspace_id,
      call.started_at,
    );
    if (!durationLimit.allowed) {
      return NextResponse.json(
        {
          error: durationLimit.error,
          code: durationLimit.code,
          duration_limit_reached: true,
        },
        { status: 403 },
      );
    }
  }

  try {
    const sync = await loadCallSync(call);
    return NextResponse.json(sync);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to sync call";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
