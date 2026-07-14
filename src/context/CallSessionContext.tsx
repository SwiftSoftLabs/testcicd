"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { JoinConfig } from "@/components/calls/PreJoinModal";
import {
  clearActiveCallMeta,
  clearJoinConfig,
  getActiveCallId,
  loadActiveCallReturnPath,
  loadJoinConfig,
  saveActiveCallMeta,
  callRoomHref,
} from "@/lib/calls/joinSession";
import { clearPersistedRtc } from "@/lib/calls/rtcHolder";
import type { CallSessionDetail } from "@/types/calls";
import { useUIContext } from "@/context/UIContext";
import { ActiveCallShell } from "@/components/calls/ActiveCallShell";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";

export type CallLayoutMode = "full" | "pip";

export interface ActiveCallSession {
  callId: string;
  call: CallSessionDetail;
  joinConfig: JoinConfig;
  returnPath: string;
}

interface StartCallInput {
  callId: string;
  call: CallSessionDetail;
  joinConfig: JoinConfig;
  returnPath?: string;
}

interface CallSessionContextValue {
  session: ActiveCallSession | null;
  layout: CallLayoutMode | null;
  startCall: (input: StartCallInput) => boolean;
  clearCall: () => void;
  minimize: () => void;
  expand: () => void;
}

const CallSessionContext = createContext<CallSessionContextValue | undefined>(
  undefined,
);

function parseRoomCallId(pathname: string): string | null {
  const m = pathname.match(/^\/calls\/([^/]+)\/room$/);
  return m?.[1] ?? null;
}

export function CallSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { addToast } = useUIContext();
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [rehydrateAttempted, setRehydrateAttempted] = useState(false);

  useSessionKeepAlive(Boolean(session), "critical");

  const layout = useMemo((): CallLayoutMode | null => {
    if (!session) return null;
    const roomId = parseRoomCallId(pathname ?? "");
    return roomId === session.callId ? "full" : "pip";
  }, [session, pathname]);

  const clearCall = useCallback(() => {
    const activeId = getActiveCallId();
    if (activeId) clearJoinConfig(activeId);
    clearPersistedRtc();
    setSession(null);
    clearActiveCallMeta();
  }, []);

  const startCall = useCallback(
    (input: StartCallInput): boolean => {
      if (session && session.callId !== input.callId) {
        addToast("Leave your current call before joining another.", "warning");
        return false;
      }
      if (session?.callId === input.callId) {
        const returnPath = input.returnPath ?? session.returnPath;
        saveActiveCallMeta(input.callId, returnPath);
        setSession({
          callId: input.callId,
          call: input.call,
          joinConfig: input.joinConfig,
          returnPath,
        });
        return true;
      }
      const returnPath = input.returnPath ?? "/dashboard";
      const next: ActiveCallSession = {
        callId: input.callId,
        call: input.call,
        joinConfig: input.joinConfig,
        returnPath,
      };
      saveActiveCallMeta(input.callId, returnPath);
      setSession(next);
      return true;
    },
    [session, addToast],
  );

  const minimize = useCallback(() => {
    if (!session) return;
    const onRoom = parseRoomCallId(pathname ?? "") === session.callId;
    const target = onRoom ? "/calls" : session.returnPath;
    if (onRoom) {
      saveActiveCallMeta(session.callId, "/calls");
      setSession({ ...session, returnPath: "/calls" });
    }
    router.push(target);
  }, [session, router, pathname]);

  const expand = useCallback(() => {
    if (!session) return;
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    const from = `${pathname ?? session.returnPath}${search}`;
    router.push(callRoomHref(session.callId, from));
  }, [session, router, pathname]);

  useEffect(() => {
    if (rehydrateAttempted || session) return;
    const activeId = getActiveCallId();
    if (!activeId) {
      setRehydrateAttempted(true);
      return;
    }
    const joinConfig = loadJoinConfig(activeId);
    if (!joinConfig) {
      clearActiveCallMeta();
      setRehydrateAttempted(true);
      return;
    }
    const returnPath = loadActiveCallReturnPath();
    let cancelled = false;
    api.calls
      .get(activeId)
      .then((call) => {
        if (cancelled) return;
        if (!["live", "lobby", "scheduled"].includes(call.status)) {
          clearActiveCallMeta();
          clearJoinConfig(activeId);
          return;
        }
        setSession({
          callId: activeId,
          call,
          joinConfig,
          returnPath,
        });
      })
      .catch(() => {
        if (!cancelled) clearActiveCallMeta();
      })
      .finally(() => {
        if (!cancelled) setRehydrateAttempted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rehydrateAttempted, session]);

  const value = useMemo(
    () => ({
      session,
      layout,
      startCall,
      clearCall,
      minimize,
      expand,
    }),
    [session, layout, startCall, clearCall, minimize, expand],
  );

  return (
    <CallSessionContext.Provider value={value}>
      {children}
      {session && layout ? (
        <ActiveCallShell
          session={session}
          layout={layout}
          onSessionEnd={clearCall}
        />
      ) : null}
    </CallSessionContext.Provider>
  );
}

export function useCallSession(): CallSessionContextValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) {
    throw new Error("useCallSession must be used within CallSessionProvider");
  }
  return ctx;
}
