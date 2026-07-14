"use client";

import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { usePathname, useRouter } from "next/navigation";
import { callRoomHref } from "@/lib/calls/joinSession";
import { useAppContext } from "@/context/AppContext";
import type { WorkspaceMember } from "@/lib/api";
import {
  recurrenceFrequencyLabel,
  recurrenceUntilFromDateLocal,
  type RecurrenceFrequency,
} from "@/lib/calls/recurrence";

interface NewCallModalProps {
  workspaceId: string;
  members: WorkspaceMember[];
  conversationId?: string;
  onClose: () => void;
}

function pad2(part: number): string {
  return String(part).padStart(2, "0");
}

function initialScheduleDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function initialScheduleTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Combines local date (YYYY-MM-DD) and time (HH:mm) into an ISO timestamp. */
function scheduledStartToIso(dateStr: string, timeStr: string): string {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateStr}T${time}`).toISOString();
}

type CallMode = "instant" | "schedule";
type ScheduleRecurrence = "one_time" | "recurring";

function defaultRecurrenceUntilDate(fromDate: string): string {
  const d = new Date(`${fromDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fromDate;
  d.setMonth(d.getMonth() + 1);
  return initialScheduleDate(d);
}

export function NewCallModal({
  workspaceId,
  members,
  conversationId,
  onClose,
}: NewCallModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentUser,
    calendars,
    fetchCalendars,
    fetchNativeEvents,
    selectedProjectId,
    projects,
  } = useAppContext();
  const [mode, setMode] = useState<CallMode>("instant");
  const [title, setTitle] = useState("Team meeting");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [retention, setRetention] = useState<
    "forever" | "7_days" | "30_days" | "sprint_end"
  >("forever");
  const [recordMeeting, setRecordMeeting] = useState(true);
  const [retentionWarningOpen, setRetentionWarningOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scheduleDate, setScheduleDate] = useState(() =>
    initialScheduleDate(new Date(Date.now() + 60 * 60_000)),
  );
  const [scheduleTime, setScheduleTime] = useState(() =>
    initialScheduleTime(new Date(Date.now() + 60 * 60_000)),
  );
  const [lengthHours, setLengthHours] = useState("");
  const [lengthMinutes, setLengthMinutes] = useState("");
  const [scheduleRecurrence, setScheduleRecurrence] =
    useState<ScheduleRecurrence>("one_time");
  const [recurrenceFrequency, setRecurrenceFrequency] =
    useState<RecurrenceFrequency>("weekdays");
  const [recurrenceUntilDate, setRecurrenceUntilDate] = useState(() =>
    defaultRecurrenceUntilDate(
      initialScheduleDate(new Date(Date.now() + 60 * 60_000)),
    ),
  );
  const [calendarIdOverride, setCalendarIdOverride] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void fetchCalendars();
  }, [fetchCalendars, workspaceId]);

  const defaultCalendar = useMemo(
    () => calendars.find((c) => c.isDefault) ?? calendars[0] ?? null,
    [calendars],
  );

  const resolvedCalendarId =
    calendarIdOverride ?? defaultCalendar?.id ?? "";
  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId)
    : null;
  const isLockedProject = selectedProject?.quota_locked === true;

  const inviteableMembers = useMemo(
    () => members.filter((m) => m.isMember && m.id && m.id !== currentUser?.id),
    [members, currentUser?.id],
  );

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const onRetentionSelect = (
    v: "forever" | "7_days" | "30_days" | "sprint_end",
  ) => {
    setRetention(v);
    if (v !== "forever") setRetentionWarningOpen(true);
    else setRetentionWarningOpen(false);
  };

  const submit = async () => {
    if (isLockedProject) {
      setError("This project is read-only because your workspace is over its plan limit.");
      return;
    }
    if (
      recordMeeting &&
      retention !== "forever" &&
      retentionWarningOpen
    ) {
      setError("Please confirm recording retention below.");
      return;
    }
    const trimmedTitle = title.trim();
    if (mode === "schedule" && !trimmedTitle) {
      setError("Meeting title is required.");
      return;
    }
    if (mode === "schedule") {
      if (!scheduleDate || !scheduleTime) {
        setError("Date and time are required.");
        return;
      }
      const startIso = scheduledStartToIso(scheduleDate, scheduleTime);
      const startMs = new Date(startIso).getTime();
      if (!Number.isFinite(startMs)) {
        setError("Invalid date and time.");
        return;
      }
      if (calendars.length === 0) {
        setError(
          "No workspace calendar yet. Open the Calendar page once, then try again.",
        );
        return;
      }
      if (!resolvedCalendarId) {
        setError("Pick a calendar for this meeting.");
        return;
      }
      if (scheduleRecurrence === "recurring") {
        if (!recurrenceUntilDate) {
          setError("Repeat until date is required for recurring meetings.");
          return;
        }
        const firstStart = scheduledStartToIso(scheduleDate, scheduleTime);
        const untilIso = recurrenceUntilFromDateLocal(recurrenceUntilDate);
        if (new Date(untilIso).getTime() < new Date(firstStart).getTime()) {
          setError("Repeat until must be on or after the first meeting date.");
          return;
        }
      }
    }

    setLoading(true);
    setError(null);
    try {
      if (mode === "instant") {
        const payload: Record<string, unknown> = {
          workspace_id: workspaceId,
          title: trimmedTitle || "Meeting",
          type: selected.length <= 1 ? "instant_1_1" : "instant_group",
          recording_retention: retention,
          recording_enabled: recordMeeting,
        };
        if (selected.length > 0) {
          payload.participant_ids = selected;
        }
        if (conversationId) {
          payload.conversation_id = conversationId;
        }
        if (selectedProjectId) {
          payload.project_id = selectedProjectId;
        }
        const call = await api.calls.create(payload);
        onClose();
        router.push(callRoomHref(call.id, pathname ?? "/calls"));
        return;
      }

      const hRaw = lengthHours.trim();
      const mRaw = lengthMinutes.trim();
      const hParsed = hRaw === "" ? 0 : Number.parseInt(hRaw, 10);
      const mParsed = mRaw === "" ? 0 : Number.parseInt(mRaw, 10);
      const lengthTouched = hRaw !== "" || mRaw !== "";
      let lengthTotalMinutes: number | undefined;
      if (lengthTouched) {
        if (
          !Number.isFinite(hParsed) ||
          !Number.isFinite(mParsed) ||
          hParsed < 0 ||
          mParsed < 0 ||
          mParsed > 59
        ) {
          setError("Use whole numbers: hours ≥ 0, minutes 0–59.");
          setLoading(false);
          return;
        }
        lengthTotalMinutes = hParsed * 60 + mParsed;
        if (lengthTotalMinutes < 1 || lengthTotalMinutes > 24 * 60) {
          setError("Meeting length must be between 1 minute and 24 hours.");
          setLoading(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        type: "scheduled",
        title: trimmedTitle,
        scheduled_start_at: scheduledStartToIso(scheduleDate, scheduleTime),
        recording_retention: recordMeeting ? retention : "forever",
        recording_enabled: recordMeeting,
        participant_ids: selected,
        calendar_id: resolvedCalendarId,
      };
      if (lengthTotalMinutes != null) {
        payload.meeting_length_minutes = lengthTotalMinutes;
      }
      const desc = description.trim();
      if (desc) {
        payload.meeting_description = desc;
      }
      if (selectedProjectId) {
        payload.project_id = selectedProjectId;
      }
      if (conversationId) {
        payload.conversation_id = conversationId;
      }
      if (scheduleRecurrence === "recurring") {
        payload.recurrence_frequency = recurrenceFrequency;
        payload.recurrence_until = recurrenceUntilFromDateLocal(
          recurrenceUntilDate,
        );
      }

      const call = await api.calls.create(payload);
      await fetchNativeEvents();
      onClose();
      router.push(`/calls/${call.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create call");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-dark border border-border-dark rounded-2xl max-w-lg w-full p-6 relative max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-4">New call</h2>
        {isLockedProject && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
            {selectedProject?.name ?? "This project"} is read-only because your workspace is over its plan limit. Switch projects or upgrade to create calls.
          </div>
        )}

        <div className="flex rounded-lg border border-border-dark overflow-hidden mb-4">
          <button
            type="button"
            className={`flex-1 py-2 text-sm font-medium ${
              mode === "instant"
                ? "bg-primary text-white"
                : "bg-background-dark text-text-secondary"
            } cursor-pointer`}
            onClick={() => {
              setMode("instant");
              setError(null);
            }}
          >
            Start now
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-sm font-medium ${
              mode === "schedule"
                ? "bg-primary text-white"
                : "bg-background-dark text-text-secondary"
            } cursor-pointer`}
            onClick={() => {
              setMode("schedule");
              setError(null);
            }}
          >
            Schedule meeting
          </button>
        </div>

        <label className="block text-xs text-text-secondary mb-1">
          Meeting title{mode === "schedule" ? " (required)" : ""}
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm"
        />

        {mode === "schedule" && (
          <>
            <label className="block text-xs text-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full mb-4 px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm resize-y min-h-[72px]"
            />
            <label className="block text-xs text-text-secondary mb-1">
              Date (required)
            </label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm [color-scheme:dark]"
            />
            <label className="block text-xs text-text-secondary mb-1">
              Time (required)
            </label>
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm [color-scheme:dark]"
            />

            <p className="text-xs text-text-secondary mb-2">
              Repeat (required)
            </p>
            <div className="flex rounded-lg border border-border-dark overflow-hidden mb-3">
              <button
                type="button"
                className={`flex-1 py-2 text-sm font-medium ${
                  scheduleRecurrence === "one_time"
                    ? "bg-primary text-white"
                    : "bg-background-dark text-text-secondary"
                } cursor-pointer`}
                onClick={() => setScheduleRecurrence("one_time")}
              >
                One time
              </button>
              <button
                type="button"
                className={`flex-1 py-2 text-sm font-medium ${
                  scheduleRecurrence === "recurring"
                    ? "bg-primary text-white"
                    : "bg-background-dark text-text-secondary"
                } cursor-pointer`}
                onClick={() => setScheduleRecurrence("recurring")}
              >
                Recurring
              </button>
            </div>
            {scheduleRecurrence === "recurring" && (
              <div className="mb-3 space-y-3 rounded-lg border border-border-dark bg-background-dark/40 p-3">
                <div>
                  <label className="block text-[11px] text-text-secondary mb-2">
                    Repeat on
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button
                      type="button"
                      className={`py-2 px-2 text-xs font-medium rounded-lg border ${
                        recurrenceFrequency === "weekdays"
                          ? "border-primary bg-primary/20 text-white"
                          : "border-border-dark bg-background-dark text-text-secondary"
                      } cursor-pointer`}
                      onClick={() => setRecurrenceFrequency("weekdays")}
                    >
                      Weekdays
                      <span className="block text-[10px] font-normal opacity-70 mt-0.5">
                        Mon–Fri
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`py-2 px-2 text-xs font-medium rounded-lg border ${
                        recurrenceFrequency === "weekends"
                          ? "border-primary bg-primary/20 text-white"
                          : "border-border-dark bg-background-dark text-text-secondary"
                      } cursor-pointer`}
                      onClick={() => setRecurrenceFrequency("weekends")}
                    >
                      Weekends
                      <span className="block text-[10px] font-normal opacity-70 mt-0.5">
                        Sat–Sun
                      </span>
                    </button>
                  </div>
                  <label className="block text-[11px] text-text-secondary mb-1">
                    Or choose another pattern
                  </label>
                  <select
                    value={
                      recurrenceFrequency === "weekdays" ||
                      recurrenceFrequency === "weekends"
                        ? ""
                        : recurrenceFrequency
                    }
                    onChange={(e) => {
                      const v = e.target.value as RecurrenceFrequency;
                      if (v) setRecurrenceFrequency(v);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm"
                  >
                    <option value="" disabled>
                      {recurrenceFrequency === "weekdays" ||
                      recurrenceFrequency === "weekends"
                        ? recurrenceFrequencyLabel(recurrenceFrequency)
                        : "Select pattern…"}
                    </option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Same day each week</option>
                    <option value="monthly">Same date each month</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-text-secondary mb-1">
                    Repeat until
                  </label>
                  <input
                    type="date"
                    value={recurrenceUntilDate}
                    min={scheduleDate}
                    onChange={(e) => setRecurrenceUntilDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm [color-scheme:dark]"
                  />
                </div>
                <p className="text-[11px] text-text-secondary">
                  Creates a separate calendar event and call for each matching
                  day — {recurrenceFrequencyLabel(recurrenceFrequency).toLowerCase()}{" "}
                  (up to 52 sessions).
                </p>
              </div>
            )}

            <label className="block text-xs text-text-secondary mb-1">
              Meeting length for calendar (optional)
            </label>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div className="min-w-[6rem]">
                <label className="block text-[11px] text-text-secondary mb-1">
                  Hours
                </label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  inputMode="numeric"
                  placeholder="—"
                  value={lengthHours}
                  onChange={(e) => setLengthHours(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm"
                />
              </div>
              <div className="min-w-[6rem]">
                <label className="block text-[11px] text-text-secondary mb-1">
                  Minutes
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  inputMode="numeric"
                  placeholder="—"
                  value={lengthMinutes}
                  onChange={(e) => setLengthMinutes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-text-secondary -mt-2 mb-3">
              Leave both empty for a 1-hour calendar slot. Minutes must be 0–59.
            </p>
            {calendars.length > 1 && (
              <>
                <label className="block text-xs text-text-secondary mb-1">
                  Calendar
                </label>
                <select
                  value={calendarIdOverride ?? defaultCalendar?.id ?? ""}
                  onChange={(e) => setCalendarIdOverride(e.target.value)}
                  className="w-full mb-4 px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm"
                >
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}

        <p className="text-xs text-text-secondary mb-2">
          Participants (you are always included; solo is OK)
        </p>
        <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
          {inviteableMembers.length === 0 ? (
            <p className="text-xs text-text-secondary px-2">
              No other workspace members to invite. You can start the call solo.
            </p>
          ) : (
            inviteableMembers.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={() => toggle(m.id)}
                />
                <span className="text-sm text-white">{m.name}</span>
              </label>
            ))
          )}
        </div>

        <div className="mb-4">
          <p className="text-xs text-text-secondary mb-2">
            Record this meeting? (required)
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="radio"
                name="rec"
                checked={recordMeeting}
                onChange={() => {
                  setRecordMeeting(true);
                }}
              />
              Yes
            </label>
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="radio"
                name="rec"
                checked={!recordMeeting}
                onChange={() => {
                  setRecordMeeting(false);
                  setRetentionWarningOpen(false);
                }}
              />
              No
            </label>
          </div>
          <p className="text-[11px] text-text-secondary mt-1">
            If you choose No, the call will not be recorded and no AI summary will
            run after the call ends.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">
            Recording retention (when recording is on)
          </label>
          <select
            value={retention}
            onChange={(e) =>
              onRetentionSelect(e.target.value as typeof retention)
            }
            disabled={!recordMeeting}
            className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-white text-sm disabled:opacity-50"
          >
            <option value="forever">Keep forever</option>
            <option value="7_days">Delete after 7 days</option>
            <option value="30_days">Delete after 30 days</option>
            <option value="sprint_end">Delete when sprint ends</option>
          </select>
          {retention === "sprint_end" && (
            <p className="text-[11px] text-amber-200/90 mt-1">
              Requires a project on the call. Expires when any sprint on that
              project is completed.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-sm text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || isLockedProject}
            onClick={() => void submit()}
            className="px-4 py-2 text-sm font-bold bg-primary text-white rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? mode === "schedule"
                ? "Scheduling…"
                : "Starting…"
              : mode === "schedule"
                ? "Schedule meeting"
                : "Start call"}
          </button>
        </div>

        {retentionWarningOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/80 p-4">
            <div className="bg-surface-dark border border-amber-500/40 rounded-xl p-5 max-w-sm w-full shadow-xl">
              <h3 className="text-sm font-bold text-amber-200 mb-2">
                Recording retention
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                When the retention period ends, the meeting recording will be
                removed from this call and deleted from the Files module
                (Meeting-Recording folder), if it was stored there.
              </p>
              <button
                type="button"
                className="cursor-pointer w-full py-2 text-sm font-bold bg-primary text-white rounded-lg"
                onClick={() => setRetentionWarningOpen(false)}
              >
                I understand
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
