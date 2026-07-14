import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { raiseHandSchema, formatZodError } from "@/lib/calls/schemas";
import { publishCallSyncUpdate } from "@/lib/calls/realtime-publish";

const ACTIVE = new Set(["live", "lobby"]);

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

  if (!ACTIVE.has(call.status)) {
    return NextResponse.json(
      { error: "Call is not active" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const parsed = raiseHandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }

  const activeMember = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.call_participants
     WHERE call_session_id = $1 AND user_id = $2
       AND joined_at IS NOT NULL AND left_at IS NULL
     LIMIT 1`,
    [id, user.id],
  );
  if (!activeMember.rows[0]) {
    return NextResponse.json(
      { error: "You must be in the call to raise your hand" },
      { status: 403 },
    );
  }

  const { raised } = parsed.data;
  const userKey = user.id;

  if (raised) {
    // Merge into metadata.raisedHands (single-segment jsonb_set); nested
    // ARRAY['raisedHands', $key] did not persist readable raisedHands on GET
    // with this stack's raw SQL / jsonb handling.
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{raisedHands}',
         COALESCE(metadata->'raisedHands', '{}'::jsonb)
           || jsonb_build_object($2::text, 'true'::jsonb),
         true
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [id, userKey],
    );
  } else {
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{raisedHands}',
         COALESCE(metadata->'raisedHands', '{}'::jsonb) - $2::text,
         true
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [id, userKey],
    );
  }

  void publishCallSyncUpdate(id).catch(() => undefined);

  return NextResponse.json({ ok: true, raised });
}
