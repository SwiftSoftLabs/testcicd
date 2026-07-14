import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";

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

  await query(
    `UPDATE ${SCHEMA}.call_recordings
     SET status = 'uploaded', updated_at = NOW()
     WHERE call_session_id = $1`,
    [id],
  );

  return NextResponse.json({ ok: true });
}
