"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarDisplayItem } from "@/types/calendar";
import {
  EmailIcon,
  GlobeIcon,
  PersonIcon,
} from "@/components/calendar/CalendarIcons";
import { getEventColors } from "@/lib/calendar-colors";

interface MonthViewProps {
  currentDate: Date;
  onDayClick: (day: number) => void;
  events: CalendarDisplayItem[];
  onItemClick: (item: CalendarDisplayItem) => void;
  showWorkspaceBadge: boolean;
  createDisabled?: boolean;
}

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  onDayClick,
  events,
  onItemClick,
  showWorkspaceBadge,
  createDisabled = false,
}) => {
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [collapsedFitByDay, setCollapsedFitByDay] = useState<
    Record<string, number>
  >({});
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const allDayMeasureRef = useRef<HTMLDivElement | null>(null);
  const timedMeasureRef = useRef<HTMLDivElement | null>(null);
  const moreMeasureRef = useRef<HTMLButtonElement | null>(null);
  const measuredHeightsRef = useRef<Record<string, number>>({});
  const rowGap = 4;
  const heightHysteresisPx = 4;
  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0,
  ).getDate();
  const startOffset = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1,
  ).getDay();
  const totalRows = Math.ceil((startOffset + daysInMonth) / 7);
  const gridRowsClass =
    totalRows === 6 ? "grid-rows-6" : totalRows === 5 ? "grid-rows-5" : "grid-rows-4";

  const dayEventsByKey = useMemo(() => {
    const entries: Record<string, CalendarDisplayItem[]> = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      const rawDayEvents = events.filter(
        (item) =>
          item.day === day &&
          item.month === currentDate.getMonth() &&
          item.year === currentDate.getFullYear(),
      );
      const allDayEvents = rawDayEvents.filter(
        (item) => item.source === "event" && item.isAllDay,
      );
      entries[`${currentDate.getFullYear()}-${currentDate.getMonth()}-${day}`] =
        [
          ...allDayEvents,
          ...rawDayEvents.filter(
            (item) => !(item.source === "event" && item.isAllDay),
          ),
        ];
    }
    return entries;
  }, [currentDate, daysInMonth, events]);

  const handleEventClick = (e: React.MouseEvent, item: CalendarDisplayItem) => {
    e.stopPropagation();
    onItemClick(item);
  };

  useEffect(() => {
    let rafId: number | null = null;

    const measure = () => {
      const allDayHeight = allDayMeasureRef.current?.offsetHeight ?? 24;
      const timedHeight = timedMeasureRef.current?.offsetHeight ?? 26;
      const moreHeight = moreMeasureRef.current?.offsetHeight ?? 20;

      setCollapsedFitByDay((current) => {
        const next: Record<string, number> = {};

        for (const [dayKey, node] of Object.entries(listRefs.current)) {
          if (!node) continue;

          const dayEvents = dayEventsByKey[dayKey] ?? [];
          const availableHeight = node.clientHeight;
          const previousHeight = measuredHeightsRef.current[dayKey];

          if (dayEvents.length === 0 || availableHeight <= 0) {
            measuredHeightsRef.current[dayKey] = availableHeight;
            next[dayKey] = dayEvents.length;
            continue;
          }

          const eventHeights = dayEvents.map((item) =>
            item.source === "event" && item.isAllDay
              ? allDayHeight
              : timedHeight,
          );
          const totalHeight =
            eventHeights.reduce((sum, height) => sum + height, 0) +
            Math.max(dayEvents.length - 1, 0) * rowGap;

          let fitCount = dayEvents.length;

          if (totalHeight > availableHeight) {
            let usedHeight = 0;
            fitCount = 0;

            for (let index = 0; index < eventHeights.length; index += 1) {
              const nextRowHeight = eventHeights[index];
              const gapBefore = fitCount === 0 ? 0 : rowGap;
              const remainingAfterThis = eventHeights.length - (index + 1);
              const reservedForMore =
                remainingAfterThis > 0 ? rowGap + moreHeight : 0;
              const nextUsedHeight = usedHeight + gapBefore + nextRowHeight;

              if (nextUsedHeight + reservedForMore > availableHeight) {
                break;
              }

              usedHeight = nextUsedHeight;
              fitCount += 1;
            }
          }

          const previousFit = current[dayKey];
          const heightDelta =
            previousHeight === undefined
              ? heightHysteresisPx
              : Math.abs(availableHeight - previousHeight);

          if (
            previousFit !== undefined &&
            heightDelta < heightHysteresisPx &&
            fitCount !== previousFit
          ) {
            next[dayKey] = previousFit;
          } else {
            measuredHeightsRef.current[dayKey] = availableHeight;
            next[dayKey] = fitCount;
          }
        }

        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(next);
        const keysChanged =
          currentKeys.length !== nextKeys.length ||
          nextKeys.some((key) => current[key] !== next[key]);
        return keysChanged ? next : current;
      });
    };

    const scheduleMeasure = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    scheduleMeasure();

    const resizeObserver = new ResizeObserver(() => {
      scheduleMeasure();
    });

    Object.values(listRefs.current).forEach((node) => {
      if (node) resizeObserver.observe(node);
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [dayEventsByKey]);

  return (
    <>
      <div
        className="pointer-events-none absolute opacity-0"
        aria-hidden="true"
      >
        <div
          ref={allDayMeasureRef}
          className="w-full px-2 py-1 rounded text-[10px] font-bold border bg-surface-dark border-border-dark text-text-secondary"
        >
          Sample all-day event
        </div>
        <div
          ref={timedMeasureRef}
          className="mt-1 px-2 py-1.5 rounded text-[10px] font-bold border bg-surface-dark border-border-dark text-text-secondary"
        >
          9:00 AM Sample event
        </div>
        <button
          ref={moreMeasureRef}
          type="button"
          className="cursor-pointer mt-1 w-full rounded px-2 py-1 text-left text-[10px] font-bold text-text-secondary"
        >
          +3 more
        </button>
      </div>
      <div className={`grid min-h-full grid-cols-7 overflow-visible ${gridRowsClass}`}>
        {Array.from({ length: startOffset }).map((_, i) => (
          <div
            key={`offset-${i}`}
            className="border-r border-b border-border-dark bg-white/1"
          ></div>
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${day}`;
          const dayEvents = dayEventsByKey[dayKey] ?? [];
          const collapsedFitCount =
            collapsedFitByDay[dayKey] ?? Math.min(dayEvents.length, 2);
          const hasOverflow = dayEvents.length > collapsedFitCount;
          const isExpanded = expandedDays[dayKey] ?? false;
          const visibleDayEvents = isExpanded
            ? dayEvents
            : dayEvents.slice(0, collapsedFitCount);
          const remainingCount = Math.max(
            dayEvents.length - collapsedFitCount,
            0,
          );
          const isToday =
            day === new Date().getDate() &&
            currentDate.getMonth() === new Date().getMonth() &&
            currentDate.getFullYear() === new Date().getFullYear();

          return (
            <div
              key={day}
              onClick={() => {
                if (!createDisabled) onDayClick(day);
              }}
              className={`p-1 md:p-2 border-r border-b border-border-dark group transition-all relative flex flex-col ${createDisabled ? 'cursor-default' : 'hover:bg-white/2 cursor-pointer'}`}
            >
              <div className="flex items-center justify-between mb-1 md:mb-2">
                <span
                  className={`text-[10px] md:text-xs font-bold inline-flex items-center justify-center size-4 md:size-6 rounded-full transition-all ${isToday ? "bg-primary text-white shadow-lg shadow-primary/30" : "text-text-secondary group-hover:text-white"}`}
                >
                  {day}
                </span>
                <button
                  type="button"
                  disabled={createDisabled}
                  className={`hidden sm:block p-1 text-text-secondary transition-all disabled:cursor-default disabled:opacity-0 ${createDisabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    add
                  </span>
                </button>
              </div>
              <div
                ref={(node) => {
                  listRefs.current[dayKey] = node;
                }}
                className={`cursor-pointer flex-1 space-y-1 pr-1 ${isExpanded ? "overflow-y-auto custom-scrollbar" : "overflow-hidden"}`}
                onClick={(event) => {
                  if (isExpanded) {
                    event.stopPropagation();
                  }
                }}
              >
                {visibleDayEvents.map((event) => {
                  const isAllDay = event.source === "event" && event.isAllDay;
                  const isWorkspace =
                    event.source === "event" &&
                    event.projectId === null &&
                    !event.accountId;
                  const isPrivateEmail =
                    event.source === "event" &&
                    event.eventSource === "email" &&
                    Boolean(event.accountId);
                  const isPrivateManual =
                    event.source === "event" &&
                    event.eventScope === "account" &&
                    event.eventSource === "manual";
                  const colors = getEventColors(event);
                  if (isAllDay) {
                    return (
                      <div
                        key={event.id}
                        onClick={(e) => handleEventClick(e, event)}
                        className={`w-full rounded border shadow-sm hover:scale-[1.02] active:scale-95 transition-all cursor-pointer ${colors.bg} ${colors.border} ${colors.text}`}
                      >
                        {/* Mobile: dot only */}
                        <div className={`sm:hidden mx-auto my-0.5 size-1.5 rounded-full ${colors.dot}`} />
                        {/* Desktop: full pill */}
                        <div className="hidden sm:flex min-w-0 items-center gap-1 px-2 py-1 text-[10px] font-bold">
                          {showWorkspaceBadge && isWorkspace && (
                            <span className="shrink-0"><GlobeIcon size={9} /></span>
                          )}
                          {event.source === "event" && event.event.seriesId && (
                            <span className="shrink-0 opacity-70" title="Recurring event">
                              <span className="material-symbols-outlined text-[11px]">repeat</span>
                            </span>
                          )}
                          {isPrivateEmail && (
                            <span className="shrink-0"><EmailIcon size={12} /></span>
                          )}
                          {isPrivateManual && (
                            <span className="shrink-0"><PersonIcon size={12} /></span>
                          )}
                          <span className="truncate">{event.title}</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={event.id}
                      onClick={(e) => handleEventClick(e, event)}
                      className={`rounded border shadow-sm hover:scale-[1.02] active:scale-95 transition-all cursor-pointer ${colors.bg} ${colors.border} ${colors.text}`}
                    >
                      {/* Mobile: dot only */}
                      <div className={`sm:hidden mx-auto my-0.5 size-1.5 rounded-full ${colors.dot}`} />
                      {/* Desktop: full pill */}
                      <div className="hidden sm:flex min-w-0 items-center gap-1 px-2 py-1.5 text-[10px] font-bold">
                        <span className="truncate">
                          <span className="opacity-60 mr-1">
                            {event.source === "event"
                              ? event.start.toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : "Due"}
                          </span>
                          {showWorkspaceBadge && isWorkspace && (
                            <span className="mr-1 inline-flex align-middle opacity-70">
                              <GlobeIcon size={9} />
                            </span>
                          )}
                          {event.source === "event" && event.event.seriesId && (
                            <span className="mr-1 inline-flex align-middle opacity-70" title="Recurring event">
                              <span className="material-symbols-outlined text-[11px]">repeat</span>
                            </span>
                          )}
                          {isPrivateEmail && (
                            <span className="mr-1 inline-flex align-middle opacity-80">
                              <EmailIcon size={12} />
                            </span>
                          )}
                          {isPrivateManual && (
                            <span className="mr-1 inline-flex align-middle opacity-80">
                              <PersonIcon size={12} />
                            </span>
                          )}
                          {event.title}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!isExpanded && hasOverflow && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedDays((current) => ({
                        ...current,
                        [dayKey]: true,
                      }));
                    }}
                    className="cursor-pointer w-full rounded px-2 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    +{remainingCount} more
                  </button>
                )}
                {isExpanded && hasOverflow && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedDays((current) => ({
                        ...current,
                        [dayKey]: false,
                      }));
                    }}
                    className="cursor-pointer w-full rounded px-2 py-1 text-left text-[10px] font-bold text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
