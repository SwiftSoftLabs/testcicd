import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import {
  type CalendarRow,
  assertWorkspaceMember,
  mapCalendarRow,
} from "@/lib/calendar/db";
import { createCalendarSchema } from "@/lib/calendar/schemas";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  try {
    const hasAccess = await assertWorkspaceMember(workspaceId, user.id);
    if (!hasAccess)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const result = await query<CalendarRow>(
      `SELECT *
             FROM ${SCHEMA}.calendars
             WHERE workspace_id = $1
             ORDER BY is_default DESC, created_at ASC`,
      [workspaceId],
    );

    return NextResponse.json({ calendars: result.rows.map(mapCalendarRow) });
  } catch (error: unknown) {
    console.error("[api/calendars GET]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createCalendarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const input = parsed.data;

  try {
    const hasAccess = await assertWorkspaceMember(input.workspaceId, user.id);
    if (!hasAccess)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (input.isDefault) {
      const defaultCalendar = await query<CalendarRow>(
        `SELECT *
                 FROM ${SCHEMA}.calendars
                 WHERE workspace_id = $1
                   AND is_default = true
                 LIMIT 1`,
        [input.workspaceId],
      );

      if (defaultCalendar.rows[0]) {
        return NextResponse.json({
          calendar: mapCalendarRow(defaultCalendar.rows[0]),
        });
      }
    }

    const existing = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${SCHEMA}.calendars WHERE workspace_id = $1`,
      [input.workspaceId],
    );
    const shouldBeDefault =
      input.isDefault || Number(existing.rows[0]?.count ?? 0) === 0;

    if (shouldBeDefault) {
      await query(
        `UPDATE ${SCHEMA}.calendars
                 SET is_default = false, updated_at = NOW()
                 WHERE workspace_id = $1`,
        [input.workspaceId],
      );
    }

    const result = await query<CalendarRow>(
      `INSERT INTO ${SCHEMA}.calendars
                (workspace_id, created_by, name, color, timezone, is_default)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
      [
        input.workspaceId,
        user.id,
        input.name,
        input.color ?? null,
        input.timezone,
        shouldBeDefault,
      ],
    );

    return NextResponse.json(
      { calendar: mapCalendarRow(result.rows[0]) },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("[api/calendars POST]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
