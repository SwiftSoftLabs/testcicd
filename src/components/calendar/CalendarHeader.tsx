"use client";

import React from "react";

interface CalendarHeaderProps {
  currentDate: Date;
  view: "month" | "week" | "day";
  onViewChange: (view: "month" | "week" | "day") => void;
  onNavigate: (direction: "prev" | "next") => void;
  onToday: () => void;
  onCreateEvent: () => void;
  projectSelector?: React.ReactNode;
  filterLegend?: React.ReactNode;
  createDisabled?: boolean;
}

export const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  currentDate,
  view,
  onViewChange,
  onNavigate,
  onToday,
  onCreateEvent,
  projectSelector,
  filterLegend,
  createDisabled,
}) => {
  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const headerTitle = (() => {
    if (view === "month") {
      return new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
      }).format(currentDate);
    } else if (view === "week") {
      const start = getStartOfWeek(currentDate);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const startStr = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(start);
      const endStr = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(end);
      return `${startStr} — ${endStr}`;
    } else {
      return new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(currentDate);
    }
  })();

  const VIEW_LABELS: Record<"month" | "week" | "day", { full: string; short: string }> = {
    month: { full: "Month", short: "M" },
    week: { full: "Week", short: "W" },
    day: { full: "Day", short: "D" },
  };

  return (
    <header className="border-b border-border-dark flex flex-col bg-surface-dark/20 shrink-0">

      {/* Row 1: Project selector — full width on its own row */}
      {projectSelector && (
        <div className="px-3 pt-2 md:px-6 md:pt-3">
          {projectSelector}
        </div>
      )}

      {/* Row 2: Title (left) + nav + view switcher + create (right) */}
      <div className="flex items-center gap-2 px-3 py-2 md:px-6 md:py-3 min-w-0">
        {/* Title — grows, truncates */}
        <h1 className="flex-1 min-w-0 text-base md:text-xl font-black text-white truncate">
          {headerTitle}
        </h1>

        {/* Navigation: prev · today · next */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("prev")}
            className="cursor-pointer p-1 rounded-lg hover:bg-white/5 text-text-secondary transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <button
            type="button"
            onClick={onToday}
            className="cursor-pointer px-2 py-1 rounded-lg border border-border-dark text-[11px] font-bold text-white hover:bg-white/5 transition-all"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onNavigate("next")}
            className="cursor-pointer p-1 rounded-lg hover:bg-white/5 text-text-secondary transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>

        {/* View switcher: M / W / D */}
        <div className="flex p-1 bg-surface-dark rounded-lg border border-border-dark shrink-0">
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={`cursor-pointer px-2 md:px-3 py-1 rounded-md transition-all text-[10px] md:text-xs font-bold ${view === v ? "bg-background-dark text-white shadow-sm" : "text-text-secondary hover:text-white"}`}
            >
              <span className="hidden sm:inline">{VIEW_LABELS[v].full}</span>
              <span className="sm:hidden">{VIEW_LABELS[v].short}</span>
            </button>
          ))}
        </div>

        {/* Create event button */}
        <button
          type="button"
          onClick={() => {
            if (!createDisabled) onCreateEvent();
          }}
          className="hidden sm:flex px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all items-center gap-1.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          disabled={createDisabled}
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New Event
        </button>
        <button
          type="button"
          onClick={() => {
            if (!createDisabled) onCreateEvent();
          }}
          className="sm:hidden flex items-center justify-center size-8 bg-primary text-white rounded-lg shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          disabled={createDisabled}
          aria-label="Create event"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
      </div>

      {/* Row 3: Filter legend — always a horizontal scroll strip */}
      {filterLegend && (
        <div className="overflow-x-auto border-t border-border-dark/50 px-3 py-2 md:px-6">
          {filterLegend}
        </div>
      )}
    </header>
  );
};
