import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { joinCallSchema } from "@/lib/calls/schemas";
import { forceRedispatchAgent, maybeStartAgent } from "@/lib/calls/lifecycle";
import { ensureLiveAiSession } from "@/lib/calls/liveSession";
import { isCallRecordingEnabled } from "@/lib/calls/constants";
import { publishCallSyncUpdate } from "@/lib/calls/realtime-publish";
import {
  checkCallDurationLimit,
  checkCallMinutesAvailable,
} from "@/lib/billing/enforceCalls";
import { getWorkspaceEntitlements } from "@/lib/billing/subscription";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const call = await getCallForMember(id, user.id);
    if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (["completed", "cancelled", "failed"].includes(call.status)) {
      return NextResponse.json(
        { error: "Call is not joinable" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = joinCallSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (
      call.recording_enabled &&
      isCallRecordingEnabled() &&
      !parsed.data.consent_at
    ) {
      return NextResponse.json(
        { error: "consent_at is required when recording is enabled" },
        { status: 400 },
      );
    }

    await query(
      `INSERT INTO ${SCHEMA}.call_participants (call_session_id, user_id, role, joined_at, consent_at)
       VALUES ($1, $2, 'participant', NOW(), $3::timestamptz)
       ON CONFLICT (call_session_id, user_id) DO UPDATE
       SET joined_at = COALESCE(call_participants.joined_at, NOW()),
           left_at = NULL,
           consent_at = COALESCE(call_participants.consent_at, EXCLUDED.consent_at)`,
      [id, user.id, parsed.data.consent_at],
    );

    if (call.status === "lobby" || call.status === "scheduled") {
      let estimatedMinutes = 60;
      if (call.scheduled_start_at && call.scheduled_end_at) {
        estimatedMinutes = Math.max(
          1,
          Math.ceil(
            (new Date(call.scheduled_end_at).getTime() -
              new Date(call.scheduled_start_at).getTime()) /
              60_000,
          ),
        );
      } else {
        const entitlements = await getWorkspaceEntitlements(call.workspace_id);
        if (entitlements.max_call_duration_minutes != null) {
          estimatedMinutes = entitlements.max_call_duration_minutes;
        }
      }

      const durationLimit = await checkCallDurationLimit(
        call.workspace_id,
        estimatedMinutes,
      );
      if (!durationLimit.allowed) {
        return NextResponse.json(
          { error: durationLimit.error, code: durationLimit.code },
          { status: 403 },
        );
      }

      const minutesLimit = await checkCallMinutesAvailable(
        call.workspace_id,
        estimatedMinutes,
      );
      if (!minutesLimit.allowed) {
        return NextResponse.json(
          { error: minutesLimit.error, code: minutesLimit.code },
          { status: 403 },
        );
      }

      await query(
        `UPDATE ${SCHEMA}.call_sessions
         SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [id],
      );
    }

    const appBase =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
    if (call.ai_enabled) {
      await ensureLiveAiSession(id);
      const refreshed = await getCallForMember(id, user.id);
      if (refreshed) {
        const meta = (refreshed.metadata ?? {}) as Record<string, unknown>;
        if (!refreshed.livekit_agent_dispatch_id) {
          await maybeStartAgent(refreshed, appBase);
        } else if (meta.agent_error) {
          await forceRedispatchAgent(refreshed, appBase);
        }
      }
    }

    if (call.recording_enabled && isCallRecordingEnabled()) {
      const existing = await query(
        `SELECT id FROM ${SCHEMA}.call_recordings WHERE call_session_id = $1 LIMIT 1`,
        [id],
      );
      if (!existing.rows[0]) {
        await query(
          `INSERT INTO ${SCHEMA}.call_recordings (call_session_id, status)
           VALUES ($1, 'recording')`,
          [id],
        );
      }
    }

    void publishCallSyncUpdate(id).catch(() => undefined);

    return NextResponse.json({ ok: true, status: "live" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to join call";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
