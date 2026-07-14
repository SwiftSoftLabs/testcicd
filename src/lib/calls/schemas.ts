import { z } from "zod";
import { dateTimeSchema } from "@/lib/calendar/schemas";

export const uuidSchema = z.string().uuid();

/** First human-readable message from a Zod error (for API 400 responses). */
export function formatZodError(error: z.ZodError): string {
  const flat = error.flatten();
  for (const msgs of Object.values(flat.fieldErrors) as (
    | string[]
    | undefined
  )[]) {
    const first = msgs?.[0];
    if (first) return first;
  }
  const formErr = flat.formErrors[0];
  if (formErr) return formErr;
  return "Invalid request";
}

function emptyToUndefined(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return undefined;
  return v;
}

const optionalDateTime = z.preprocess(emptyToUndefined, dateTimeSchema.optional());

const optionalDateTimeOrNull = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  return v;
}, dateTimeSchema.nullable().optional());

/** Computes scheduled end ISO from start, optional explicit end, optional length (minutes), else +60m. */
export function resolveScheduledEndIso(input: {
  scheduled_start_at: string;
  scheduled_end_at?: string | null;
  meeting_length_minutes?: number | null;
}): string {
  const startMs = new Date(input.scheduled_start_at).getTime();
  let endMs: number;
  if (input.scheduled_end_at) {
    endMs = new Date(input.scheduled_end_at).getTime();
  } else if (
    input.meeting_length_minutes != null &&
    Number.isFinite(input.meeting_length_minutes)
  ) {
    endMs = startMs + input.meeting_length_minutes * 60_000;
  } else {
    endMs = startMs + 60 * 60_000;
  }
  return new Date(endMs).toISOString();
}

export const createCallSchema = z
  .object({
    workspace_id: uuidSchema,
    project_id: uuidSchema.optional().nullable(),
    conversation_id: uuidSchema.optional().nullable(),
    calendar_event_id: z.preprocess(emptyToUndefined, uuidSchema.optional()),
    calendar_id: z.preprocess(emptyToUndefined, uuidSchema.optional()),
    title: z
      .string()
      .max(200)
      .optional()
      .transform((s) => (typeof s === "string" ? s.trim() : s)),
    type: z.enum(["instant_1_1", "instant_group", "scheduled"]).optional(),
    participant_ids: z
      .array(uuidSchema)
      .max(50)
      .optional()
      .transform((ids) => (ids && ids.length > 0 ? ids : undefined)),
    scheduled_start_at: optionalDateTime,
    scheduled_end_at: optionalDateTimeOrNull,
    meeting_length_minutes: z.preprocess((v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().min(1).max(24 * 60).optional()),
    meeting_description: z
      .string()
      .max(5000)
      .optional()
      .nullable()
      .transform((s) => {
        if (s == null) return null;
        const t = s.trim();
        return t.length ? t : null;
      }),
    recording_enabled: z.boolean().optional(),
    ai_enabled: z.boolean().optional(),
    recording_retention: z
      .enum(["forever", "7_days", "30_days", "sprint_end"])
      .optional(),
    recurrence_frequency: z
      .enum(["daily", "weekdays", "weekends", "weekly", "monthly"])
      .optional()
      .nullable(),
    recurrence_until: optionalDateTime,
  })
  .superRefine((data, ctx) => {
    const sched = data.scheduled_start_at;
    if (!sched) {
      if (data.type === "scheduled") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scheduled_start_at is required when type is scheduled",
          path: ["scheduled_start_at"],
        });
      }
      return;
    }

    const title = data.title;
    if (!title || title.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Title is required for scheduled meetings",
        path: ["title"],
      });
    }

    if (data.type && data.type !== "scheduled") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "type must be scheduled when scheduled_start_at is set",
        path: ["type"],
      });
    }

    const startMs = new Date(sched).getTime();
    if (!Number.isFinite(startMs)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid start date",
        path: ["scheduled_start_at"],
      });
      return;
    }

    const endIso = resolveScheduledEndIso({
      scheduled_start_at: sched,
      scheduled_end_at: data.scheduled_end_at,
      meeting_length_minutes: data.meeting_length_minutes,
    });
    const endMs = new Date(endIso).getTime();
    if (!(endMs > startMs)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End time must be after start time",
        path: ["scheduled_end_at"],
      });
    }

    const recordingOn = data.recording_enabled !== false;
    if (recordingOn && !data.recording_retention) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recording_retention is required when recording is enabled",
        path: ["recording_retention"],
      });
    }

    if (data.recurrence_frequency && !data.recurrence_until) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recurrence_until is required for recurring meetings",
        path: ["recurrence_until"],
      });
    }
    if (!data.recurrence_frequency && data.recurrence_until) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recurrence_frequency is required when recurrence_until is set",
        path: ["recurrence_frequency"],
      });
    }
    if (data.recurrence_frequency && data.recurrence_until) {
      const untilMs = new Date(data.recurrence_until).getTime();
      if (!Number.isFinite(untilMs) || untilMs < startMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Repeat until must be on or after the first meeting date",
          path: ["recurrence_until"],
        });
      }
    }
  });

export const patchCallSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z
    .enum([
      "scheduled",
      "lobby",
      "live",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ])
    .optional(),
  recording_enabled: z.boolean().optional(),
  ai_enabled: z.boolean().optional(),
});

export const joinCallSchema = z.object({
  consent_at: z.string().datetime(),
});

export const approveReviewSchema = z.object({
  move_to_todo: z.boolean().optional(),
});

export const callInviteMoreSchema = z.object({
  participant_ids: z.array(uuidSchema).min(1).max(50),
});

export const raiseHandSchema = z.object({
  raised: z.boolean(),
});

export const meetingNotesContentSchema = z.object({
  content: z.string().max(100_000),
});
