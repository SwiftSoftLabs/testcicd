import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { roomNameForCall } from "@/lib/calls/constants";
import { buildLiveKitToken } from "@/lib/livekit/token";

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

  const roomName = roomNameForCall(call.workspace_id, id);
  if (call.livekit_room_name !== roomName) {
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET livekit_room_name = $2, updated_at = NOW() WHERE id = $1`,
      [id, roomName],
    );
  }

  const identity = user.id;
  await query(
    `UPDATE ${SCHEMA}.call_participants
     SET livekit_identity = $3
     WHERE call_session_id = $1 AND user_id = $2`,
    [id, user.id, identity],
  );

  const displayName = user.email ?? identity;

  try {
    const result = await buildLiveKitToken({
      roomName,
      identity,
      name: displayName,
      metadata: { user_id: user.id },
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Token generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
