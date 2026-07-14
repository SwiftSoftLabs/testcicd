import { NextResponse } from "next/server";
import { z } from "zod";
import { createAccountScopedEventFromMailMessage } from "@/lib/calendar/email-events";
import { notifyEmailEventCreated } from "@/lib/calendar/notify-email-event";
import {
  dateTimeSchema,
  timezoneSchema,
  uuidSchema,
} from "@/lib/calendar/schemas";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { createClient } from "@/lib/insforge/server";

const createEventFromEmailSchema = z
  .object({
    mailMessageId: uuidSchema,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    startTime: dateTimeSchema,
    endTime: dateTimeSchema,
    timezone: timezoneSchema,
    isAllDay: z.boolean().optional().default(false),
  })
  .refine(
    (value) =>
      new Date(value.endTime).getTime() > new Date(value.startTime).getTime(),
    {
      message: "End time must be after start time",
      path: ["endTime"],
    },
  );

export async function POST(request: Request) {
  const insforge = await createClient();
  const {
    data: { user: sessionUser },
  } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
  const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
  const user = sessionUser
    ? { id: sessionUser.id, email: sessionUser.email ?? "" }
    : fallbackUser;
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEventFromEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const messageAccess = await query<{ id: string; subject: string }>(
      `SELECT mm.id, mm.subject
             FROM ${SCHEMA}.mail_messages mm
             JOIN ${SCHEMA}.mail_accounts ma
               ON ma.id = mm.account_id
             WHERE mm.id = $1
               AND ma.user_id = $2
             LIMIT 1`,
      [input.mailMessageId, user.id],
    );

    const mailRow = messageAccess.rows[0];
    if (!mailRow) {
      return NextResponse.json(
        { error: "Mail message not found" },
        { status: 404 },
      );
    }

    const { event, isNew } = await createAccountScopedEventFromMailMessage({
      ...input,
      createdBy: user.id,
    });

    if (isNew) {
      void notifyEmailEventCreated({
        userId: user.id,
        userEmail: user.email,
        event,
        sourceEmailSubject: mailRow.subject || "Email event",
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[api/events/from-email] notify failed:", message);
      });
    }

    return NextResponse.json(
      { event, updated: !isNew },
      { status: isNew ? 201 : 200 },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Mail message not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("[api/events/from-email POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
