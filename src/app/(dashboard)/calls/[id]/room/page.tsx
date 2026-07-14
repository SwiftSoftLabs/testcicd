"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useCallSession } from "@/context/CallSessionContext";
import { PreJoinModal, type JoinConfig } from "@/components/calls/PreJoinModal";
import { isCallExitPending } from "@/lib/calls/callExitPending";
import { loadJoinConfig, saveJoinConfig } from "@/lib/calls/joinSession";

function isJoinableCallStatus(status: string): boolean {
  return status === "live" || status === "lobby" || status === "scheduled";
}
import type { CallSessionDetail } from "@/types/calls";

function CallRoomPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAppContext();
  const { session, startCall } = useCallSession();
  const id = params.id as string;
  const [call, setCall] = useState<CallSessionDetail | null>(null);
  const [joinConfig, setJoinConfig] = useState<JoinConfig | null>(() =>
    loadJoinConfig(id),
  );

  const returnPath = searchParams.get("from")?.trim() || "/dashboard";

  useEffect(() => {
    api.calls
      .get(id)
      .then((data) => {
        setCall(data);
        if (data.status === "processing") {
          router.replace(`/calls/${id}/processing`);
          return;
        }
        if (!isJoinableCallStatus(data.status)) {
          router.replace(`/calls/${id}`);
        }
      })
      .catch(() => router.push("/calls"));
  }, [id, router]);

  useEffect(() => {
    if (session?.callId === id) return;
    setJoinConfig(loadJoinConfig(id));
  }, [session, id]);

  const handleJoin = (config: JoinConfig) => {
    if (!call) return;
    saveJoinConfig(id, config);
    setJoinConfig(config);
    startCall({
      callId: id,
      call,
      joinConfig: config,
      returnPath,
    });
  };

  const handleCancel = async () => {
    if (
      call &&
      call.status === "lobby" &&
      currentUser?.id &&
      call.created_by === currentUser.id
    ) {
      try {
        await api.calls.deleteCall(id);
      } catch {
        /* best effort */
      }
      router.push("/calls");
      return;
    }
    router.push(`/calls/${id}`);
  };

  if (!call) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        Loading call…
      </div>
    );
  }

  const canShowPreJoin =
    isJoinableCallStatus(call.status) && !isCallExitPending(id);

  if (!joinConfig && session?.callId !== id) {
    if (!canShowPreJoin) {
      return (
        <div className="flex h-full items-center justify-center text-text-secondary text-sm">
          Redirecting…
        </div>
      );
    }
    return (
      <PreJoinModal
        call={call}
        onJoin={handleJoin}
        onCancel={() => void handleCancel()}
      />
    );
  }

  if (session?.callId === id) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary text-sm px-6 text-center">
        Call is active. Use the meeting window or picture-in-picture to control
        the call.
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-text-secondary">
      Loading call…
    </div>
  );
}

export default function CallRoomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-text-secondary">
          Loading call…
        </div>
      }
    >
      <CallRoomPageInner />
    </Suspense>
  );
}
