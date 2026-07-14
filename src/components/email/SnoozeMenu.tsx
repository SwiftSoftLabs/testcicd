"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SNOOZE_PRESETS,
  formatSnoozedUntil,
  isCurrentlySnoozed,
  minDatetimeLocalValue,
  snoozePresetUntil,
  type SnoozePresetId,
} from "@/lib/email/snooze";

export type SnoozeSyncStatus = "syncing" | "saved" | "error";

interface SnoozeMenuProps {
  snoozedUntil?: string | null;
  disabled?: boolean;
  compact?: boolean;
  menuId?: string;
  syncStatus?: SnoozeSyncStatus;
  onSnooze: (until: string | null) => void | Promise<void>;
}

function blockRowNavigation(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function SnoozeMenu({
  snoozedUntil,
  disabled = false,
  compact = false,
  menuId = "default",
  syncStatus,
  onSnooze,
}: SnoozeMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const snoozed = isCurrentlySnoozed({ snoozed_until: snoozedUntil });
  const busy = syncStatus === "syncing";

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[data-snooze-menu="${menuId}"]`)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [menuId, open]);

  const toggleOpen = (event: React.MouseEvent) => {
    blockRowNavigation(event);
    if (disabled || busy) return;
    setOpen((value) => !value);
  };

  const applyPreset = async (
    event: React.MouseEvent,
    preset: SnoozePresetId,
  ) => {
    blockRowNavigation(event);
    setOpen(false);
    await onSnooze(snoozePresetUntil(preset).toISOString());
  };

  const applyCustom = async (
    event: React.SyntheticEvent,
    value: string,
  ) => {
    blockRowNavigation(event);
    if (!value) return;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return;
    setOpen(false);
    await onSnooze(parsed.toISOString());
  };

  const unsnooze = async (event: React.MouseEvent) => {
    blockRowNavigation(event);
    setOpen(false);
    await onSnooze(null);
  };

  const iconSize = compact ? "text-[18px]" : "text-[24px]";

  const menu = open && menuPos ? (
    <div
      data-snooze-menu={menuId}
      style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
      className={`z-[9999] rounded-xl border border-border-dark bg-surface-dark shadow-xl py-1 ${
        compact ? "w-56" : "w-60"
      }`}
      role="menu"
      onMouseDown={blockRowNavigation}
    >
      {snoozed ? (
        <>
          {snoozedUntil ? (
            <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary border-b border-border-dark/60">
              Until {formatSnoozedUntil(snoozedUntil)}
            </p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-main hover:bg-white/[0.05] text-left"
            onMouseDown={blockRowNavigation}
            onClick={(event) => void unsnooze(event)}
          >
            <span className="material-symbols-outlined text-[18px]">
              notifications_active
            </span>
            Unsnooze
          </button>
          <div className="my-1 border-t border-border-dark/60" />
        </>
      ) : null}

      {SNOOZE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-main hover:bg-white/[0.05] text-left"
          onMouseDown={blockRowNavigation}
          onClick={(event) => void applyPreset(event, preset.id)}
        >
          <span className="material-symbols-outlined text-[18px] text-text-secondary">
            schedule
          </span>
          {preset.label}
        </button>
      ))}

      <div className="px-3 py-2 border-t border-border-dark/60">
        <label
          htmlFor={`snooze-custom-${menuId}`}
          className="block text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1.5"
        >
          Pick date & time
        </label>
        <input
          id={`snooze-custom-${menuId}`}
          type="datetime-local"
          min={minDatetimeLocalValue()}
          className="w-full rounded-lg border border-border-dark bg-background-dark px-2 py-1.5 text-xs text-main outline-none focus:ring-2 focus:ring-primary/35"
          onMouseDown={blockRowNavigation}
          onClick={blockRowNavigation}
          onChange={(event) => void applyCustom(event, event.target.value)}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="relative z-20" ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled || busy}
          title={
            snoozed && snoozedUntil
              ? `Snoozed until ${formatSnoozedUntil(snoozedUntil)}`
              : "Snooze"
          }
          aria-label={snoozed ? "Change snooze" : "Snooze"}
          aria-busy={busy}
          aria-expanded={open}
          onMouseDown={blockRowNavigation}
          onClick={toggleOpen}
          className={`rounded-md p-0.5 transition-colors opacity-70 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35 ${
            compact
              ? snoozed
                ? "text-primary"
                : "text-text-secondary hover:text-primary"
              : `p-2 rounded-xl ${
                  snoozed
                    ? "text-primary hover:bg-primary/10"
                    : "text-text-secondary hover:text-primary hover:bg-primary/10"
                }`
          } disabled:hover:bg-transparent disabled:hover:text-text-secondary`}
        >
          {busy ? (
            <span
              className={`material-symbols-outlined ${iconSize} animate-spin text-text-secondary`}
            >
              progress_activity
            </span>
          ) : syncStatus === "saved" ? (
            <span className={`material-symbols-outlined ${iconSize} text-emerald-400`}>
              check
            </span>
          ) : syncStatus === "error" ? (
            <span className={`material-symbols-outlined ${iconSize} text-red-400`}>
              error
            </span>
          ) : (
            <span className={`material-symbols-outlined ${iconSize}`}>schedule</span>
          )}
        </button>
      </div>
      {typeof document !== "undefined" && menu
        ? createPortal(menu, document.body)
        : null}
    </>
  );
}
