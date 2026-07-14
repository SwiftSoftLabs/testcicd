import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import { stopAgentIfRunning } from "@/lib/calls/lifecycle";

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

  await stopAgentIfRunning(call);
  return NextResponse.json({ ok: true });
}
