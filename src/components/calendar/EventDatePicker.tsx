"use client";

import { useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useClickOutside } from "@/hooks/useClickOutside";
import { formatDisplayDate } from "@/lib/calendar/event-scheduling";

interface EventDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  disabled?: boolean;
  className?: string;
}

function parseLocalDate(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function EventDatePicker({
  id,
  label,
  value,
  onChange,
  minDate,
  disabled = false,
  className = "",
}: EventDatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const min = parseLocalDate(minDate ?? "");

  useClickOutside(rootRef, () => setOpen(false));

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      rows.push(days.slice(i, i + 7));
    }
    return rows;
  }, [viewMonth]);

  const handleSelect = (day: Date) => {
    if (min && day < min) return;
    onChange(format(day, "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <label
        htmlFor={id}
        className="text-[10px] font-bold text-text-secondary uppercase tracking-widest"
      >
        {label}
      </label>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (selected) setViewMonth(selected);
          setOpen((current) => !current);
        }}
        className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-left text-sm text-white transition-all hover:border-primary/40 focus:ring-1 focus:ring-primary outline-none disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{formatDisplayDate(value)}</span>
        <span className="material-symbols-outlined text-[18px] text-text-secondary">
          calendar_month
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} calendar`}
          className="absolute left-0 top-full z-50 mt-2 w-[min(100%,18rem)] rounded-xl border border-border-dark bg-surface-dark p-3 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((current) => addMonths(current, -1))}
              className="cursor-pointer rounded-lg p-1.5 text-text-secondary hover:bg-background-dark hover:text-white"
              aria-label="Previous month"
            >
              <span className="material-symbols-outlined text-[18px]">
                chevron_left
              </span>
            </button>
            <span className="text-sm font-bold text-white">
              {format(viewMonth, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((current) => addMonths(current, 1))}
              className="cursor-pointer rounded-lg p-1.5 text-text-secondary hover:bg-background-dark hover:text-white"
              aria-label="Next month"
            >
              <span className="material-symbols-outlined text-[18px]">
                chevron_right
              </span>
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-secondary">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const isSelected = selected ? isSameDay(day, selected) : false;
              const isBeforeMin = min ? day < min : false;
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={isBeforeMin}
                  onClick={() => handleSelect(day)}
                  className={`cursor-pointer rounded-lg py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    isSelected
                      ? "bg-primary text-white"
                      : inMonth
                        ? "text-white hover:bg-background-dark"
                        : "text-text-secondary/50 hover:bg-background-dark/60"
                  }`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
