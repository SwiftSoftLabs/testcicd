import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import {
  assertActiveCallParticipant,
  isCallActiveForNotes,
  upsertPrivateMeetingNotes,
} from "@/lib/calls/meetingNotes";
import {
  formatZodError,
  meetingNotesContentSchema,
} from "@/lib/calls/schemas";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isCallActiveForNotes(call.status)) {
    return NextResponse.json(
      { error: "Call is not active" },
      { status: 400 },
    );
  }

  const inCall = await assertActiveCallParticipant(id, user.id);
  if (!inCall) {
    return NextResponse.json(
      { error: "You must be in the call to edit notes" },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = meetingNotesContentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }

  await upsertPrivateMeetingNotes(id, user.id, parsed.data.content);

  return NextResponse.json({ ok: true });
}
