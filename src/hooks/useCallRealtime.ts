"use client";

import { useEffect, useRef, useState } from "react";
import { insforgeNative } from "@/lib/insforge/native";
import type {
  CallLivePayload,
  CallNotesUpdatePayload,
  CallSyncPayload,
} from "@/types/calls";
import type { CallRealtimeEvent } from "@/lib/calls/realtime-publish";

type RealtimePayload = Record<string, unknown>;

function unwrapRealtimePayload(raw: RealtimePayload): RealtimePayload {
  const nested = raw.data ?? raw.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as RealtimePayload;
  }
  return raw;
}

function isCallLivePayload(p: RealtimePayload): boolean {
  return (
    "reviews" in p ||
    "artifact" in p ||
    "ai_status" in p ||
    "stt_status" in p
  );
}

function isCallSyncPayload(p: RealtimePayload): boolean {
  return "participants" in p && "status" in p && "id" in p;
}

function isCallNotesUpdatePayload(p: RealtimePayload): boolean {
  return (
    typeof p.publicContent === "string" &&
    typeof p.updatedAt === "string" &&
    typeof p.updatedBy === "string"
  );
}

export function useCallRealtime(
  callId: string | null,
  handlers: {
    onLiveUpdate?: (payload: CallLivePayload) => void;
    onSyncUpdate?: (payload: CallSyncPayload) => void;
    onNotesUpdate?: (payload: CallNotesUpdatePayload) => void;
  },
) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!callId) {
      setConnected(false);
      return undefined;
    }

    const channelName = `call:${callId}`;
    let subscribed = false;

    const dispatch = (event: CallRealtimeEvent, raw: RealtimePayload) => {
      const payload = unwrapRealtimePayload(raw);
      if (event === "CALL_LIVE_UPDATE" && isCallLivePayload(payload)) {
        handlersRef.current.onLiveUpdate?.(payload as unknown as CallLivePayload);
      } else if (event === "CALL_SYNC_UPDATE" && isCallSyncPayload(payload)) {
        handlersRef.current.onSyncUpdate?.(payload as unknown as CallSyncPayload);
      } else if (
        event === "CALL_NOTES_UPDATE" &&
        isCallNotesUpdatePayload(payload)
      ) {
        handlersRef.current.onNotesUpdate?.(
          payload as unknown as CallNotesUpdatePayload,
        );
      }
    };

    const liveHandler = (raw: RealtimePayload) =>
      dispatch("CALL_LIVE_UPDATE", raw);
    const syncHandler = (raw: RealtimePayload) =>
      dispatch("CALL_SYNC_UPDATE", raw);
    const notesHandler = (raw: RealtimePayload) =>
      dispatch("CALL_NOTES_UPDATE", raw);

    const onConnect = () => {
      if (subscribed) setConnected(true);
    };
    const onDisconnect = () => setConnected(false);

    const setup = async () => {
      if (subscribed) return true;
      try {
        if (!insforgeNative.realtime.isConnected) {
          await insforgeNative.realtime.connect();
        }
        const result = await insforgeNative.realtime.subscribe(channelName);
        if (!result.ok) {
          console.warn("[call/realtime] subscribe failed:", result.error?.message);
          setConnected(false);
          return false;
        }
        subscribed = true;
        setConnected(true);
        insforgeNative.realtime.on("CALL_LIVE_UPDATE", liveHandler);
        insforgeNative.realtime.on("CALL_SYNC_UPDATE", syncHandler);
        insforgeNative.realtime.on("CALL_NOTES_UPDATE", notesHandler);
        insforgeNative.realtime.on("connect", onConnect);
        insforgeNative.realtime.on("disconnect", onDisconnect);
        return true;
      } catch (err) {
        console.error("[call/realtime] setup error:", err);
        setConnected(false);
        return false;
      }
    };

    void setup();
    const retryId = window.setInterval(() => {
      if (subscribed) return;
      void setup();
    }, 15_000);

    return () => {
      window.clearInterval(retryId);
      insforgeNative.realtime.off("CALL_LIVE_UPDATE", liveHandler);
      insforgeNative.realtime.off("CALL_SYNC_UPDATE", syncHandler);
      insforgeNative.realtime.off("CALL_NOTES_UPDATE", notesHandler);
      insforgeNative.realtime.off("connect", onConnect);
      insforgeNative.realtime.off("disconnect", onDisconnect);
      if (subscribed) {
        void insforgeNative.realtime.unsubscribe(channelName);
      }
      setConnected(false);
    };
  }, [callId]);

  return { connected };
}
