"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AssistantActivityIndicator from "@/components/assistant/AssistantActivityIndicator";

export type AssistantSessionPhase = "idle" | "listening" | "processing";

type SessionCancelHandler = () => void;

interface AssistantSessionState {
  phase: AssistantSessionPhase;
  statusLabel: string;
  hintText: string | null;
}

interface AssistantSessionContextValue extends AssistantSessionState {
  isActive: boolean;
  setSession: (opts: {
    phase: AssistantSessionPhase;
    statusLabel: string;
    hintText?: string | null;
    onCancel: SessionCancelHandler;
  }) => void;
  clearSession: () => void;
  cancel: () => void;
}

const AssistantSessionContext = createContext<
  AssistantSessionContextValue | undefined
>(undefined);

const IDLE_STATE: AssistantSessionState = {
  phase: "idle",
  statusLabel: "",
  hintText: null,
};

export function AssistantSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSessionState] = useState<AssistantSessionState>(IDLE_STATE);
  const cancelHandlerRef = useRef<SessionCancelHandler | null>(null);
  const dismissingRef = useRef(false);

  const setSession = useCallback(
    (opts: {
      phase: AssistantSessionPhase;
      statusLabel: string;
      hintText?: string | null;
      onCancel: SessionCancelHandler;
    }) => {
      dismissingRef.current = false;
      cancelHandlerRef.current = opts.onCancel;
      setSessionState({
        phase: opts.phase,
        statusLabel: opts.statusLabel,
        hintText: opts.hintText ?? null,
      });
    },
    [],
  );

  const clearSession = useCallback(() => {
    dismissingRef.current = false;
    cancelHandlerRef.current = null;
    setSessionState(IDLE_STATE);
  }, []);

  const cancel = useCallback(() => {
    if (session.phase === "idle" || dismissingRef.current) return;
    dismissingRef.current = true;
    const handler = cancelHandlerRef.current;
    cancelHandlerRef.current = null;
    handler?.();
    setSessionState(IDLE_STATE);
  }, [session.phase]);

  useEffect(() => {
    if (session.phase === "idle") return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-assistant-session-ignore]")) return;
      cancel();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [session.phase, cancel]);

  const value = useMemo<AssistantSessionContextValue>(
    () => ({
      ...session,
      isActive: session.phase !== "idle",
      setSession,
      clearSession,
      cancel,
    }),
    [session, setSession, clearSession, cancel],
  );

  return (
    <AssistantSessionContext.Provider value={value}>
      {children}
      <AssistantActivityIndicator
        phase={session.phase}
        statusLabel={session.statusLabel}
        hintText={session.hintText}
        onCancel={cancel}
      />
    </AssistantSessionContext.Provider>
  );
}

export function useAssistantSession(): AssistantSessionContextValue {
  const ctx = useContext(AssistantSessionContext);
  if (!ctx) {
    return {
      ...IDLE_STATE,
      isActive: false,
      setSession: () => {},
      clearSession: () => {},
      cancel: () => {},
    };
  }
  return ctx;
}
