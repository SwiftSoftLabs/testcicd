import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import {
  filterWorkspaceMemberIds,
  getCallForMember,
  isCallHost,
} from "@/lib/calls/access";
import { callInviteMoreSchema, formatZodError } from "@/lib/calls/schemas";
import { notifyCallParticipants } from "@/lib/calls/notifications";
import { postCallInviteMessages } from "@/lib/calls/chat";
import { CALL_MAX_PARTICIPANTS } from "@/lib/calls/constants";

const JOINABLE = new Set(["live", "lobby", "scheduled"]);

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

  if (!JOINABLE.has(call.status)) {
    return NextResponse.json(
      { error: "Call is not accepting invites" },
      { status: 400 },
    );
  }

  if (!(await isCallHost(id, user.id))) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = callInviteMoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }

  const { participant_ids } = parsed.data;
  const { valid, invalid } = await filterWorkspaceMemberIds(
    call.workspace_id,
    participant_ids,
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "One or more users are not in this workspace" },
      { status: 400 },
    );
  }

  const uniqueNew = [...new Set(valid)].filter((pid) => pid !== user.id);
  if (uniqueNew.length === 0) {
    return NextResponse.json(
      { error: "No new invitees to add" },
      { status: 400 },
    );
  }

  const existing = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [id],
  );
  const existingSet = new Set(existing.rows.map((r) => r.user_id));
  const toAdd = uniqueNew.filter((pid) => !existingSet.has(pid));
  if (toAdd.length === 0) {
    return NextResponse.json({ ok: true, added: [] as string[] });
  }

  const countRes = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [id],
  );
  const currentCount = parseInt(countRes.rows[0]?.n ?? "0", 10);
  if (currentCount + toAdd.length > CALL_MAX_PARTICIPANTS) {
    return NextResponse.json(
      { error: `Maximum ${CALL_MAX_PARTICIPANTS} participants` },
      { status: 400 },
    );
  }

  for (const pid of toAdd) {
    await query(
      `INSERT INTO ${SCHEMA}.call_participants (call_session_id, user_id, role)
       VALUES ($1, $2, 'participant')
       ON CONFLICT (call_session_id, user_id) DO NOTHING`,
      [id, pid],
    );
  }

  const title = call.title?.trim() || "Meeting";
  try {
    await notifyCallParticipants(
      toAdd,
      "Call invitation",
      `${title} — join in OneWork Calls`,
      "call_invite",
      id,
      "callInvites",
    );
  } catch (notifyErr: unknown) {
    const msg =
      notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
    console.error("[api/calls invite] notification failed:", msg);
  }

  try {
    await postCallInviteMessages(
      call.workspace_id,
      user.id,
      id,
      title,
      toAdd,
      call.conversation_id,
    );
  } catch (chatErr: unknown) {
    const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
    console.error("[api/calls invite] chat message failed:", msg);
  }

  return NextResponse.json({ ok: true, added: toAdd });
}
