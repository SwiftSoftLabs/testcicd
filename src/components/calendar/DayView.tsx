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

interface DayViewProps {
  currentDate: Date;
  onAddEvent: () => void;
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
  return recurrenceFrequencyLabel(item.event.recurrenceFrequency).replace(/\s+\(.+\)$/, "");
}

export const DayView: React.FC<DayViewProps> = ({
  currentDate,
  onAddEvent,
  events,
  onItemClick,
  showWorkspaceBadge,
  createDisabled = false,
}) => {
  const [showAllAllDayEvents, setShowAllAllDayEvents] = useState(false);
  const [showAllTimedEvents, setShowAllTimedEvents] = useState(false);
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const visibleAllDayLimit = 4;
  const visibleTimedLimit = 6;

  const isToday = currentDate.toDateString() === new Date().toDateString();
  const allEvents = events.filter(
    (t) =>
      t.day === currentDate.getDate() &&
      t.month === currentDate.getMonth() &&
      t.year === currentDate.getFullYear(),
  );
  const allDayEvents = allEvents.filter(
    (e): e is NativeCalendarItem => isNativeCalendarItem(e) && e.isAllDay,
  );
  const timedEvents = allEvents.filter(
    (e) => !(e.source === "event" && e.isAllDay),
  );
  const visibleAllDayEvents = showAllAllDayEvents
    ? allDayEvents
    : allDayEvents.slice(0, visibleAllDayLimit);
  const visibleTimelineEvents = showAllTimedEvents
    ? timedEvents
    : timedEvents.slice(0, visibleTimedLimit);

  const handleEventClick = (e: React.MouseEvent, item: CalendarDisplayItem) => {
    e.stopPropagation();
    onItemClick(item);
  };

  const headerTitle = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(currentDate);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col p-4 sm:p-6 lg:p-10">
      <div className="flex items-center gap-3 sm:gap-6 mb-4 sm:mb-8 lg:mb-12">
        <div
          className={`size-14 sm:size-20 lg:size-24 rounded-xl sm:rounded-2xl lg:rounded-3xl flex flex-col items-center justify-center border-2 transition-all shadow-2xl shrink-0 ${isToday ? "bg-primary border-primary ring-4 ring-primary/20" : "bg-surface-dark border-border-dark"}`}
        >
          <span
            className={`text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] ${isToday ? "text-white/80" : "text-text-secondary"}`}
          >
            {daysOfWeek[currentDate.getDay()]}
          </span>
          <span
            className={`text-2xl sm:text-3xl lg:text-4xl font-black text-white`}
          >
            {currentDate.getDate()}
          </span>
        </div>
        <div className="flex flex-col gap-1 sm:gap-2 min-w-0">
          <h2 className="text-xl sm:text-2xl lg:text-4xl font-black text-white leading-tight">{headerTitle}</h2>
          <p className="text-xs sm:text-sm text-text-secondary font-medium">
            You have{" "}
            <span className="text-white font-bold">
              {allEvents.length} events
            </span>{" "}
            scheduled for {isToday ? "today" : "this day"}.
          </p>
        </div>
      </div>

      <div className="space-y-4 sm:space-y-6">
        {allDayEvents.length > 0 && (
          <div className="mb-4 sm:mb-8">
            <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] mb-2 sm:mb-4">
              All Day
            </h3>
            <div className="space-y-2">
              {visibleAllDayEvents.map((event) => {
                const colors = getEventColors(event);
                return (
                  <div
                    key={event.id}
                    onClick={(e) => handleEventClick(e, event)}
                    className={`flex items-center justify-between gap-3 sm:gap-4 px-3 sm:px-5 py-2 sm:py-3 rounded-xl border cursor-pointer transition-all ${colors.hoverBorder} ${colors.bg} ${colors.border} ${colors.text} group`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span
                        className={`size-2 rounded-full ${colors.dot} shrink-0`}
                      ></span>
                      <span className="font-bold text-white text-sm truncate">
                        {event.title}
                      </span>
                      {event.description && (
                        <span className="hidden sm:block text-sm text-text-secondary truncate">
                          {event.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {event.event.seriesId && (
                        <span title="Recurring event" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide opacity-80">
                          <span className="material-symbols-outlined text-[12px]">repeat</span>
                          {recurrenceChipLabel(event)}
                        </span>
                      )}
                      {showWorkspaceBadge &&
                        event.projectId === null &&
                        !event.accountId && (
                          <span title="Workspace-wide event" className="opacity-60">
                            <GlobeIcon size={12} />
                          </span>
                        )}
                      {event.eventSource === "email" && event.accountId && (
                        <span title="Imported from email" className="opacity-80">
                          <EmailIcon size={14} />
                        </span>
                      )}
                      {event.eventScope === "account" &&
                        event.eventSource === "manual" && (
                          <span title="Private event" className="opacity-80">
                            <PersonIcon size={14} />
                          </span>
                        )}
                      <button
                        type="button"
                        className="cursor-pointer p-1 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <span className="material-symbols-outlined text-base">
                          chevron_right
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {!showAllAllDayEvents &&
                allDayEvents.length > visibleAllDayLimit && (
                  <button
                    type="button"
                    onClick={() => setShowAllAllDayEvents(true)}
                    className="cursor-pointer rounded-xl border border-border-dark px-4 py-2 text-sm font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    +{allDayEvents.length - visibleAllDayLimit} more all-day events
                  </button>
                )}
              {showAllAllDayEvents &&
                allDayEvents.length > visibleAllDayLimit && (
                  <button
                    type="button"
                    onClick={() => setShowAllAllDayEvents(false)}
                    className="cursor-pointer rounded-xl border border-border-dark px-4 py-2 text-sm font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Show fewer all-day events
                  </button>
                )}
            </div>
          </div>
        )}
        <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.3em] mb-4 sm:mb-8">
          Timeline
        </h3>
        <div className="space-y-3 sm:space-y-4">
          {timedEvents.length > 0 ? (
            visibleTimelineEvents.map((event) => {
              const colors = getEventColors(event);
              return (
                <div
                  key={event.id}
                  onClick={(e) => handleEventClick(e, event)}
                  className={`flex gap-3 sm:gap-6 p-3 sm:p-4 lg:p-6 rounded-xl sm:rounded-2xl border transition-all cursor-pointer group hover:shadow-2xl ${colors.bg} ${colors.border} ${colors.hoverBorder}`}
                >
                  <div className="w-14 sm:w-20 lg:w-24 shrink-0 pt-1">
                    <span className="text-xs sm:text-sm font-black text-white/40 group-hover:text-white transition-colors">
                      {event.source === "event"
                        ? event.start.toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Due"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
                      <span
                        className={`size-2 rounded-full ${colors.dot} shrink-0`}
                      ></span>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest ${colors.text}`}
                      >
                        {event.source === "event" ? "event" : "task"}
                      </span>
                      {event.source === "event" && event.event.seriesId && (
                        <span title="Recurring event" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide opacity-80">
                          <span className="material-symbols-outlined text-[12px]">repeat</span>
                          {recurrenceChipLabel(event)}
                        </span>
                      )}
                      {showWorkspaceBadge &&
                        event.source === "event" &&
                        event.projectId === null &&
                        !event.accountId && (
                          <span title="Workspace-wide event" className="opacity-70">
                            <GlobeIcon size={11} />
                          </span>
                        )}
                      {event.source === "event" &&
                        event.eventSource === "email" &&
                        event.accountId && (
                          <span title="Imported from email" className="opacity-80">
                            <EmailIcon size={14} />
                          </span>
                        )}
                      {event.source === "event" &&
                        event.eventScope === "account" &&
                        event.eventSource === "manual" && (
                          <span title="Private event" className="opacity-80">
                            <PersonIcon size={14} />
                          </span>
                        )}
                    </div>
                    <h4 className="text-base sm:text-lg lg:text-xl font-bold text-white mb-1 sm:mb-2 leading-tight">
                      {event.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                      {event.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="cursor-pointer self-center p-1 sm:p-2 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <span className="material-symbols-outlined">
                      chevron_right
                    </span>
                  </button>
                </div>
              );
            })
          ) : allEvents.length === 0 ? (
            <div className="py-10 sm:py-20 text-center border-2 border-dashed border-border-dark rounded-2xl sm:rounded-3xl bg-surface-dark/20">
              <span className="material-symbols-outlined text-4xl sm:text-6xl text-text-secondary/20 mb-4">
                event_available
              </span>
              <p className="text-text-secondary font-bold text-sm">
                No events scheduled. Enjoy your focus time!
              </p>
              <button
                type="button"
                onClick={() => {
                  if (!createDisabled) onAddEvent();
                }}
                disabled={createDisabled}
                className="mt-4 sm:mt-6 text-primary font-black uppercase text-[10px] tracking-widest hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
              >
                + Add Event
              </button>
            </div>
          ) : null}
          {timedEvents.length > visibleTimedLimit && (
            <button
              type="button"
              onClick={() => setShowAllTimedEvents((current) => !current)}
              className="cursor-pointer rounded-xl sm:rounded-2xl border border-border-dark px-4 sm:px-5 py-2 sm:py-3 text-left text-sm font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
            >
              {showAllTimedEvents
                ? "Show fewer timeline events"
                : `+${timedEvents.length - visibleTimedLimit} more timeline events`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
