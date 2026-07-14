import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { finalizeCallAfterParticipantLeave } from "@/lib/calls/lifecycle";
import { publishCallSyncUpdate } from "@/lib/calls/realtime-publish";

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

  await query(
    `UPDATE ${SCHEMA}.call_participants
     SET left_at = NOW()
     WHERE call_session_id = $1 AND user_id = $2`,
    [id, user.id],
  );

  void finalizeCallAfterParticipantLeave(id).catch(() => undefined);
  void publishCallSyncUpdate(id).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
