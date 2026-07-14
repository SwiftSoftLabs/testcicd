import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import {
  assertActiveCallParticipant,
  isCallActiveForNotes,
  upsertPublicMeetingNotes,
} from "@/lib/calls/meetingNotes";
import {
  formatZodError,
  meetingNotesContentSchema,
} from "@/lib/calls/schemas";
import { publishCallNotesUpdate } from "@/lib/calls/realtime-publish";

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

  const saved = await upsertPublicMeetingNotes(
    id,
    user.id,
    parsed.data.content,
  );

  void publishCallNotesUpdate(id, {
    publicContent: saved.publicContent,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  }).catch(() => undefined);

  return NextResponse.json({
    publicContent: saved.publicContent,
    publicUpdatedAt: saved.updatedAt,
    publicUpdatedBy: saved.updatedBy,
  });
}
