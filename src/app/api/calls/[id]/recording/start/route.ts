import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import { isCallRecordingEnabled } from "@/lib/calls/constants";

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

  if (!(await isCallHost(id, user.id))) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }

  if (!isCallRecordingEnabled()) {
    return NextResponse.json({ error: "Recording disabled" }, { status: 503 });
  }

  const existing = await query(
    `SELECT id FROM ${SCHEMA}.call_recordings WHERE call_session_id = $1 LIMIT 1`,
    [id],
  );
  if (!existing.rows[0]) {
    await query(
      `INSERT INTO ${SCHEMA}.call_recordings (call_session_id, status)
       VALUES ($1, 'recording')`,
      [id],
    );
  }

  return NextResponse.json({ ok: true, status: "recording" });
}
