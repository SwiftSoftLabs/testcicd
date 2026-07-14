"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CallRoom } from "@/components/calls/CallTransport";
import type {
  ActiveCallSession,
  CallLayoutMode,
} from "@/context/CallSessionContext";
import { useCallSession } from "@/context/CallSessionContext";
import { useUIContext } from "@/context/UIContext";
import {
  loadPipPosition,
  savePipPosition,
  type PipPosition,
} from "@/lib/calls/joinSession";

const PIP_WIDTH = 480;
const PIP_MARGIN = 12;
const DEFAULT_BOTTOM_OFFSET = 88;

function clampPipPosition(
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

function defaultPipPosition(shellHeight: number): PipPosition {
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

interface CallShellFrameProps {
  session: ActiveCallSession;
  layout: CallLayoutMode;
  onSessionEnd: () => void;
  expand: () => void;
  minimize: () => void;
}

/** Single persistent frame: layout prop changes must not remount CallRoom. */
function CallShellFrame({
  session,
  layout,
  onSessionEnd,
  expand,
  minimize,
}: CallShellFrameProps) {
  const { isSidebarOpen, setSidebarOpen, toggleSidebar } = useUIContext();
  const isFull = layout === "full";
  const sidebarWasOpenRef = useRef<boolean | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [pipPos, setPipPos] = useState<PipPosition | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const syncDesktop = () => setIsDesktop(window.innerWidth >= 1024);
    syncDesktop();
    window.addEventListener("resize", syncDesktop);
    return () => window.removeEventListener("resize", syncDesktop);
  }, []);

  useEffect(() => {
    if (isFull) return;
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const stored = loadPipPosition();
    const next = stored
      ? clampPipPosition(stored.x, stored.y, rect.width, rect.height)
      : clampPipPosition(
          defaultPipPosition(rect.height).x,
          defaultPipPosition(rect.height).y,
          rect.width,
          rect.height,
        );
    setPipPos(next);
  }, [isFull, layout]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isFull || e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-pip-drag-handle]")) return;
      if (!pipPos || !shellRef.current) return;
      e.preventDefault();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: pipPos.x,
        originY: pipPos.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isFull, pipPos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isFull) return;
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      setPipPos(
        clampPipPosition(
          drag.originX + (e.clientX - drag.startX),
          drag.originY + (e.clientY - drag.startY),
          rect.width,
          rect.height,
        ),
      );
    },
    [isFull],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isFull) return;
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (pipPos) savePipPosition(pipPos);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [isFull, pipPos],
  );

  useEffect(() => {
    if (isFull) return;
    const onResize = () => {
      if (!shellRef.current || !pipPos) return;
      const rect = shellRef.current.getBoundingClientRect();
      setPipPos(clampPipPosition(pipPos.x, pipPos.y, rect.width, rect.height));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFull, pipPos]);

  const pipReady = !isFull && pipPos != null;

  useEffect(() => {
    if (!isFull) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFull]);

  useEffect(() => {
    if (!isFull) return;
    sidebarWasOpenRef.current = isSidebarOpen;
    if (isSidebarOpen) setSidebarOpen(false);
    return () => {
      if (sidebarWasOpenRef.current) setSidebarOpen(true);
      sidebarWasOpenRef.current = null;
    };
    // Only run when entering/leaving full layout — not when sidebar toggles mid-call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFull]);

  useEffect(() => {
    if (!isFull || !isSidebarOpen) {
      document.documentElement.removeAttribute("data-full-call-app-sidebar");
      return;
    }
    document.documentElement.setAttribute("data-full-call-app-sidebar", "true");
    return () => {
      document.documentElement.removeAttribute("data-full-call-app-sidebar");
    };
  }, [isFull, isSidebarOpen]);

  const toggleAppSidebar = useCallback(() => {
    toggleSidebar();
  }, [toggleSidebar]);

  const toggleMeetingFullscreen = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  }, []);

  const sidebarBesideCall = isFull && isSidebarOpen && isDesktop;

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    expand();
  };

  return (
    <div
      ref={shellRef}
      className={
        isFull
          ? `fixed z-[100] flex flex-col min-h-0 overflow-hidden bg-background-dark ${
              sidebarBesideCall ? "inset-y-0 right-0" : "inset-0"
            }`
          : "fixed z-[90] flex flex-col w-[min(480px,calc(100vw-24px))] max-h-[min(560px,calc(100vh-24px))] rounded-2xl border border-border-dark bg-background-dark shadow-2xl overflow-hidden"
      }
      style={
        isFull
          ? sidebarBesideCall
            ? { left: "var(--shell-sidebar-w)" }
            : undefined
          : pipReady
            ? { left: pipPos!.x, top: pipPos!.y }
            : { visibility: "hidden" as const }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        data-pip-drag-handle
        className={`flex items-center gap-2 px-3 py-2 border-b border-border-dark bg-surface-dark/90 shrink-0 touch-none ${
          isFull
            ? "hidden"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <span
          className="material-symbols-outlined text-text-secondary text-[18px] shrink-0"
          aria-hidden
        >
          drag_indicator
        </span>
        <span className="flex-1 text-sm font-semibold text-white truncate min-w-0">
          {session.call.title}
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleExpand}
          className="size-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-white/10 hover:text-white shrink-0"
          title="Expand call"
        >
          <span className="material-symbols-outlined text-[20px]">
            open_in_full
          </span>
        </button>
      </div>
      <CallRoom
        callId={session.callId}
        initialCall={session.call}
        joinConfig={session.joinConfig}
        layout={layout}
        onSessionEnd={onSessionEnd}
        onMinimize={minimize}
        onExpand={expand}
        onToggleMeetingFullscreen={isFull ? toggleMeetingFullscreen : undefined}
        onToggleAppSidebar={isFull ? toggleAppSidebar : undefined}
        isAppSidebarOpen={isFull ? isSidebarOpen : undefined}
      />
    </div>
  );
}

interface ActiveCallShellProps {
  session: ActiveCallSession;
  layout: CallLayoutMode;
  onSessionEnd: () => void;
}

export function ActiveCallShell({
  session,
  layout,
  onSessionEnd,
}: ActiveCallShellProps) {
  const { expand, minimize } = useCallSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <CallShellFrame
      session={session}
      layout={layout}
      onSessionEnd={onSessionEnd}
      expand={expand}
      minimize={minimize}
    />,
    document.body,
  );
}
