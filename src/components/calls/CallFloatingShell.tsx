"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  loadPipPosition,
  savePipPosition,
  type PipPosition,
} from "@/lib/calls/joinSession";

const PIP_WIDTH = 360;
const PIP_MARGIN = 12;
const DEFAULT_BOTTOM_OFFSET = 88;

interface CallFloatingShellProps {
  title: string;
  onExpand: () => void;
  children: React.ReactNode;
}

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): PipPosition {
  const clearance =
    typeof document !== "undefined"
      ? parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--quick-taskbar-clearance",
          ) || "0",
        ) || 0
      : 0;
  const maxX = Math.max(PIP_MARGIN, window.innerWidth - width - PIP_MARGIN);
  const maxY = Math.max(
    PIP_MARGIN,
    window.innerHeight - height - PIP_MARGIN - clearance,
  );
  return {
    x: Math.min(Math.max(PIP_MARGIN, x), maxX),
    y: Math.min(Math.max(PIP_MARGIN, y), maxY),
  };
}

function defaultPosition(shellHeight: number): PipPosition {
  const x = Math.max(
    PIP_MARGIN,
    window.innerWidth - PIP_WIDTH - PIP_MARGIN,
  );
  const y = Math.max(
    PIP_MARGIN,
    window.innerHeight - shellHeight - DEFAULT_BOTTOM_OFFSET,
  );
  return { x, y };
}

export function CallFloatingShell({
  title,
  onExpand,
  children,
}: CallFloatingShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PipPosition | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const stored = loadPipPosition();
    const next = stored
      ? clampPosition(stored.x, stored.y, rect.width, rect.height)
      : clampPosition(
          defaultPosition(rect.height).x,
          defaultPosition(rect.height).y,
          rect.width,
          rect.height,
        );
    setPos(next);
  }, [mounted]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-pip-drag-handle]")) return;
      if (!pos || !shellRef.current) return;
      e.preventDefault();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !shellRef.current) return;
    const rect = shellRef.current.getBoundingClientRect();
    const next = clampPosition(
      drag.originX + (e.clientX - drag.startX),
      drag.originY + (e.clientY - drag.startY),
      rect.width,
      rect.height,
    );
    setPos(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (pos) savePipPosition(pos);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [pos],
  );

  useEffect(() => {
    const onResize = () => {
      if (!shellRef.current || !pos) return;
      const rect = shellRef.current.getBoundingClientRect();
      setPos(clampPosition(pos.x, pos.y, rect.width, rect.height));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || !pos) return;
    el.style.setProperty("--pip-x", `${pos.x}px`);
    el.style.setProperty("--pip-y", `${pos.y}px`);
  }, [pos]);

  if (!mounted || !pos) return null;

  const content = (
    <div
      ref={shellRef}
      className="fixed z-[90] left-[var(--pip-x)] top-[var(--pip-y)] flex flex-col w-[min(360px,calc(100vw-24px))] max-h-[min(420px,calc(100vh-24px))] rounded-2xl border border-border-dark bg-background-dark shadow-2xl overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        data-pip-drag-handle
        className="flex items-center gap-2 px-3 py-2 border-b border-border-dark bg-surface-dark/90 cursor-grab active:cursor-grabbing shrink-0 touch-none"
      >
        <span
          className="material-symbols-outlined text-text-secondary text-[18px] shrink-0"
          aria-hidden
        >
          drag_indicator
        </span>
        <span className="flex-1 text-sm font-semibold text-white truncate min-w-0">
          {title}
        </span>
        <button
          type="button"
          onClick={onExpand}
          className="size-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-white/10 hover:text-white shrink-0"
          title="Expand call"
        >
          <span className="material-symbols-outlined text-[20px]">
            open_in_full
          </span>
        </button>
      </div>
      <div className="flex flex-col min-h-0 flex-1">{children}</div>
    </div>
  );

  return createPortal(content, document.body);
}
