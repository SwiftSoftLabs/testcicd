import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";

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

  const res = await query(
    `SELECT * FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [id],
  );

  return NextResponse.json(res.rows[0] ?? null);
}
