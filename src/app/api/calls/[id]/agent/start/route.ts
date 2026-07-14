import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import { maybeStartAgent } from "@/lib/calls/lifecycle";
import { loadCallDetail } from "@/lib/calls/serialize";

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

  if (!call.ai_enabled) {
    return NextResponse.json(
      { error: "AI disabled for this call" },
      { status: 400 },
    );
  }

  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  await maybeStartAgent(call, appBase);
  const detail = await loadCallDetail((await getCallForMember(id, user.id))!);
  return NextResponse.json(detail);
}
