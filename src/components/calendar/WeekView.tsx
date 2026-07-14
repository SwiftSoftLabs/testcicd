"use client";

import React, { useState } from "react";
import type { CalendarDisplayItem } from "@/types/calendar";
import {
  EmailIcon,
  GlobeIcon,
  PersonIcon,
} from "@/components/calendar/CalendarIcons";
import { getEventColors } from "@/lib/calendar-colors";
import { recurrenceFrequencyLabel } from "@/lib/calls/recurrence";

interface WeekViewProps {
  currentDate: Date;
  onDayClick: (day: number, month: number, year: number) => void;
  events: CalendarDisplayItem[];
  onItemClick: (item: CalendarDisplayItem) => void;
  showWorkspaceBadge: boolean;
  createDisabled?: boolean;
}

type NativeCalendarItem = Extract<CalendarDisplayItem, { source: "event" }>;

function isNativeCalendarItem(
  item: CalendarDisplayItem,
): item is NativeCalendarItem {
  return item.source === "event";
}

function recurrenceChipLabel(item: NativeCalendarItem): string {
  if (!item.event.recurrenceFrequency) return "Repeats";
  return recurrenceFrequencyLabel(item.event.recurrenceFrequency).replace(
    /\s+\(.+\)$/,
    "",
  );
}

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  onDayClick,
  events,
  onItemClick,
  showWorkspaceBadge,
  createDisabled = false,
}) => {
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const daysOfWeekShort = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const visibleAllDayLimit = 2;
  const visibleTimedLimit = 3;

  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const start = getStartOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  // On small screens show only 3 days: yesterday, today, tomorrow
  const today = new Date();
  const mobileStartIndex = Math.max(
    0,
    Math.min(weekDays.findIndex((d) => d.toDateString() === today.toDateString()), 5) - 1,
  );
  const mobileDays = weekDays.slice(mobileStartIndex, mobileStartIndex + 3);

  const handleEventClick = (e: React.MouseEvent, item: CalendarDisplayItem) => {
    e.stopPropagation();
    onItemClick(item);
  };

  const renderDayColumn = (date: Date, i: number) => {
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const isToday = date.toDateString() === new Date().toDateString();
    const allEvents = events.filter(
      (t) =>
        t.day === date.getDate() &&
        t.month === date.getMonth() &&
        t.year === date.getFullYear(),
    );
    const allDayEvents = allEvents.filter(
      (e): e is NativeCalendarItem => isNativeCalendarItem(e) && e.isAllDay,
    );
    const timedEvents = allEvents.filter(
      (e) => !(e.source === "event" && e.isAllDay),
    );
    const showAllDayExpanded =
      expandedSections[`${dayKey}:allDay`] ?? false;
    const showTimedExpanded = expandedSections[`${dayKey}:timed`] ?? false;
    const visibleAllDayEvents = showAllDayExpanded
      ? allDayEvents
      : allDayEvents.slice(0, visibleAllDayLimit);
    const visibleTimedEvents = showTimedExpanded
      ? timedEvents
      : timedEvents.slice(0, visibleTimedLimit);

    return (
      <div
        key={i}
        onClick={() => {
          if (!createDisabled) {
            onDayClick(date.getDate(), date.getMonth(), date.getFullYear());
          }
        }}
        className={`border-r border-border-dark p-1.5 sm:p-2 lg:p-4 flex flex-col gap-2 sm:gap-4 group transition-colors ${createDisabled ? 'cursor-default' : 'hover:bg-white/2 cursor-pointer'}`}
      >
        <div className="text-center pb-2 sm:pb-4 border-b border-border-dark/30">
          <p
            className={`text-[9px] sm:text-[10px] font-black uppercase tracking-normal sm:tracking-widest mb-0.5 sm:mb-1 ${isToday ? "text-primary" : "text-text-secondary"}`}
          >
            <span className="hidden sm:inline">{daysOfWeek[date.getDay()]}</span>
            <span className="sm:hidden">{daysOfWeekShort[date.getDay()]}</span>
          </p>
          <p
            className={`text-lg sm:text-xl lg:text-2xl font-black ${isToday ? "text-white" : "text-slate-400 group-hover:text-white"}`}
          >
            {date.getDate()}
          </p>
        </div>
        {allDayEvents.length > 0 && (
          <div className="space-y-1 pb-2 sm:pb-3 border-b border-border-dark/30">
            {visibleAllDayEvents.map((event) => {
              const colors = getEventColors(event);
              return (
                <div
                  key={event.id}
                  onClick={(e) => handleEventClick(e, event)}
                  className={`w-full rounded-lg border flex items-center justify-between gap-1 shadow-sm transition-all hover:-translate-y-px ${colors.bg} ${colors.border} ${colors.text} cursor-pointer`}
                >
                  {/* Mobile: dot only */}
                  <div className={`sm:hidden mx-auto my-0.5 size-1.5 rounded-full ${colors.dot}`} />
                  {/* Desktop: full pill */}
                  <span className="hidden sm:block text-[10px] font-bold truncate px-2 py-1.5">{event.title}</span>
                  <span className="hidden sm:flex items-center gap-1 shrink-0 pr-1.5">
                    {event.event.seriesId && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide opacity-80" title="Recurring event">
                        <span className="material-symbols-outlined text-[10px]">repeat</span>
                        {recurrenceChipLabel(event)}
                      </span>
                    )}
                    {showWorkspaceBadge && event.projectId === null && !event.accountId && <GlobeIcon size={10} />}
                    {event.eventSource === "email" && event.accountId && (
                      <span className="opacity-80"><EmailIcon size={13} /></span>
                    )}
                    {event.eventScope === "account" && event.eventSource === "manual" && (
                      <span className="opacity-80"><PersonIcon size={13} /></span>
                    )}
                  </span>
                </div>
              );
            })}
            {!showAllDayExpanded && allDayEvents.length > visibleAllDayLimit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedSections((current) => ({
                    ...current,
                    [`${dayKey}:allDay`]: true,
                  }));
                }}
                className="cursor-pointer w-full rounded-lg px-2 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
              >
                +{allDayEvents.length - visibleAllDayLimit}
              </button>
            )}
            {showAllDayExpanded && allDayEvents.length > visibleAllDayLimit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedSections((current) => ({
                    ...current,
                    [`${dayKey}:allDay`]: false,
                  }));
                }}
                className="cursor-pointer w-full rounded-lg px-2 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
              >
                less
              </button>
            )}
          </div>
        )}
        <div className="flex-1 space-y-1.5 sm:space-y-3">
          {visibleTimedEvents.map((event) => {
            const colors = getEventColors(event);
            return (
              <div
                key={event.id}
                onClick={(e) => handleEventClick(e, event)}
                className={`rounded-xl border flex flex-col gap-1 shadow-lg transition-all hover:translate-y-[-2px] cursor-pointer ${colors.bg} ${colors.border} ${colors.text}`}
              >
                {/* Mobile: dot only */}
                <div className={`sm:hidden mx-auto my-1 size-2 rounded-full ${colors.dot}`} />
                {/* Desktop: full card */}
                <div className="hidden sm:flex flex-col gap-1.5 p-2 lg:p-3">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-black uppercase tracking-tighter opacity-70">
                      {event.source === "event"
                        ? `${event.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${event.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : "Task due"}
                    </span>
                    {showWorkspaceBadge && event.source === "event" && event.projectId === null && !event.accountId && (
                      <span className="opacity-70"><GlobeIcon size={10} /></span>
                    )}
                    {event.source === "event" && event.event.seriesId && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide opacity-80" title="Recurring event">
                        <span className="material-symbols-outlined text-[10px]">repeat</span>
                        {recurrenceChipLabel(event)}
                      </span>
                    )}
                    {event.source === "event" && event.eventSource === "email" && event.accountId && (
                      <span className="opacity-80"><EmailIcon size={13} /></span>
                    )}
                    {event.source === "event" && event.eventScope === "account" && event.eventSource === "manual" && (
                      <span className="opacity-80"><PersonIcon size={13} /></span>
                    )}
                  </div>
                  <span className="text-xs font-bold leading-tight">{event.title}</span>
                </div>
              </div>
            );
          })}
          {!showTimedExpanded && timedEvents.length > visibleTimedLimit && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedSections((current) => ({
                  ...current,
                  [`${dayKey}:timed`]: true,
                }));
              }}
              className="cursor-pointer w-full rounded-lg border border-border-dark px-2 sm:px-3 py-1.5 sm:py-2 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
            >
              +{timedEvents.length - visibleTimedLimit}
            </button>
          )}
          {showTimedExpanded && timedEvents.length > visibleTimedLimit && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedSections((current) => ({
                  ...current,
                  [`${dayKey}:timed`]: false,
                }));
              }}
              className="cursor-pointer w-full rounded-lg border border-border-dark px-2 sm:px-3 py-1.5 sm:py-2 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
            >
              less
            </button>
          )}
          {allEvents.length === 0 && (
            <div className="h-full flex items-center justify-center opacity-20">
              <span className="material-symbols-outlined text-2xl sm:text-4xl">
                event_busy
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile: 3-column view */}
      <div className="grid min-h-full grid-cols-3 sm:hidden">
        {mobileDays.map((date, i) => renderDayColumn(date, i))}
      </div>
      {/* Desktop: full 7-column view */}
      <div className="hidden min-h-full grid-cols-7 sm:grid">
        {weekDays.map((date, i) => renderDayColumn(date, i))}
      </div>
    </>
  );
};
