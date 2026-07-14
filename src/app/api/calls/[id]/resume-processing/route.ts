import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { runCallPostProcessing } from "@/lib/calls/callGeminiPostProcess";

export const maxDuration = 300;

/** Kick off transcript + summary for a call stuck in `processing` (throttled server-side). */
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

  if (!["processing", "failed"].includes(call.status)) {
    return NextResponse.json({ ok: true, skipped: true, status: call.status });
  }

  if (call.status === "failed") {
    await query(
      `DELETE FROM ${SCHEMA}.call_ai_artifacts WHERE call_session_id = $1`,
      [id],
    );
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  void runCallPostProcessing(id).catch((e: unknown) => {
    console.error("[resume-processing]", id, e);
  });

  return NextResponse.json({ ok: true, started: true });
}
