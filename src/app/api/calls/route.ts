import { NextResponse } from "next/server";
import { getUserFromRequest, query, buildInsert, SCHEMA } from "@/lib/db";
import {
  assertCanStartCall,
  assertWorkspaceMember,
  filterWorkspaceMemberIds,
} from "@/lib/calls/access";
import { assertProjectWritable } from "@/lib/billing/quota-locks";
import { toAccessResponse } from "@/lib/rbac/http";
import {
  createCallSchema,
  formatZodError,
  resolveScheduledEndIso,
} from "@/lib/calls/schemas";
import {
  assertProjectInWorkspace,
  getCalendarInWorkspace,
  getDefaultWorkspaceCalendar,
  insertManualWorkspaceEvent,
} from "@/lib/calendar/db";
import {
  roomNameForCall,
  CALL_MAX_PARTICIPANTS,
} from "@/lib/calls/constants";
import {
  checkCallDurationLimit,
} from "@/lib/billing/enforceCalls";
import { notifyCallParticipants } from "@/lib/calls/notifications";
import { postCallInviteMessages } from "@/lib/calls/chat";
import { dispatchScheduledReminders, reconcileStaleCallSessions } from "@/lib/calls/lifecycle";
import { expireCallRecordingRetention } from "@/lib/calls/recordingRetention";
import {
  buildRecurrenceDescriptionNote,
  buildRecurrencePlan,
  CALLS_RECURRENCE_OPTIONS,
  type RecurrenceFrequency,
} from "@/lib/calls/recurrence";
import { randomUUID } from "crypto";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const tab = searchParams.get("tab") ?? "home";

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const member = await assertWorkspaceMember(workspaceId, user.id);
  if (!member)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  void dispatchScheduledReminders(workspaceId);
  void expireCallRecordingRetention(workspaceId);
  await reconcileStaleCallSessions(workspaceId);

  const upcoming = searchParams.get("upcoming") === "1";
  const activeCountSql =
    tab === "home"
      ? `, (SELECT COUNT(*)::int FROM ${SCHEMA}.call_participants cp
              WHERE cp.call_session_id = cs.id AND cp.left_at IS NULL AND cp.joined_at IS NOT NULL) AS active_count`
      : ``;

  const scheduledStillActiveSql = `(
    cs.scheduled_start_at IS NOT NULL
    AND COALESCE(cs.scheduled_end_at, cs.scheduled_start_at + INTERVAL '60 minutes') >= NOW()
  )`;

  const defaultLimit = 5;
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit,
    100,
  );
  const offset = parseInt(searchParams.get("offset") ?? "0", 10) || 0;

  if (upcoming) {
    try {
      const result = await query(
        `SELECT cs.*${activeCountSql}
         FROM ${SCHEMA}.call_sessions cs
         WHERE cs.workspace_id = $1
           AND cs.status = 'scheduled'
           AND ${scheduledStillActiveSql}
         ORDER BY cs.scheduled_start_at ASC
         LIMIT 1`,
        [workspaceId],
      );
      return NextResponse.json(result.rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("call_sessions") && msg.includes("does not exist")) {
        return NextResponse.json(
          {
            error:
              "Calls database tables not set up yet. Run sql/calls_migration.sql in InsForge.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  let statusFilter = "";
  let orderBy = "ORDER BY COALESCE(cs.scheduled_start_at, cs.created_at) DESC";
  if (tab === "history") {
    statusFilter = `AND status IN ('completed', 'processing', 'failed')`;
  } else if (tab === "scheduled") {
    statusFilter = `AND status = 'scheduled'`;
  } else if (tab === "home") {
    statusFilter = `AND (
      cs.status IN ('lobby', 'live')
      OR (cs.status = 'scheduled' AND ${scheduledStillActiveSql})
    )`;
    orderBy = `ORDER BY
      CASE cs.status WHEN 'live' THEN 0 WHEN 'lobby' THEN 1 ELSE 2 END,
      CASE WHEN cs.status = 'scheduled' THEN cs.scheduled_start_at END ASC NULLS LAST,
      cs.created_at DESC`;
  }

  try {
    const result = await query(
      `SELECT cs.*${activeCountSql}
       FROM ${SCHEMA}.call_sessions cs
       WHERE cs.workspace_id = $1 ${statusFilter}
       ${orderBy}
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset],
    );
    return NextResponse.json(result.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("call_sessions") && msg.includes("does not exist")) {
      return NextResponse.json(
        {
          error:
            "Calls database tables not set up yet. Run sql/calls_migration.sql in InsForge.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const canStart = await assertCanStartCall(data.workspace_id, user.id);
  if (!canStart.allowed) {
    return NextResponse.json({ error: canStart.reason }, { status: 403 });
  }

  if (data.project_id) {
    try {
      await assertProjectWritable(data.project_id);
    } catch (e) {
      const access = toAccessResponse(e);
      if (access) return access;
      throw e;
    }
  }

  const inviteIds = data.participant_ids ?? [];
  const { valid: validInvitees, invalid: invalidInvitees } =
    await filterWorkspaceMemberIds(data.workspace_id, inviteIds);
  if (invalidInvitees.length > 0) {
    return NextResponse.json(
      { error: "One or more invited users are not in this workspace" },
      { status: 400 },
    );
  }

  const participantIds = new Set(validInvitees);
  participantIds.add(user.id);
  if (participantIds.size > CALL_MAX_PARTICIPANTS) {
    return NextResponse.json(
      { error: `Maximum ${CALL_MAX_PARTICIPANTS} participants` },
      { status: 400 },
    );
  }

  const isScheduled = Boolean(data.scheduled_start_at);

  if (!isScheduled) {
    const type =
      data.type ?? (participantIds.size <= 2 ? "instant_1_1" : "instant_group");
    const recordingEnabled = data.recording_enabled ?? true;
    const recordingRetention = data.recording_retention ?? "forever";
    const callTitle = (data.title?.trim() || "Meeting") as string;

    const { sql, params } = buildInsert(`${SCHEMA}.call_sessions`, {
      workspace_id: data.workspace_id,
      project_id: data.project_id ?? null,
      conversation_id: data.conversation_id ?? null,
      calendar_event_id: data.calendar_event_id ?? null,
      created_by: user.id,
      title: callTitle,
      type,
      status: "lobby",
      scheduled_start_at: null,
      scheduled_end_at: null,
      recording_enabled: recordingEnabled,
      ai_enabled: data.ai_enabled ?? true,
    });

    let insertRes: Awaited<ReturnType<typeof query>>;
    try {
      insertRes = await query(sql, params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("call_sessions") && msg.includes("does not exist")) {
        return NextResponse.json(
          {
            error:
              "Calls database tables not set up yet. Run sql/calls_migration.sql in InsForge.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const call = insertRes.rows[0] as Record<string, unknown>;
    const callId = call.id as string;

    try {
      const roomName = roomNameForCall(data.workspace_id, callId);
      await query(
        `UPDATE ${SCHEMA}.call_sessions
         SET livekit_room_name = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          callId,
          roomName,
          JSON.stringify({ recording_retention: recordingRetention }),
        ],
      );

      for (const pid of participantIds) {
        const role = pid === user.id ? "host" : "participant";
        await query(
          `INSERT INTO ${SCHEMA}.call_participants (call_session_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (call_session_id, user_id) DO NOTHING`,
          [callId, pid, role],
        );
      }

      const invitees = [...participantIds].filter((id) => id !== user.id);
      const inviteErrors: string[] = [];

      try {
        await notifyCallParticipants(
          invitees,
          "Call invitation",
          `${callTitle} — join in OneWork Calls`,
          "call_invite",
          callId,
          "callInvites",
        );
      } catch (notifyErr: unknown) {
        const msg =
          notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
        inviteErrors.push(`notifications: ${msg}`);
      }

      try {
        await postCallInviteMessages(
          data.workspace_id,
          user.id,
          callId,
          callTitle,
          invitees,
          data.conversation_id,
        );
      } catch (chatErr: unknown) {
        const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        inviteErrors.push(`chat: ${msg}`);
      }

      return NextResponse.json({
        ...call,
        livekit_room_name: roomName,
        ...(inviteErrors.length > 0 ? { invite_warnings: inviteErrors } : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const scheduledEndIso = resolveScheduledEndIso({
    scheduled_start_at: data.scheduled_start_at!,
    scheduled_end_at: data.scheduled_end_at,
    meeting_length_minutes: data.meeting_length_minutes,
  });
  const startMs = new Date(data.scheduled_start_at!).getTime();
  const durationMs = new Date(scheduledEndIso).getTime() - startMs;
  const scheduledMinutes = Math.max(1, Math.ceil(durationMs / 60_000));

  const durationLimit = await checkCallDurationLimit(
    data.workspace_id,
    scheduledMinutes,
  );
  if (!durationLimit.allowed) {
    return NextResponse.json(
      { error: durationLimit.error, code: durationLimit.code },
      { status: 403 },
    );
  }

  const recurrenceFrequency = data.recurrence_frequency as
    | RecurrenceFrequency
    | null
    | undefined;
  const plan =
    recurrenceFrequency && data.recurrence_until
      ? buildRecurrencePlan(
          data.scheduled_start_at!,
          recurrenceFrequency,
          data.recurrence_until,
          CALLS_RECURRENCE_OPTIONS,
        )
      : null;

  if (plan && !plan.startMatchesPattern) {
    return NextResponse.json(
      {
        error: `The start date must fall on a ${recurrenceFrequency === "weekdays" ? "weekday" : "weekend"} for this repeat pattern`,
      },
      { status: 400 },
    );
  }

  const occurrenceStarts = plan?.starts ?? [data.scheduled_start_at!];

  const recordingEnabled = data.recording_enabled ?? true;
  const recordingRetention = data.recording_retention ?? "forever";
  const callTitle = (data.title?.trim() || "Meeting") as string;
  const meetingDescription = data.meeting_description ?? null;
  const seriesId = occurrenceStarts.length > 1 ? randomUUID() : null;

  const cal = data.calendar_id
    ? await getCalendarInWorkspace(data.calendar_id, data.workspace_id)
    : await getDefaultWorkspaceCalendar(data.workspace_id);
  if (!data.calendar_event_id && !cal) {
    return NextResponse.json(
      {
        error:
          "No workspace calendar found. Open Calendar once to create a default calendar, or pass calendar_id.",
      },
      { status: 400 },
    );
  }
  if (data.project_id) {
    const okProject = await assertProjectInWorkspace(
      data.project_id,
      data.workspace_id,
    );
    if (!okProject) {
      return NextResponse.json(
        { error: "Project does not belong to this workspace" },
        { status: 400 },
      );
    }
  }

  const createdEventIds: string[] = [];
  const createdCallIds: string[] = [];
  let firstCall: Record<string, unknown> | null = null;
  let firstRoomName: string | null = null;

  try {
    for (let i = 0; i < occurrenceStarts.length; i++) {
      const occurrenceStart = occurrenceStarts[i]!;
      const occurrenceEnd = new Date(
        new Date(occurrenceStart).getTime() + durationMs,
      ).toISOString();

      const recurrenceNote = buildRecurrenceDescriptionNote(
        recurrenceFrequency ?? null,
        data.recurrence_until ?? null,
        i,
        occurrenceStarts.length,
      );
      const eventDescription = [meetingDescription, recurrenceNote]
        .filter(Boolean)
        .join("\n\n");

      let calendarEventId: string | null = data.calendar_event_id ?? null;
      if (!calendarEventId && cal) {
        calendarEventId = await insertManualWorkspaceEvent({
          calendarId: cal.id,
          workspaceId: data.workspace_id,
          projectId: data.project_id ?? null,
          createdBy: user.id,
          title: callTitle,
          description: eventDescription || null,
          startTime: occurrenceStart,
          endTime: occurrenceEnd,
          timezone: cal.timezone,
        });
        createdEventIds.push(calendarEventId);
      }

      const { sql, params } = buildInsert(`${SCHEMA}.call_sessions`, {
        workspace_id: data.workspace_id,
        project_id: data.project_id ?? null,
        conversation_id: data.conversation_id ?? null,
        calendar_event_id: calendarEventId,
        created_by: user.id,
        title: callTitle,
        type: "scheduled",
        status: "scheduled",
        scheduled_start_at: occurrenceStart,
        scheduled_end_at: occurrenceEnd,
        recording_enabled: recordingEnabled,
        ai_enabled: data.ai_enabled ?? true,
      });

      const insertRes = await query(sql, params);
      const call = insertRes.rows[0] as Record<string, unknown>;
      const callId = call.id as string;
      createdCallIds.push(callId);

      const roomName = roomNameForCall(data.workspace_id, callId);
      const metadata: Record<string, unknown> = {
        recording_retention: recordingRetention,
        recurrence_type: recurrenceFrequency ? "recurring" : "one_time",
      };
      if (meetingDescription) {
        metadata.meeting_description = meetingDescription;
      }
      if (data.meeting_length_minutes != null) {
        metadata.meeting_length_minutes = data.meeting_length_minutes;
      }
      if (recurrenceFrequency) {
        metadata.recurrence_frequency = recurrenceFrequency;
        metadata.recurrence_until = data.recurrence_until;
        metadata.recurrence_index = i;
        metadata.recurrence_total = occurrenceStarts.length;
        if (seriesId) metadata.recurrence_series_id = seriesId;
      }

      await query(
        `UPDATE ${SCHEMA}.call_sessions
         SET livekit_room_name = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [callId, roomName, JSON.stringify(metadata)],
      );

      for (const pid of participantIds) {
        const role = pid === user.id ? "host" : "participant";
        await query(
          `INSERT INTO ${SCHEMA}.call_participants (call_session_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (call_session_id, user_id) DO NOTHING`,
          [callId, pid, role],
        );
      }

      if (calendarEventId) {
        await query(
          `UPDATE ${SCHEMA}.events
           SET call_session_id = $2, location = $3, updated_at = NOW()
           WHERE id = $1`,
          [calendarEventId, callId, `/calls/${callId}`],
        );
      }

      if (i === 0) {
        firstCall = { ...call, livekit_room_name: roomName };
        firstRoomName = roomName;
      }
    }
  } catch (err: unknown) {
    for (const callId of createdCallIds) {
      await query(`DELETE FROM ${SCHEMA}.call_sessions WHERE id = $1`, [
        callId,
      ]).catch(() => undefined);
    }
    for (const eventId of createdEventIds) {
      await query(`DELETE FROM ${SCHEMA}.events WHERE id = $1`, [
        eventId,
      ]).catch(() => undefined);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("call_sessions") && msg.includes("does not exist")) {
      return NextResponse.json(
        {
          error:
            "Calls database tables not set up yet. Run sql/calls_migration.sql in InsForge.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!firstCall || !firstRoomName) {
    return NextResponse.json(
      { error: "Failed to create scheduled meeting" },
      { status: 500 },
    );
  }

  const firstCallId = firstCall.id as string;
  const invitees = [...participantIds].filter((id) => id !== user.id);
  const inviteErrors: string[] = [];

  const firstStartLabel = new Date(data.scheduled_start_at!).toLocaleString(
    "en-US",
    { timeZoneName: "short" },
  );
  const inviteTitle =
    occurrenceStarts.length > 1
      ? "Recurring meeting series invitation"
      : "Scheduled meeting invitation";
  const inviteBody =
    occurrenceStarts.length > 1
      ? `${callTitle} — ${occurrenceStarts.length} sessions, first on ${firstStartLabel}. Join in OneWork Calls.`
      : `${callTitle} — starts ${firstStartLabel}. Join in OneWork Calls.`;

  try {
    await notifyCallParticipants(
      invitees,
      inviteTitle,
      inviteBody,
      "call_invite",
      firstCallId,
      "callInvites",
    );
  } catch (notifyErr: unknown) {
    const msg =
      notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
    inviteErrors.push(`notifications: ${msg}`);
  }

  try {
    await postCallInviteMessages(
      data.workspace_id,
      user.id,
      firstCallId,
      callTitle,
      invitees,
      data.conversation_id,
    );
  } catch (chatErr: unknown) {
    const msg = chatErr instanceof Error ? chatErr.message : String(chatErr);
    inviteErrors.push(`chat: ${msg}`);
  }

  return NextResponse.json({
    ...firstCall,
    livekit_room_name: firstRoomName,
    occurrence_count: occurrenceStarts.length,
    recurrence_series_id: seriesId,
    ...(inviteErrors.length > 0 ? { invite_warnings: inviteErrors } : {}),
  });
}
