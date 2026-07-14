"use client";

import "@livekit/components-styles";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ConnectionState,
  createLocalAudioTrack,
  createLocalVideoTrack,
  LocalVideoTrack,
  ParticipantKind,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
  type TrackPublication,
  type TranscriptionSegment as LkTranscriptionSegment,
} from "livekit-client";
import {
  api,
  InsforgeRateLimitError,
  isInsforgeRateLimited,
  type WorkspaceMember,
} from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import {
  appendLocalSegment,
  buildLivePayloadFromLocal,
  clearLocalCallSession,
  loadLocalCallSession,
  localSessionToFlushBody,
  mergeLocalAiDelta,
  shouldRunLocalLiveNotes,
  type LocalCallSession,
} from "@/lib/calls/localCallSession";
import type {
  CallLivePayload,
  CallSyncPayload,
  TranscriptSegment,
} from "@/types/calls";
import {
  CallMeetingNotesSidebar,
  clearMeetingNotesPrivateDraft,
  type CallMeetingNotesSidebarHandle,
} from "@/components/calls/CallMeetingNotesSidebar";
import { useCallRealtime } from "@/hooks/useCallRealtime";
import { publishCallLiveUpdateClient } from "@/lib/calls/realtime-publish-client";
import { setCallExitPending } from "@/lib/calls/callExitPending";
import { clearJoinConfig, getActiveCallId } from "@/lib/calls/joinSession";
import {
  clearPersistedRtc,
  persistLiveKitRtcState,
  takePersistedLiveKitRtc,
} from "@/lib/calls/rtcHolder";
import { MeetingCompositeRecorder } from "@/lib/calls/localRecording";
import {
  livekitSegmentSentenceId,
  normalizeLiveSegmentTimes,
} from "@/lib/calls/transcriptSegments";
import {
  liveKitAudioCaptureOptions,
  liveKitVideoCaptureOptions,
  writeNoiseCancellationToStorage,
} from "@/lib/calls/microphoneAudioConfig";
import {
  attachEnhancedNoiseToAudioTrack,
  disposeNoiseFilter,
  setNoiseFilterEnabled,
  willUseEnhancedNoiseFilter,
  type EnhancedNoiseProcessor,
} from "@/lib/calls/audioNoiseFilter";
import {
  enumerateCallMediaDevices,
  findSpeakerInSameGroup,
  resolveMicrophoneLabel,
  shouldUseBrowserNoiseCancellationOnly,
  supportsAudioOutputSelection,
  type CallMediaDevice,
} from "@/lib/calls/audioDevices";
import { isCallDevSttOnly } from "@/lib/calls/constants";
import { createBackgroundBlurFromTrack } from "@/lib/calls/backgroundBlur/createBackgroundBlurProcessor";
import type { CallParticipantRow, CallSessionDetail } from "@/types/calls";
import type { JoinConfig } from "@/components/calls/PreJoinModal";
import {
  ensureAuthReadyForCallApi,
  isUnauthorizedError,
  refreshSessionOnWake,
} from "@/lib/auth/client-session";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
  deleteRemoteTrackSlot,
  detachAllRemoteTracks,
  getPresenterTrack,
  getRemoteTileTrack,
  remoteTrackSlotForSource,
  setRemoteTrackSlot,
  type RemoteVideoTrackSet,
} from "@/lib/calls/remoteVideoTracks";
import {
  attachVideoToContainer,
  clearVideoContainer,
  detachVideoFromContainer,
} from "@/lib/calls/videoAttachment";
import {
  CallAiSidebarHost,
  type CallAiSidebarHostHandle,
} from "@/components/calls/CallAiSidebarHost";

const VIDEO_PLAY_LAYER_CLASS =
  "absolute inset-0 w-full h-full min-h-0 [&>video]:!w-full [&>video]:!h-full [&>video]:!object-contain";

const PRESENTER_LAYOUT_CLASS =
  "flex-1 flex flex-col lg:flex-row gap-2 sm:gap-3 p-2 sm:p-3 min-h-0 overflow-hidden w-full";

const PRESENTER_STAGE_CLASS =
  "flex-1 relative bg-surface-dark rounded-xl overflow-hidden min-h-0 w-full lg:min-w-0";

const SOLO_GRID_LAYOUT_CLASS =
  "flex-1 grid grid-cols-1 auto-rows-fr gap-2 p-2 min-h-0 h-full w-full overflow-hidden min-w-0";

const MULTI_GRID_LAYOUT_CLASS =
  "flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 auto-rows-fr gap-2 p-2 min-h-0 h-full w-full overflow-hidden min-w-0";

const VIDEO_TILE_CLASS =
  "relative bg-surface-dark rounded-xl overflow-hidden min-h-0 h-full min-w-0";

const PRESENTER_SIDEBAR_CLASS =
  "flex flex-row lg:flex-col gap-2 sm:gap-3 shrink-0 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto w-full lg:w-36 xl:w-48 max-h-[30vh] lg:max-h-none";

const SIDEBAR_TILE_CLASS =
  "relative bg-surface-dark rounded-xl overflow-hidden aspect-video shrink-0 w-28 sm:w-32 lg:w-full";

const CALL_QUICK_LABEL_CLASS =
  "rounded-full border border-border-dark bg-surface-dark/95 px-3 py-1.5 text-sm font-medium text-text-main shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-border-dark/80 backdrop-blur-xl transition-colors group-hover:bg-surface-highlight";

const CALL_QUICK_ICON_CLASS =
  "flex size-11 items-center justify-center rounded-full border border-border-dark bg-surface-dark/95 text-text-secondary shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-border-dark/80 backdrop-blur-xl transition-colors group-hover:bg-surface-highlight group-hover:text-text-main";

const CALL_QUICK_FAB_CLASS =
  "pointer-events-auto flex size-14 cursor-pointer items-center justify-center rounded-full border border-border-dark bg-primary text-white shadow-lg shadow-primary/25 transition-all hover:scale-[1.03] hover:bg-blue-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function RemoteVideoTile({
  identity,
  className,
  remoteVideosRef,
  onTileMount,
}: {
  identity: string;
  className?: string;
  remoteVideosRef: React.RefObject<Map<string, HTMLDivElement>>;
  onTileMount: (identity: string) => void;
}) {
  const onTileMountRef = useRef(onTileMount);
  useEffect(() => {
    onTileMountRef.current = onTileMount;
  }, [onTileMount]);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      const map = remoteVideosRef.current;
      if (!map) return;
      if (el) {
        map.set(identity, el);
        onTileMountRef.current(identity);
      } else {
        map.delete(identity);
      }
    },
    [identity, remoteVideosRef],
  );

  return <div ref={setRef} className={className} />;
}

function parseRaisedHands(metadata: unknown): Record<string, boolean> {
  if (!metadata || typeof metadata !== "object") return {};
  const rh = (metadata as Record<string, unknown>).raisedHands;
  if (!rh || typeof rh !== "object" || Array.isArray(rh)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rh)) {
    if (v === true) out[k] = true;
  }
  return out;
}

function isAgentKind(kind: ParticipantKind): boolean {
  return kind === ParticipantKind.AGENT;
}

function VideoParticipantLabel({
  name,
  muted = false,
  size = "default",
  suffix,
}: {
  name: string;
  muted?: boolean;
  size?: "pip" | "pipMain" | "default";
  suffix?: string;
}) {
  const label = suffix ? `${name}${suffix}` : name;
  const posClass =
    size === "pipMain"
      ? "bottom-1 left-1"
      : size === "pip"
        ? "bottom-0.5 left-0.5"
        : "bottom-2 left-2";
  const textClass =
    size === "pipMain"
      ? "text-[10px] bg-black/50 px-1.5 py-0.5 rounded truncate"
      : size === "pip"
        ? "text-[9px] bg-black/50 px-1 rounded truncate"
        : "text-xs bg-black/50 px-2 py-0.5 rounded truncate";
  const badgeClass =
    size === "pip" || size === "pipMain"
      ? "shrink-0 flex items-center justify-center bg-red-500/20 text-red-300 rounded px-0.5"
      : "shrink-0 flex items-center justify-center bg-red-500/20 text-red-300 rounded px-1 py-0.5";
  const iconClass =
    size === "pip" || size === "pipMain" ? "text-[10px]" : "text-[14px]";
  return (
    <div
      className={`absolute ${posClass} flex items-center gap-1 z-20 pointer-events-none max-w-[calc(100%-0.5rem)]`}
    >
      <span className={textClass}>{label}</span>
      {muted ? (
        <span className={badgeClass} title="Muted">
          <span className={`material-symbols-outlined ${iconClass}`}>
            mic_off
          </span>
        </span>
      ) : null}
    </div>
  );
}

export type CallRoomLayout = "full" | "pip";

interface LiveKitCallRoomProps {
  callId: string;
  initialCall: CallSessionDetail;
  joinConfig: JoinConfig;
  layout?: CallRoomLayout;
  onSessionEnd?: () => void;
  onMinimize?: () => void;
  onExpand?: () => void;
  onToggleMeetingFullscreen?: () => void;
  onToggleAppSidebar?: () => void;
  isAppSidebarOpen?: boolean;
}

export function LiveKitCallRoom({
  callId,
  initialCall,
  joinConfig,
  layout = "full",
  onSessionEnd,
  onMinimize,
  onExpand,
  onToggleMeetingFullscreen,
  onToggleAppSidebar,
  isAppSidebarOpen,
}: LiveKitCallRoomProps) {
  const isPip = layout === "pip";
  const router = useRouter();
  const { currentUser, selectedProjectId, selectedWorkspaceId } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const [call, setCall] = useState(initialCall);
  const [status, setStatus] = useState<"joining" | "joined" | "error">(
    "joining",
  );
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [ending, setEnding] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const isScreenSharingRef = useRef(false);
  const remotePresenterIdentityRef = useRef<string | null>(null);
  const [remotePresenterIdentity, setRemotePresenterIdentity] = useState<
    string | null
  >(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(
    [],
  );
  const [inviteSelected, setInviteSelected] = useState<string[]>([]);
  const [cameras, setCameras] = useState<CallMediaDevice[]>([]);
  const [mics, setMics] = useState<CallMediaDevice[]>([]);
  const [speakers, setSpeakers] = useState<CallMediaDevice[]>([]);
  const [selectedCamDevice, setSelectedCamDevice] = useState("");
  const [selectedMicDevice, setSelectedMicDevice] = useState("");
  const [selectedSpeakerDevice, setSelectedSpeakerDevice] = useState("");
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [noiseCancellationOn, setNoiseCancellationOn] = useState(
    () => joinConfig.noiseCancellationEnabled ?? true,
  );
  const [handOverride, setHandOverride] = useState<boolean | null>(null);
  const handInFlightRef = useRef(false);
  const devicesPopoverRef = useRef<HTMLDivElement>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const quickActionsRef = useRef<HTMLDivElement>(null);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideosRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [remoteIdentities, setRemoteIdentities] = useState<string[]>([]);
  const [remoteMicMutedByIdentity, setRemoteMicMutedByIdentity] = useState<
    Record<string, boolean>
  >({});
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const noiseProcessorRef = useRef<EnhancedNoiseProcessor | null>(null);
  const rawVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const publishedVideoRef = useRef<LocalVideoTrack | null>(null);
  const blurCleanupRef = useRef<(() => void) | null>(null);
  const blurReconnectRef = useRef<
    ((sourceMST: MediaStreamTrack) => Promise<void>) | null
  >(null);
  const roomConnectedRef = useRef(false);
  const joinAttemptedRef = useRef(false);
  const pendingLocalPlayRef = useRef(false);
  const compositeRecorderRef = useRef<MeetingCompositeRecorder | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const remoteTracksRef = useRef<Map<string, RemoteVideoTrackSet>>(new Map());
  const syncRemoteTileRef = useRef<(identity: string) => void>(() => {});
  const syncPresenterStageRef = useRef<() => void>(() => {});
  const syncLocalPreviewRef = useRef<() => void>(() => {});
  const roomListenersCleanupRef = useRef<(() => void) | null>(null);
  const screenShareContainerRef = useRef<HTMLDivElement>(null);
  const remotePresenterContainerRef = useRef<HTMLDivElement>(null);
  const remotePresenterVideoRef = useRef<HTMLDivElement>(null);
  const autoKickedRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const aiSidebarHostRef = useRef<CallAiSidebarHostHandle | null>(null);
  const [agentInRoom, setAgentInRoom] = useState(false);
  const agentEnsureAttemptsRef = useRef(0);
  const [localSession, setLocalSession] = useState<LocalCallSession>(() =>
    loadLocalCallSession(callId),
  );
  const localSessionRef = useRef(localSession);
  localSessionRef.current = localSession;
  const liveBaseRef = useRef<CallLivePayload | null>(null);
  const [livePayload, setLivePayload] = useState<CallLivePayload | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [liveLoadError, setLiveLoadError] = useState<string | null>(null);
  const [liveAiError, setLiveAiError] = useState<string | null>(null);
  const [rateLimitBanner, setRateLimitBanner] = useState<string | null>(null);
  const lastLivePushAtRef = useRef(0);
  const liveNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveNotesInFlightRef = useRef(false);
  const scheduleLocalLiveNotesRef = useRef<() => void>(() => {});
  const canWriteSttRef = useRef(false);
  const liveBootstrappedRef = useRef(false);
  const lastLiveNotesRequestAtRef = useRef(0);
  const callJoinedAtRef = useRef<number | null>(null);
  const LIVE_NOTES_MIN_REQUEST_GAP_MS = 55_000;
  const devSttOnly = isCallDevSttOnly();

  const canWriteStt = useMemo(() => {
    if (!currentUser?.id) return false;
    const myParticipant = call.participants.find(
      (p) => p.user_id === currentUser.id,
    );
    return (
      call.created_by === currentUser.id ||
      myParticipant?.role === "host" ||
      myParticipant?.role === "cohost"
    );
  }, [call.created_by, call.participants, currentUser?.id]);

  useEffect(() => {
    canWriteSttRef.current = canWriteStt;
  }, [canWriteStt]);

  const getCallElapsedMs = useCallback(() => {
    const startedAt = call.started_at;
    if (startedAt) {
      const t = new Date(startedAt).getTime();
      if (Number.isFinite(t)) return Math.max(0, Date.now() - t);
    }
    const joinedAt = callJoinedAtRef.current;
    if (joinedAt != null) return Math.max(0, Date.now() - joinedAt);
    return 0;
  }, [call.started_at]);

  const refreshSync = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return null;
    if (!(await ensureAuthReadyForCallApi())) return null;
    try {
      const sync = await api.calls.sync(callId);
      setCall((prev) => ({
        ...prev,
        status: sync.status,
        metadata: sync.metadata,
        ai_enabled: sync.ai_enabled,
        participants: sync.participants,
        livekit_agent_dispatch_id: prev.livekit_agent_dispatch_id,
      }));
      return sync;
    } catch (e: unknown) {
      if (isUnauthorizedError(e)) return null;
      const msg = e instanceof Error ? e.message : null;
      if (msg) setError(msg);
    }
    return null;
  }, [callId]);

  const applySync = useCallback((sync: CallSyncPayload) => {
    setCall((prev) => ({
      ...prev,
      status: sync.status,
      metadata: sync.metadata,
      ai_enabled: sync.ai_enabled,
      participants: sync.participants,
    }));
  }, [callId]);

  const applyLivePayload = useCallback((data: CallLivePayload) => {
    lastLivePushAtRef.current = Date.now();
    setLivePayload(data);
    setLiveLoaded(true);
    setLiveLoadError(null);
  }, []);

  const refreshLive = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!(await ensureAuthReadyForCallApi())) return;
    try {
      const data = await api.calls.live(callId, { lite: true });
      liveBaseRef.current = data;
      const merged = buildLivePayloadFromLocal(
        localSessionRef.current,
        data,
      );
      applyLivePayload(merged);
    } catch (e: unknown) {
      if (isUnauthorizedError(e)) return;
      setLiveLoaded(true);
      setLiveLoadError(
        e instanceof Error ? e.message : "Could not load AI data",
      );
    }
  }, [callId, applyLivePayload]);

  const pushLocalLivePayload = useCallback(
    (session: LocalCallSession, opts?: { aiRunning?: boolean }) => {
      const merged = buildLivePayloadFromLocal(
        session,
        liveBaseRef.current,
        { aiRunning: opts?.aiRunning },
      );
      applyLivePayload(merged);
      if (canWriteSttRef.current) {
        void publishCallLiveUpdateClient(callId, merged);
      }
    },
    [callId, applyLivePayload],
  );

  const meetingNotesRef = useRef<CallMeetingNotesSidebarHandle | null>(null);

  const { connected: callRealtimeConnected } = useCallRealtime(
    status === "joined" ? callId : null,
    {
      onLiveUpdate: (payload) => {
        if (!canWriteSttRef.current) {
          applyLivePayload(payload);
        }
      },
      onSyncUpdate: applySync,
      onNotesUpdate: (payload) => {
        meetingNotesRef.current?.handleNotesUpdate(payload);
      },
    },
  );

  const participantForIdentity = useCallback(
    (identity: string) =>
      call.participants.find(
        (p) =>
          !p.left_at &&
          (p.livekit_identity === identity || p.user_id === identity),
      ),
    [call.participants],
  );

  const nameForParticipant = useCallback(
    (p: CallParticipantRow) => {
      const fromRow = p.display_name?.trim();
      if (fromRow) return fromRow;
      const member = workspaceMembers.find((m) => m.id === p.user_id);
      if (member?.name?.trim()) return member.name.trim();
      return "Participant";
    },
    [workspaceMembers],
  );

  const nameForUserId = useCallback(
    (userId: string) => {
      const p = call.participants.find((x) => x.user_id === userId && !x.left_at);
      if (p) return nameForParticipant(p);
      const member = workspaceMembers.find((m) => m.id === userId);
      if (member?.name?.trim()) return member.name.trim();
      return "Participant";
    },
    [call.participants, nameForParticipant, workspaceMembers],
  );

  const localDisplayName = useMemo(() => {
    if (!currentUser?.id) return "Participant";
    return nameForUserId(currentUser.id);
  }, [currentUser?.id, nameForUserId]);

  const memberNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of workspaceMembers) {
      if (m.name?.trim()) map[m.id] = m.name.trim();
    }
    for (const p of call.participants) {
      if (!map[p.user_id]) map[p.user_id] = nameForParticipant(p);
    }
    return map;
  }, [workspaceMembers, call.participants, nameForParticipant]);

  const labelForIdentity = useCallback(
    (identity: string): string => {
      const p = participantForIdentity(identity);
      if (p) return nameForParticipant(p);
      const remote = roomRef.current?.remoteParticipants.get(identity);
      if (remote?.name) return remote.name;
      return "Participant";
    },
    [participantForIdentity, nameForParticipant],
  );

  const isRemoteMicMuted = useCallback(
    (identity: string) => remoteMicMutedByIdentity[identity] === true,
    [remoteMicMutedByIdentity],
  );

  const addRemoteIdentity = useCallback((identity: string) => {
    setRemoteIdentities((prev) =>
      prev.includes(identity) ? prev : [...prev, identity],
    );
  }, []);

  const removeRemoteIdentity = useCallback((identity: string) => {
    remoteTracksRef.current.delete(identity);
    remoteVideosRef.current.delete(identity);
    setRemotePresenterIdentity((prev) => (prev === identity ? null : prev));
    setRemoteIdentities((prev) => prev.filter((id) => id !== identity));
    setRemoteMicMutedByIdentity((prev) => {
      if (!(identity in prev)) return prev;
      const next = { ...prev };
      delete next[identity];
      return next;
    });
  }, []);

  const updateRemotePresenterFromTracks = useCallback(
    (identity: string, tracks: RemoteVideoTrackSet) => {
      if (tracks.screenShare) {
        setRemotePresenterIdentity((prev) =>
          prev === identity ? prev : identity,
        );
        return;
      }
      setRemotePresenterIdentity((prev) =>
        prev === identity ? null : prev,
      );
    },
    [],
  );

  const syncRemoteTile = useCallback((identity: string) => {
    const container = remoteVideosRef.current.get(identity);
    if (!container) return;
    const tracks = remoteTracksRef.current.get(identity);
    const presenterId = remotePresenterIdentityRef.current;
    const track = getRemoteTileTrack(tracks, {
      isPresenterSidebar: presenterId === identity,
    });
    if (track) {
      attachVideoToContainer(track, container);
    } else {
      clearVideoContainer(container);
    }
  }, []);

  const syncPresenterStage = useCallback(() => {
    const container = remotePresenterVideoRef.current;
    const presenterId = remotePresenterIdentityRef.current;
    if (!container || !presenterId) return;
    const track = getPresenterTrack(
      remoteTracksRef.current.get(presenterId),
    );
    if (track) {
      attachVideoToContainer(track, container);
    } else {
      clearVideoContainer(container);
    }
  }, []);

  const replayLocalPreview = useCallback(() => {
    syncLocalPreviewRef.current();
  }, []);

  const handleRemoteVideoSubscribed = useCallback(
    (
      identity: string,
      track: RemoteVideoTrack,
      source: Track.Source,
    ) => {
      const slot = remoteTrackSlotForSource(source);
      if (!slot) return;
      const tracks = setRemoteTrackSlot(
        remoteTracksRef.current,
        identity,
        slot,
        track,
      );
      if (slot === "screenShare") {
        remotePresenterIdentityRef.current = identity;
        setRemotePresenterIdentity(identity);
        syncPresenterStage();
      } else {
        updateRemotePresenterFromTracks(identity, tracks);
      }
      syncRemoteTile(identity);
    },
    [syncRemoteTile, syncPresenterStage, updateRemotePresenterFromTracks],
  );

  const handleRemoteVideoUnsubscribed = useCallback(
    (
      identity: string,
      source: Track.Source,
    ) => {
      const slot = remoteTrackSlotForSource(source);
      if (!slot) return;
      const tracks = deleteRemoteTrackSlot(
        remoteTracksRef.current,
        identity,
        slot,
      );
      if (slot === "screenShare") {
        const wasPresenter = remotePresenterIdentityRef.current === identity;
        setRemotePresenterIdentity((prev) => {
          if (prev !== identity) return prev;
          if (tracks?.screenShare) return identity;
          return null;
        });
        if (wasPresenter && !tracks?.screenShare) {
          remotePresenterIdentityRef.current = null;
          const presenterEl = remotePresenterVideoRef.current;
          if (presenterEl) clearVideoContainer(presenterEl);
          syncPresenterStage();
        }
      } else {
        const tileEl = remoteVideosRef.current.get(identity);
        if (tileEl) clearVideoContainer(tileEl);
        syncRemoteTile(identity);
      }
      if (tracks) {
        updateRemotePresenterFromTracks(identity, tracks);
      }
    },
    [syncRemoteTile, syncPresenterStage, updateRemotePresenterFromTracks],
  );

  const onRemoteTileMount = useCallback((identity: string) => {
    syncRemoteTileRef.current(identity);
  }, []);

  const syncRemoteTracksToRecording = useCallback(
    (identity: string, participant: RemoteParticipant) => {
      const recorder = compositeRecorderRef.current;
      if (!recorder || isAgentKind(participant.kind)) return;
      const videoKey = `remote-${identity}`;
      const audioKey = `remote-${identity}-audio`;
      for (const pub of participant.trackPublications.values()) {
        const track = pub.track;
        if (!track) continue;
        if (track.kind === Track.Kind.Video) {
          recorder.setVideoTrack(videoKey, track.mediaStreamTrack);
        }
        if (track.kind === Track.Kind.Audio) {
          recorder.setAudioTrack(audioKey, track.mediaStreamTrack);
        }
      }
    },
    [],
  );

  const removeRemoteTracksFromRecording = useCallback((identity: string) => {
    const recorder = compositeRecorderRef.current;
    if (!recorder) return;
    recorder.removeVideoTrack(`remote-${identity}`);
    recorder.removeAudioTrack(`remote-${identity}-audio`);
  }, []);

  const startMeetingRecording = (
    audioTrack: LocalAudioTrack,
    videoTrack: LocalVideoTrack,
  ) => {
    if (!initialCall.recording_enabled) return;
    try {
      const recorder = new MeetingCompositeRecorder();
      recorder.setAudioTrack("local", audioTrack.mediaStreamTrack);
      recorder.setVideoTrack("local", videoTrack.mediaStreamTrack);
      compositeRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      recorder.start();
    } catch {
      /* recording optional */
    }
  };

  const stopLocalRecording = async (): Promise<Blob | null> => {
    const recorder = compositeRecorderRef.current;
    if (!recorder) return null;
    compositeRecorderRef.current = null;
    return recorder.stop();
  };

  const cleanupLocalRtc = useCallback(async () => {
    blurCleanupRef.current?.();
    blurCleanupRef.current = null;
    blurReconnectRef.current = null;

    const room = roomRef.current;
    const audio = audioTrackRef.current;
    const published = publishedVideoRef.current;
    const raw = rawVideoTrackRef.current;

    if (published && localVideoRef.current) {
      detachVideoFromContainer(published, localVideoRef.current);
    }

    detachAllRemoteTracks(remoteTracksRef.current);
    remoteVideosRef.current.clear();

    try {
      published?.stop();
    } catch {
      /* best effort */
    }
    publishedVideoRef.current = null;

    try {
      raw?.stop();
    } catch {
      /* best effort */
    }
    rawVideoTrackRef.current = null;

    try {
      audio?.stop();
    } catch {
      /* best effort */
    }
    await disposeNoiseFilter(noiseProcessorRef.current);
    noiseProcessorRef.current = null;
    audioTrackRef.current = null;

    if (roomConnectedRef.current && room) {
      roomListenersCleanupRef.current?.();
      roomListenersCleanupRef.current = null;
      try {
        await room.disconnect();
      } catch {
        /* best effort */
      }
      roomConnectedRef.current = false;
    }
    roomRef.current = null;
  }, []);

  const syncAgentInRoom = useCallback((room: Room) => {
    const present = [...room.remoteParticipants.values()].some((p) =>
      isAgentKind(p.kind),
    );
    setAgentInRoom(present);
    return present;
  }, []);

  const handleTranscriptionSegment = useCallback(
    (
      seg: LkTranscriptionSegment,
      participantIdentity: string | null,
    ) => {
      if (!seg.text.trim()) return;
      const speaker = participantIdentity
        ? call.participants.find(
            (p) =>
              p.livekit_identity === participantIdentity ||
              p.user_id === participantIdentity,
          )
        : undefined;
      const startMs = Math.round(seg.startTime * 1000);
      const sentenceId = seg.id ? livekitSegmentSentenceId(seg.id) : null;
      const rawSegment: TranscriptSegment = {
        text: seg.text,
        start_ms: startMs,
        end_ms: Math.round(seg.endTime * 1000),
        participant_identity: participantIdentity,
        is_final: seg.final,
        sentence_id: sentenceId,
        speaker_user_id: speaker?.user_id ?? null,
      };
      const callElapsedMs = getCallElapsedMs();
      const segment = normalizeLiveSegmentTimes(
        rawSegment,
        localSessionRef.current.segments,
        callElapsedMs,
      );
      setLocalSession((prev) => {
        const next = appendLocalSegment(callId, prev, segment);
        localSessionRef.current = next;
        return next;
      });
      aiSidebarHostRef.current?.setLiveSttCaption({
        text: seg.text,
        isFinal: seg.final,
        startMs: segment.start_ms,
        sentenceId,
      });
      if (canWriteSttRef.current) {
        pushLocalLivePayload(localSessionRef.current);
      }
      if (seg.final && canWriteSttRef.current && call.ai_enabled) {
        scheduleLocalLiveNotesRef.current();
      }
    },
    [call.ai_enabled, call.participants, callId, getCallElapsedMs, pushLocalLivePayload],
  );

  const reconnectBlurSourceRef = useRef<() => Promise<boolean>>(
    async () => false,
  );
  const recoverLocalMediaPreviewRef = useRef<() => Promise<void>>(
    async () => {},
  );

  const teardownRoomListeners = useCallback(() => {
    roomListenersCleanupRef.current?.();
    roomListenersCleanupRef.current = null;
  }, []);

  const setupRoomListeners = useCallback(
    (room: Room) => {
      teardownRoomListeners();

      const onConnectionStateChanged = (state: ConnectionState) => {
        setConnectionState(state);
      };
      const onReconnecting = () => setError(null);
      const onReconnected = () => setError(null);
      const onDisconnected = () => {
        roomConnectedRef.current = false;
        if (intentionalLeaveRef.current) return;
        setError("Connection lost");
        setStatus("error");
      };
      const onTranscriptionReceived = (
        segments: LkTranscriptionSegment[],
        participant?: Participant,
      ) => {
        if (!call.ai_enabled) return;
        const identity = participant?.identity ?? null;
        for (const seg of segments) {
          handleTranscriptionSegment(seg, identity);
        }
      };
      const onParticipantConnected = (participant: RemoteParticipant) => {
        if (isAgentKind(participant.kind)) {
          setAgentInRoom(true);
          return;
        }
        addRemoteIdentity(participant.identity);
      };
      const onParticipantDisconnected = (participant: RemoteParticipant) => {
        if (isAgentKind(participant.kind)) {
          setAgentInRoom(false);
          return;
        }
        removeRemoteTracksFromRecording(participant.identity);
        removeRemoteIdentity(participant.identity);
      };
      const onTrackSubscribed = (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (isAgentKind(participant.kind)) return;
        addRemoteIdentity(participant.identity);
        if (track.kind === Track.Kind.Video) {
          handleRemoteVideoSubscribed(
            participant.identity,
            track as RemoteVideoTrack,
            publication.source,
          );
        }
        if (track.kind === Track.Kind.Audio) {
          track.attach();
          void room.startAudio().catch(() => undefined);
          setRemoteMicMutedByIdentity((prev) => ({
            ...prev,
            [participant.identity]: publication.isMuted,
          }));
        }
        syncRemoteTracksToRecording(participant.identity, participant);
      };
      const onTrackUnsubscribed = (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (isAgentKind(participant.kind)) return;
        if (track.kind === Track.Kind.Video) {
          handleRemoteVideoUnsubscribed(
            participant.identity,
            publication.source,
          );
        }
      };
      const onTrackMuted = (
        publication: TrackPublication,
        participant: Participant,
      ) => {
        if (publication.kind === Track.Kind.Audio) {
          setRemoteMicMutedByIdentity((prev) => ({
            ...prev,
            [participant.identity]: true,
          }));
          return;
        }
        if (
          publication.kind === Track.Kind.Video &&
          publication.source === Track.Source.Camera &&
          participant.isLocal
        ) {
          setCamOn(false);
        }
      };
      const onTrackUnmuted = (
        publication: TrackPublication,
        participant: Participant,
      ) => {
        if (publication.kind === Track.Kind.Audio) {
          setRemoteMicMutedByIdentity((prev) => ({
            ...prev,
            [participant.identity]: false,
          }));
          return;
        }
        if (
          publication.kind === Track.Kind.Video &&
          publication.source === Track.Source.Camera &&
          participant.isLocal
        ) {
          setCamOn(true);
        }
      };
      const onLocalTrackPublished = (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setIsScreenSharing(true);
          isScreenSharingRef.current = true;
          const track = publication.videoTrack;
          if (track && localVideoRef.current) {
            attachVideoToContainer(track, localVideoRef.current);
          }
          if (track) {
            compositeRecorderRef.current?.setVideoTrack(
              "local",
              track.mediaStreamTrack,
            );
            track.mediaStreamTrack.addEventListener(
              "ended",
              () => {
                void stopScreenShareRef.current();
              },
              { once: true },
            );
          }
        }
      };
      const onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) {
          setIsScreenSharing(false);
          isScreenSharingRef.current = false;
          void recoverLocalMediaPreviewRef.current();
        }
      };
      const onAudioPlaybackStatusChanged = (playing: boolean) => {
        setAudioPlaybackBlocked(!playing);
      };

      room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
      room.on(RoomEvent.Reconnecting, onReconnecting);
      room.on(RoomEvent.Reconnected, onReconnected);
      room.on(RoomEvent.Disconnected, onDisconnected);
      room.on(RoomEvent.TranscriptionReceived, onTranscriptionReceived);
      room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.on(RoomEvent.TrackMuted, onTrackMuted);
      room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      room.on(
        RoomEvent.AudioPlaybackStatusChanged,
        onAudioPlaybackStatusChanged,
      );

      roomListenersCleanupRef.current = () => {
        room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
        room.off(RoomEvent.Reconnecting, onReconnecting);
        room.off(RoomEvent.Reconnected, onReconnected);
        room.off(RoomEvent.Disconnected, onDisconnected);
        room.off(RoomEvent.TranscriptionReceived, onTranscriptionReceived);
        room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
        room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
        room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
        room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        room.off(RoomEvent.TrackMuted, onTrackMuted);
        room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
        room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
        room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
        room.off(
          RoomEvent.AudioPlaybackStatusChanged,
          onAudioPlaybackStatusChanged,
        );
      };
    },
    [
      call.ai_enabled,
      addRemoteIdentity,
      removeRemoteIdentity,
      handleRemoteVideoSubscribed,
      handleRemoteVideoUnsubscribed,
      syncRemoteTracksToRecording,
      removeRemoteTracksFromRecording,
      handleTranscriptionSegment,
      teardownRoomListeners,
    ],
  );

  const applyNoiseFilterToAudio = useCallback(
    async (track: LocalAudioTrack, enabled: boolean): Promise<boolean> => {
      await disposeNoiseFilter(noiseProcessorRef.current);
      noiseProcessorRef.current = null;
      const processor = await attachEnhancedNoiseToAudioTrack(track, enabled);
      if (processor) {
        noiseProcessorRef.current = processor;
        return true;
      }
      return false;
    },
    [],
  );

  const createPreparedLocalAudioTrack = useCallback(
    async (opts: {
      microphoneId?: string;
      noiseCancellationEnabled: boolean;
    }): Promise<LocalAudioTrack> => {
      const micLabel = await resolveMicrophoneLabel(opts.microphoneId);
      let enhancedActive = await willUseEnhancedNoiseFilter(
        opts.noiseCancellationEnabled,
      );
      if (enhancedActive && shouldUseBrowserNoiseCancellationOnly(micLabel)) {
        enhancedActive = false;
      }

      let track = await createLocalAudioTrack(
        liveKitAudioCaptureOptions({
          microphoneId: opts.microphoneId,
          noiseCancellationEnabled: opts.noiseCancellationEnabled,
          enhancedNoiseFilterActive: enhancedActive,
        }),
      );

      const captureRate = track.mediaStreamTrack.getSettings().sampleRate;
      if (
        enhancedActive &&
        shouldUseBrowserNoiseCancellationOnly(micLabel, captureRate)
      ) {
        track.stop();
        enhancedActive = false;
        track = await createLocalAudioTrack(
          liveKitAudioCaptureOptions({
            microphoneId: opts.microphoneId,
            noiseCancellationEnabled: opts.noiseCancellationEnabled,
            enhancedNoiseFilterActive: false,
          }),
        );
      } else if (enhancedActive) {
        const attached = await applyNoiseFilterToAudio(
          track,
          opts.noiseCancellationEnabled,
        );
        if (!attached) {
          track.stop();
          track = await createLocalAudioTrack(
            liveKitAudioCaptureOptions({
              microphoneId: opts.microphoneId,
              noiseCancellationEnabled: opts.noiseCancellationEnabled,
              enhancedNoiseFilterActive: false,
            }),
          );
        }
      }

      return track;
    },
    [applyNoiseFilterToAudio],
  );

  const routeSpeakerForMicrophone = useCallback(async (micDeviceId: string) => {
    const room = roomRef.current;
    if (!room || !micDeviceId) return;

    if (!supportsAudioOutputSelection()) {
      await room.startAudio().catch(() => undefined);
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const paired = findSpeakerInSameGroup(micDeviceId, devices);
    if (paired) {
      const switched = await room.switchActiveDevice(
        "audiooutput",
        paired.deviceId,
      );
      if (switched) setSelectedSpeakerDevice(paired.deviceId);
    }
    await room.startAudio().catch(() => undefined);
  }, []);

  const syncMediaDevices = useCallback(async () => {
    try {
      const listed = await enumerateCallMediaDevices();
      setCameras(listed.cameras);
      setMics(listed.microphones);
      setSpeakers(listed.speakers);

      const vId = rawVideoTrackRef.current?.mediaStreamTrack.getSettings()
        .deviceId;
      const aId = audioTrackRef.current?.mediaStreamTrack.getSettings()
        .deviceId;
      const outId = roomRef.current?.getActiveDevice("audiooutput");

      if (vId) setSelectedCamDevice(vId);
      else if (listed.cameras[0]) setSelectedCamDevice(listed.cameras[0].deviceId);

      if (aId) setSelectedMicDevice(aId);
      else if (listed.microphones[0]) {
        setSelectedMicDevice(listed.microphones[0].deviceId);
      }

      if (outId && listed.speakers.some((speaker) => speaker.deviceId === outId)) {
        setSelectedSpeakerDevice(outId);
      } else if (listed.speakers[0]) {
        setSelectedSpeakerDevice(listed.speakers[0].deviceId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const joinRoom = useCallback(async () => {
    try {
      const creds = await api.calls.token(callId);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        webAudioMix: true,
      });
      roomRef.current = room;
      setupRoomListeners(room);

      await room.connect(creds.url, creds.token);
      roomConnectedRef.current = true;

      const ncEnabled = joinConfig.noiseCancellationEnabled ?? true;
      const audioTrack = await createPreparedLocalAudioTrack({
        microphoneId: joinConfig.audioDeviceId,
        noiseCancellationEnabled: ncEnabled,
      });
      audioTrackRef.current = audioTrack;

      const micId =
        joinConfig.audioDeviceId ??
        audioTrack.mediaStreamTrack.getSettings().deviceId;
      if (micId) {
        await routeSpeakerForMicrophone(micId);
      } else {
        await room.startAudio().catch(() => undefined);
      }

      const rawVideoTrack = await createLocalVideoTrack(
        liveKitVideoCaptureOptions(joinConfig.videoDeviceId),
      );
      rawVideoTrackRef.current = rawVideoTrack;

      let videoToPublish: LocalVideoTrack = rawVideoTrack;
      if (joinConfig.blurEnabled) {
        const { track, cleanup, reconnectSource, waitForFirstFrame } =
          await createBackgroundBlurFromTrack(rawVideoTrack.mediaStreamTrack);
        blurCleanupRef.current = cleanup;
        blurReconnectRef.current = reconnectSource;
        await waitForFirstFrame();
        videoToPublish = new LocalVideoTrack(track);
        videoToPublish.source = Track.Source.Camera;
      } else {
        rawVideoTrack.source = Track.Source.Camera;
      }
      publishedVideoRef.current = videoToPublish;

      await room.localParticipant.publishTrack(audioTrack);
      const publishSource = Track.Source.Camera;
      await room.localParticipant.publishTrack(videoToPublish, {
        source: publishSource,
      });

      // Dispatch STT agent after mic is live so the worker can subscribe immediately.
      await api.calls.join(callId, new Date().toISOString());

      startMeetingRecording(audioTrack, videoToPublish);
      syncAgentInRoom(room);

      for (const participant of room.remoteParticipants.values()) {
        if (isAgentKind(participant.kind)) continue;
        addRemoteIdentity(participant.identity);
        for (const pub of participant.trackPublications.values()) {
          if (pub.track?.kind === Track.Kind.Video) {
            handleRemoteVideoSubscribed(
              participant.identity,
              pub.track as RemoteVideoTrack,
              pub.source,
            );
          }
          if (pub.track?.kind === Track.Kind.Audio) {
            pub.track.attach();
          }
        }
        syncRemoteTracksToRecording(participant.identity, participant);
      }

      pendingLocalPlayRef.current = true;
      callJoinedAtRef.current = Date.now();
      setStatus("joined");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to join call");
      setStatus("error");
      api.calls.leave(callId).catch(() => undefined);
    }
  }, [
    callId,
    joinConfig,
    setupRoomListeners,
    syncAgentInRoom,
    addRemoteIdentity,
    handleRemoteVideoSubscribed,
    syncRemoteTracksToRecording,
    applyNoiseFilterToAudio,
    createPreparedLocalAudioTrack,
    routeSpeakerForMicrophone,
  ]);

  useEffect(() => {
    if (!call.ai_enabled || status !== "joined") return undefined;

    const tryEnsureAgent = () => {
      const room = roomRef.current;
      if (!room || syncAgentInRoom(room)) return;
      if (agentEnsureAttemptsRef.current >= 6) return;
      agentEnsureAttemptsRef.current += 1;
      void api.calls.ensureAgent(callId).catch(() => undefined);
    };

    const retryDelaysMs = [5_000, 12_000, 25_000, 45_000, 75_000, 120_000];
    const timers = retryDelaysMs.map((delay) =>
      window.setTimeout(tryEnsureAgent, delay),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [call.ai_enabled, callId, status, syncAgentInRoom]);

  const restorePersistedRtc = useCallback(() => {
    const snap = takePersistedLiveKitRtc(callId);
    if (!snap) return false;

    roomRef.current = snap.room;
    setupRoomListeners(snap.room);
    roomConnectedRef.current = snap.roomConnected;
    audioTrackRef.current = snap.audioTrack;
    rawVideoTrackRef.current = snap.rawVideoTrack;
    publishedVideoRef.current = snap.publishedVideo;
    blurCleanupRef.current = snap.blurCleanup;
    blurReconnectRef.current = snap.blurReconnect;
    setRemoteIdentities(snap.remoteIdentities);
    setIsScreenSharing(snap.isScreenSharing);
    isScreenSharingRef.current = snap.isScreenSharing;
    setMicOn(!(snap.audioTrack?.isMuted ?? false));
    setCamOn(!(snap.rawVideoTrack?.isMuted ?? false));
    pendingLocalPlayRef.current = true;
    if (callJoinedAtRef.current == null) {
      const startedAt = call.started_at
        ? new Date(call.started_at).getTime()
        : NaN;
      callJoinedAtRef.current = Number.isFinite(startedAt)
        ? startedAt
        : Date.now();
    }
    setStatus("joined");
    setError(null);
    syncAgentInRoom(snap.room);

    const mutedMap: Record<string, boolean> = {};
    for (const participant of snap.room.remoteParticipants.values()) {
      if (isAgentKind(participant.kind)) continue;
      mutedMap[participant.identity] = !participant.isMicrophoneEnabled;
      for (const pub of participant.trackPublications.values()) {
        if (pub.track?.kind === Track.Kind.Video) {
          handleRemoteVideoSubscribed(
            participant.identity,
            pub.track as RemoteVideoTrack,
            pub.source,
          );
        }
        if (pub.track?.kind === Track.Kind.Audio) {
          pub.track.attach();
        }
      }
    }
    setRemoteMicMutedByIdentity(mutedMap);
    if (snap.audioTrack) {
      const nc = joinConfig.noiseCancellationEnabled ?? true;
      void willUseEnhancedNoiseFilter(nc).then(async (enhancedActive) => {
        if (!snap.audioTrack) return;
        if (enhancedActive) {
          void applyNoiseFilterToAudio(snap.audioTrack, nc);
        }
        const micId = snap.audioTrack.mediaStreamTrack.getSettings().deviceId;
        if (micId) await routeSpeakerForMicrophone(micId);
        else await snap.room.startAudio().catch(() => undefined);
      });
    } else {
      void snap.room.startAudio().catch(() => undefined);
    }
    return true;
  }, [call.started_at, callId, setupRoomListeners, syncAgentInRoom, handleRemoteVideoSubscribed, joinConfig.noiseCancellationEnabled, applyNoiseFilterToAudio, routeSpeakerForMicrophone]);

  useEffect(() => {
    if (joinAttemptedRef.current) return;
    joinAttemptedRef.current = true;
    if (restorePersistedRtc()) return;
    void joinRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      const activeId = getActiveCallId();
      const layoutRemount = activeId === callId && roomConnectedRef.current;
      if (layoutRemount && roomRef.current) {
        persistLiveKitRtcState({
          callId,
          room: roomRef.current,
          roomConnected: roomConnectedRef.current,
          audioTrack: audioTrackRef.current,
          rawVideoTrack: rawVideoTrackRef.current,
          publishedVideo: publishedVideoRef.current,
          blurCleanup: blurCleanupRef.current,
          blurReconnect: blurReconnectRef.current,
          remoteIdentities: [...remoteIdentities],
          isScreenSharing,
        });
        return;
      }
      clearPersistedRtc(callId);
      void cleanupLocalRtc();
    };
  }, [cleanupLocalRtc, callId, layout, status, remoteIdentities, isScreenSharing]);

  useEffect(() => {
    if (status !== "joined") return;
    syncLocalPreviewRef.current();
  }, [status, isScreenSharing]);

  useEffect(() => {
    if (status !== "joined") return;
    for (const identity of remoteIdentities) {
      syncRemoteTileRef.current(identity);
    }
    syncPresenterStageRef.current();
  }, [status, remoteIdentities, remotePresenterIdentity, layout]);

  const runLocalLiveNotes = useCallback(async () => {
      const session = localSessionRef.current;
      const sinceRequest = Date.now() - lastLiveNotesRequestAtRef.current;
      if (devSttOnly) return;
      if (!canWriteStt || !call.ai_enabled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (liveNotesInFlightRef.current) return;
      if (!shouldRunLocalLiveNotes(session)) return;
      if (sinceRequest < LIVE_NOTES_MIN_REQUEST_GAP_MS) return;

      const authReady = await ensureAuthReadyForCallApi();
      if (!authReady) return;

      lastLiveNotesRequestAtRef.current = Date.now();
      liveNotesInFlightRef.current = true;
      setLiveAiError(null);
      const running: LocalCallSession = { ...session, aiRunning: true };
      localSessionRef.current = running;
      setLocalSession(running);
      pushLocalLivePayload(running, { aiRunning: true });

      try {
        const delta = await api.calls.runLiveAi(callId, {
          segments: session.segments,
          mode: "notes",
          sinceCharCount: session.lastAiCharCount,
        });
        if (!delta.geminiConfigured) {
          setLiveAiError(
            "Meeting AI is not configured on the server (OPENROUTER_API_KEY).",
          );
        }
        const merged = mergeLocalAiDelta(callId, session, delta);
        localSessionRef.current = merged;
        setLocalSession(merged);
        pushLocalLivePayload(merged);
      } catch (e: unknown) {
        if (isUnauthorizedError(e)) {
          liveNotesInFlightRef.current = false;
          return;
        }
        const msg =
          e instanceof Error ? e.message : "Live notes update failed";
        setLiveAiError(msg);
        const idle = { ...session, aiRunning: false };
        localSessionRef.current = idle;
        setLocalSession(idle);
        pushLocalLivePayload(idle);
      } finally {
        liveNotesInFlightRef.current = false;
      }
    },
    [callId, call.ai_enabled, canWriteStt, devSttOnly, pushLocalLivePayload],
  );

  const scheduleLocalLiveNotes = useCallback(() => {
      if (devSttOnly || !canWriteStt) return;
      if (liveNotesDebounceRef.current) clearTimeout(liveNotesDebounceRef.current);
      liveNotesDebounceRef.current = setTimeout(() => {
        void runLocalLiveNotes();
      }, 2_000);
    },
    [canWriteStt, devSttOnly, runLocalLiveNotes],
  );

  useEffect(() => {
    scheduleLocalLiveNotesRef.current = scheduleLocalLiveNotes;
  }, [scheduleLocalLiveNotes]);

  useEffect(() => {
    if (status !== "joined") return undefined;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSessionOnWake().then((ok) => {
        if (!ok) return;
        void refreshSync();
        if (call.ai_enabled) void refreshLive();
        if (status === "joined") {
          void recoverLocalMediaPreviewRef.current();
          for (const identity of remoteIdentities) {
            syncRemoteTileRef.current(identity);
          }
          syncPresenterStageRef.current();
        }
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [status, call.ai_enabled, refreshSync, refreshLive, remoteIdentities]);

  const bindPresenterVideoRef = useCallback((el: HTMLDivElement | null) => {
    remotePresenterVideoRef.current = el;
    if (el) syncPresenterStageRef.current();
  }, []);

  const bindLocalVideoRef = useCallback((el: HTMLDivElement | null) => {
    localVideoRef.current = el;
    if (el) syncLocalPreviewRef.current();
  }, []);

  useEffect(() => {
    if (!call.ai_enabled || status !== "joined") return;
    if (liveBootstrappedRef.current) return;
    liveBootstrappedRef.current = true;
    void refreshLive();
  }, [call.ai_enabled, status, callId, refreshLive]);

  useEffect(() => {
    if (!call.ai_enabled || status !== "joined") return;
    if (canWriteStt) return undefined;
    if (callRealtimeConnected) return undefined;

    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const sincePush = Date.now() - lastLivePushAtRef.current;
      if (sincePush < 90_000) return;
      void refreshLive();
    }, 90_000);
    return () => clearInterval(id);
  }, [call.ai_enabled, status, canWriteStt, callRealtimeConnected, refreshLive]);

  const isHostUser = call.created_by === currentUser?.id;
  useEffect(() => {
    if (status !== "joined") return undefined;

    const intervalMs = callRealtimeConnected
      ? isHostUser
        ? 30_000
        : 15_000
      : isHostUser
        ? 20_000
        : 12_000;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshSync();
    }, intervalMs);
    return () => clearInterval(id);
  }, [status, callRealtimeConnected, isHostUser, refreshSync]);

  useEffect(() => {
    if (devSttOnly || !canWriteStt || !call.ai_enabled || status !== "joined")
      return undefined;
    const initial = setTimeout(() => {
      scheduleLocalLiveNotes();
    }, 8_000);
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      scheduleLocalLiveNotes();
    }, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [canWriteStt, call.ai_enabled, devSttOnly, status, scheduleLocalLiveNotes]);

  useEffect(() => {
    setHandOverride(null);
    aiSidebarHostRef.current?.setLiveSttCaption(null);
    const hydrated = loadLocalCallSession(callId);
    localSessionRef.current = hydrated;
    setLocalSession(hydrated);
    if (hydrated.segments.length > 0 && liveBaseRef.current) {
      pushLocalLivePayload(hydrated);
    }
  }, [callId, pushLocalLivePayload]);

  useEffect(() => {
    if (status !== "joined") aiSidebarHostRef.current?.setLiveSttCaption(null);
  }, [status]);

  useEffect(() => {
    if (status !== "joined" || !canWriteSttRef.current) return undefined;
    const flushOnHide = () => {
      const session = localSessionRef.current;
      if (!session.dirty) return;
      const body = JSON.stringify(localSessionToFlushBody(session));
      void authenticatedFetch(`/api/calls/${callId}/transcript/flush`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include",
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", flushOnHide);
    return () => window.removeEventListener("pagehide", flushOnHide);
  }, [status, callId]);

  const reconnectBlurSource = useCallback(async (): Promise<boolean> => {
    const raw = rawVideoTrackRef.current;
    const reconnect = blurReconnectRef.current;
    if (!raw || !reconnect) return false;
    await reconnect(raw.mediaStreamTrack);
    return true;
  }, []);

  const recoverLocalMediaPreview = useCallback(async () => {
    if (joinConfig.blurEnabled && !isScreenSharingRef.current) {
      await reconnectBlurSource();
    }
    pendingLocalPlayRef.current = true;
    syncLocalPreviewRef.current();
    const published = publishedVideoRef.current;
    if (published) {
      compositeRecorderRef.current?.setVideoTrack(
        "local",
        published.mediaStreamTrack,
      );
    }
    setCamOn(!(rawVideoTrackRef.current?.isMuted ?? false));
  }, [joinConfig.blurEnabled, reconnectBlurSource]);

  useLayoutEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
    remotePresenterIdentityRef.current = remotePresenterIdentity;
    syncRemoteTileRef.current = syncRemoteTile;
    syncPresenterStageRef.current = syncPresenterStage;
    syncLocalPreviewRef.current = () => {
      const track = isScreenSharingRef.current
        ? (roomRef.current?.localParticipant.getTrackPublication(
            Track.Source.ScreenShare,
          )?.videoTrack ?? null)
        : publishedVideoRef.current;
      const el = localVideoRef.current;
      if (track && el) {
        attachVideoToContainer(track, el);
        pendingLocalPlayRef.current = false;
      }
    };
    reconnectBlurSourceRef.current = reconnectBlurSource;
    recoverLocalMediaPreviewRef.current = recoverLocalMediaPreview;
  });

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMicOn = !micOn;
    setMicOn(nextMicOn);
    try {
      await room.localParticipant.setMicrophoneEnabled(nextMicOn);
    } catch {
      setMicOn(!nextMicOn);
    }
  };

  const toggleCam = async () => {
    if (isScreenSharing || deviceBusy) return;
    const room = roomRef.current;
    const raw = rawVideoTrackRef.current;
    const published = publishedVideoRef.current;
    if (!room || !raw) return;
    const nextCamOn = !camOn;
    const usesBlur =
      joinConfig.blurEnabled && published != null && published !== raw;

    setDeviceBusy(true);
    const cameraPub = room.localParticipant.getTrackPublication(
      Track.Source.Camera,
    );

    try {
      if (usesBlur && cameraPub?.track) {
        if (!nextCamOn) {
          await cameraPub.mute();
          setCamOn(false);
          return;
        }
        await reconnectBlurSource();
        await cameraPub.unmute();
        replayLocalPreview();
        setCamOn(true);
        return;
      }

      if (!nextCamOn) {
        await room.localParticipant.setCameraEnabled(false);
        setCamOn(false);
        return;
      }

      await room.localParticipant.setCameraEnabled(true);
      replayLocalPreview();
      setCamOn(true);
    } catch {
      /* leave camOn unchanged */
    } finally {
      setDeviceBusy(false);
    }
  };

  const stopScreenShareRef = useRef<() => Promise<void>>(async () => {});

  const stopScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) {
      setIsScreenSharing(false);
      return;
    }
    setScreenBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(false);
      setIsScreenSharing(false);
      isScreenSharingRef.current = false;
    } catch {
      /* best effort */
    } finally {
      setScreenBusy(false);
    }
  }, []);

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    if (status !== "joined" || screenBusy || isScreenSharing) return;
    const room = roomRef.current;
    if (!room) return;
    setScreenBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(true);
      setIsScreenSharing(true);
    } catch {
      /* user cancelled picker */
    } finally {
      setScreenBusy(false);
    }
  }, [status, screenBusy, isScreenSharing]);

  const replaceLocalAudioTrack = useCallback(
    async (opts: {
      microphoneId?: string;
      noiseCancellationEnabled: boolean;
    }) => {
      const room = roomRef.current;
      const oldAudio = audioTrackRef.current;
      if (!room || status !== "joined" || deviceBusy || !oldAudio) return false;

      setDeviceBusy(true);
      try {
        await disposeNoiseFilter(noiseProcessorRef.current);
        noiseProcessorRef.current = null;
        await room.localParticipant.unpublishTrack(oldAudio);
        oldAudio.stop();

        const newAudio = await createPreparedLocalAudioTrack({
          microphoneId: opts.microphoneId || selectedMicDevice || undefined,
          noiseCancellationEnabled: opts.noiseCancellationEnabled,
        });
        await room.localParticipant.publishTrack(newAudio);
        audioTrackRef.current = newAudio;
        compositeRecorderRef.current?.setAudioTrack(
          "local",
          newAudio.mediaStreamTrack,
        );
        if (!micOn) await newAudio.mute();
        if (opts.microphoneId) setSelectedMicDevice(opts.microphoneId);
        return true;
      } catch {
        return false;
      } finally {
        setDeviceBusy(false);
      }
    },
    [status, deviceBusy, selectedMicDevice, micOn, createPreparedLocalAudioTrack],
  );

  const toggleNoiseCancellation = async () => {
    if (status !== "joined" || deviceBusy) return;
    const next = !noiseCancellationOn;
    if (noiseProcessorRef.current) {
      setDeviceBusy(true);
      try {
        await setNoiseFilterEnabled(noiseProcessorRef.current, next);
        setNoiseCancellationOn(next);
        writeNoiseCancellationToStorage(next);
      } catch {
        /* ignore */
      } finally {
        setDeviceBusy(false);
      }
      return;
    }
    const ok = await replaceLocalAudioTrack({
      noiseCancellationEnabled: next,
    });
    if (ok) {
      setNoiseCancellationOn(next);
      writeNoiseCancellationToStorage(next);
    }
  };

  const applyMicDevice = async (deviceId: string) => {
    if (!deviceId || deviceBusy) return;
    const ok = await replaceLocalAudioTrack({
      microphoneId: deviceId,
      noiseCancellationEnabled: noiseCancellationOn,
    });
    if (ok) {
      setSelectedMicDevice(deviceId);
      await routeSpeakerForMicrophone(deviceId);
    }
  };

  const applySpeakerDevice = async (deviceId: string) => {
    const room = roomRef.current;
    if (!room || !deviceId || deviceBusy || !supportsAudioOutputSelection()) {
      return;
    }
    setDeviceBusy(true);
    try {
      const switched = await room.switchActiveDevice("audiooutput", deviceId);
      if (switched) {
        setSelectedSpeakerDevice(deviceId);
        await room.startAudio().catch(() => undefined);
      }
    } catch {
      /* ignore */
    } finally {
      setDeviceBusy(false);
    }
  };

  const enableRemoteAudioPlayback = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.startAudio().catch(() => undefined);
  };

  const applyCamDevice = async (deviceId: string) => {
    const raw = rawVideoTrackRef.current;
    if (!raw || !deviceId || deviceBusy || isScreenSharing) return;
    setDeviceBusy(true);
    try {
      await raw.setDeviceId(deviceId);
      setSelectedCamDevice(deviceId);
      if (joinConfig.blurEnabled) {
        await reconnectBlurSource();
        replayLocalPreview();
      }
    } catch {
      /* ignore */
    } finally {
      setDeviceBusy(false);
    }
  };

  useEffect(() => {
    if (!devicesOpen || status !== "joined") return;
    void syncMediaDevices();
  }, [devicesOpen, status, syncMediaDevices]);

  useEffect(() => {
    if (status !== "joined") return;
    const onDeviceChange = () => {
      void syncMediaDevices();
      const micId =
        selectedMicDevice ||
        audioTrackRef.current?.mediaStreamTrack.getSettings().deviceId;
      if (micId) void routeSpeakerForMicrophone(micId);
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [status, selectedMicDevice, syncMediaDevices, routeSpeakerForMicrophone]);

  useEffect(() => {
    if (!devicesOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        devicesPopoverRef.current &&
        !devicesPopoverRef.current.contains(e.target as Node)
      ) {
        setDevicesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [devicesOpen]);

  useEffect(() => {
    if (!quickActionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        quickActionsRef.current &&
        !quickActionsRef.current.contains(e.target as Node)
      ) {
        setQuickActionsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickActionsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [quickActionsOpen]);

  useEffect(() => {
    if (!inviteOpen) return;
    setInviteError(null);
    setInviteSelected([]);
    void api.users
      .getMembers(call.workspace_id, { limit: 200 })
      .then((res) => setWorkspaceMembers(res.data))
      .catch(() => setWorkspaceMembers([]));
  }, [inviteOpen, call.workspace_id]);

  const exitRoom = async (endForEveryone: boolean) => {
    if (ending) return;
    setEnding(true);
    intentionalLeaveRef.current = true;

    await cleanupLocalRtc();

    const session = localSessionRef.current;
    const needsProcessingPage =
      endForEveryone &&
      (initialCall.recording_enabled || initialCall.ai_enabled);

    if (needsProcessingPage) {
      setCallExitPending(callId);
    }

    // End for everyone: flush transcript then endCall on the critical path so
    // status becomes "processing" (and sync is published) before navigation.
    if (endForEveryone) {
      try {
        await meetingNotesRef.current?.flushPending();
      } catch {
        /* best-effort */
      }

      if (canWriteSttRef.current && session.dirty && !isInsforgeRateLimited()) {
        try {
          await api.calls.flushTranscript(
            callId,
            localSessionToFlushBody(session),
          );
          clearLocalCallSession(callId);
        } catch (e: unknown) {
          if (e instanceof InsforgeRateLimitError) {
            setRateLimitBanner(
              "Could not save transcript — database is busy. Try leaving again in a minute.",
            );
          }
        }
      }

      try {
        await api.calls.endCall(callId);
      } catch {
        /* processing page recovers */
      }
    }

    void (async () => {
      if (!endForEveryone) {
        try {
          await meetingNotesRef.current?.flushPending();
        } catch {
          /* best-effort */
        }
      }

      let blob: Blob | null = null;
      if (initialCall.recording_enabled) {
        blob = await stopLocalRecording();
      }

      void api.calls
        .exportMeetingNotes(callId)
        .then((r) => {
          if ("file_name" in r && r.file_name) {
            addToast(
              `Notes saved as “${r.file_name}” in Files → user-meeting-notes.`,
              "success",
            );
            clearMeetingNotesPrivateDraft(callId);
          }
        })
        .catch(() => undefined);

      if (
        !endForEveryone &&
        canWriteSttRef.current &&
        session.dirty &&
        !isInsforgeRateLimited()
      ) {
        try {
          await api.calls.flushTranscript(
            callId,
            localSessionToFlushBody(session),
          );
          clearLocalCallSession(callId);
        } catch (e: unknown) {
          if (e instanceof InsforgeRateLimitError) {
            setRateLimitBanner(
              "Could not save transcript — database is busy. Try leaving again in a minute.",
            );
          }
        }
      }

      try {
        await api.calls.leave(callId);
      } catch {
        /* best-effort */
      }

      if (endForEveryone && blob) {
        const started = recordingStartedAtRef.current ?? Date.now();
        const durationSeconds = (Date.now() - started) / 1000;
        void api.calls
          .uploadRecording(callId, blob, durationSeconds)
          .catch(() => undefined);
      }
    })();

    onSessionEnd?.();
    clearJoinConfig(callId);
    clearPersistedRtc(callId);
    if (endForEveryone) {
      router.replace(
        needsProcessingPage
          ? `/calls/${callId}/processing`
          : "/calls?tab=history",
      );
    } else {
      router.replace("/calls");
    }
  };

  const leaveCall = () => void exitRoom(false);
  const endCall = () => void exitRoom(true);

  const isHost = call.created_by === currentUser?.id;

  useEffect(() => {
    if (isHost) return;
    if (status !== "joined") return;
    if (autoKickedRef.current) return;
    if (!["processing", "completed", "cancelled", "failed"].includes(call.status))
      return;
    autoKickedRef.current = true;
    void exitRoom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.status]);

  const raisedHandsMap = parseRaisedHands(call.metadata);
  const serverRaisedIds = Object.keys(raisedHandsMap).filter(
    (uid) => raisedHandsMap[uid],
  );
  const raisedUserIds =
    handOverride === null
      ? serverRaisedIds
      : (() => {
          const s = new Set(serverRaisedIds);
          if (currentUser?.id) {
            if (handOverride) s.add(currentUser.id);
            else s.delete(currentUser.id);
          }
          return [...s];
        })();
  const serverHandRaised = currentUser?.id
    ? raisedHandsMap[currentUser.id] === true
    : false;
  const myHandRaised =
    handOverride !== null ? handOverride : serverHandRaised;

  const toggleRaiseHand = async () => {
    if (!currentUser?.id || handInFlightRef.current) return;
    const next = !myHandRaised;
    setHandOverride(next);
    handInFlightRef.current = true;
    try {
      await api.calls.raiseHand(callId, next);
      setHandOverride(null);
    } catch {
      setHandOverride(null);
    } finally {
      handInFlightRef.current = false;
    }
  };

  const submitInvite = async () => {
    const activeIds = new Set(
      call.participants.filter((p) => !p.left_at).map((p) => p.user_id),
    );
    const ids = inviteSelected.filter((id) => !activeIds.has(id));
    if (ids.length === 0) {
      setInviteError("Select members who are not already on this call.");
      return;
    }
    setInviteLoading(true);
    setInviteError(null);
    try {
      await api.calls.invite(callId, { participant_ids: ids });
      await refreshSync();
      setInviteOpen(false);
    } catch (e: unknown) {
      setInviteError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviteLoading(false);
    }
  };

  const toggleInviteMember = (id: string) => {
    setInviteSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") void toggleMic();
      if (e.key === "v" || e.key === "V") void toggleCam();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleFullscreen = () => {
    const el =
      remotePresenterIdentity != null && !isScreenSharing
        ? remotePresenterContainerRef.current
        : screenShareContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  const presenterMode = isScreenSharing || remotePresenterIdentity != null;
  const viewingRemotePresenter =
    remotePresenterIdentity != null && !isScreenSharing;

  const tileIdentities = remoteIdentities.filter((identity) => {
    const p = roomRef.current?.remoteParticipants.get(identity);
    return !p || !isAgentKind(p.kind);
  });
  const soloCall = !presenterMode && tileIdentities.length === 0;
  const videoGridClass = presenterMode
    ? `${PRESENTER_LAYOUT_CLASS} flex-1 min-w-0`
    : soloCall
      ? SOLO_GRID_LAYOUT_CLASS
      : MULTI_GRID_LAYOUT_CLASS;
  const sidebarTileIdentities = tileIdentities.filter(
    (id) => id !== remotePresenterIdentity,
  );
  const pipThumbIdentities = presenterMode
    ? sidebarTileIdentities.slice(0, 3)
    : tileIdentities.length > 0
      ? tileIdentities.slice(1, 4)
      : [];
  const pipGridMainIdentity =
    !presenterMode && tileIdentities.length > 0 ? tileIdentities[0]! : null;

  const localLabelSuffix = useMemo(() => {
    const parts: string[] = [];
    if (joinConfig.blurEnabled && !isScreenSharing) parts.push(" · blur on");
    if (noiseCancellationOn) parts.push(" · noise cancellation on");
    if (isScreenSharing) parts.push(" · presenting");
    return parts.length > 0 ? parts.join("") : undefined;
  }, [joinConfig.blurEnabled, isScreenSharing, noiseCancellationOn]);

  const localSidebarSuffix = useMemo(() => {
    const parts: string[] = [];
    if (joinConfig.blurEnabled) parts.push(" · blur on");
    if (noiseCancellationOn) parts.push(" · noise cancellation on");
    return parts.length > 0 ? parts.join("") : undefined;
  }, [joinConfig.blurEnabled, noiseCancellationOn]);

  const controlBtnClass = isPip
    ? "cursor-pointer size-8 rounded-full flex items-center justify-center disabled:opacity-30"
    : "cursor-pointer size-9 sm:size-11 md:size-12 rounded-full flex items-center justify-center disabled:opacity-30";

  const showAiAssistant =
    agentInRoom || Boolean(call.livekit_agent_dispatch_id);
  const reconnecting =
    connectionState === ConnectionState.Reconnecting ||
    connectionState === ConnectionState.SignalReconnecting;

  const inCallQuickActions = useMemo(
    () => [
      {
        id: "new-task",
        label: "Task",
        icon: "add_task",
        onClick: () => {
          setQuickActionsOpen(false);
          openModal("new-task", {
            initialProjectId: selectedProjectId ?? undefined,
          });
        },
      },
      {
        id: "new-pr",
        label: "PR",
        icon: "merge_type",
        onClick: () => {
          setQuickActionsOpen(false);
          if (!selectedWorkspaceId) {
            addToast("Select a workspace first.", "warning");
            return;
          }
          const params = new URLSearchParams();
          if (selectedProjectId) params.set("projectId", selectedProjectId);
          params.set("quickPr", "1");
          router.push(`/version-control?${params.toString()}`);
        },
      },
      {
        id: "new-message",
        label: "Message",
        icon: "chat_bubble",
        onClick: () => {
          setQuickActionsOpen(false);
          openModal("new-message");
        },
      },
      {
        id: "compose",
        label: "Email",
        icon: "edit_square",
        onClick: () => {
          setQuickActionsOpen(false);
          router.push("/email/compose");
        },
      },
    ],
    [selectedProjectId, selectedWorkspaceId, openModal, addToast, router],
  );

  return (
    <div
      className={
        isPip
          ? "relative flex flex-col min-h-0 max-h-full bg-background-dark"
          : "relative flex flex-col h-full bg-background-dark"
      }
    >
      {!isPip ? (
        <header className="px-3 sm:px-6 py-3 border-b border-border-dark flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="font-bold text-white">{call.title}</h1>
            <p className="text-xs text-text-secondary flex flex-wrap items-center gap-2">
              {call.recording_enabled && (
                <span className="text-red-400 flex items-center gap-1">
                  <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                  Recording
                </span>
              )}
              {showAiAssistant && (
                <span className="text-cyan-400">AI assistant active</span>
              )}
              {reconnecting && (
                <span className="text-amber-400">Reconnecting…</span>
              )}
              {joinConfig.blurEnabled && (
                <span className="text-violet-400 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    blur_on
                  </span>
                  Blur on
                </span>
              )}
              {noiseCancellationOn && (
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">
                    noise_aware
                  </span>
                  Noise cancellation on
                </span>
              )}
            </p>
            {raisedUserIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-amber-300/90 shrink-0">
                  Raised hands:
                </span>
                {raisedUserIds.map((uid) => (
                  <span
                    key={uid}
                    className="text-xs bg-amber-500/15 text-amber-200 px-2 py-0.5 rounded-full"
                  >
                    {nameForUserId(uid)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleAppSidebar ? (
              <button
                type="button"
                onClick={onToggleAppSidebar}
                className="size-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-white/10 hover:text-white"
                title={isAppSidebarOpen ? "Hide sidebar" : "Show sidebar"}
                aria-label={isAppSidebarOpen ? "Hide sidebar" : "Show sidebar"}
                aria-expanded={isAppSidebarOpen ?? false}
              >
                <span className="material-symbols-outlined text-[22px]">
                  {isAppSidebarOpen ? "menu_open" : "menu"}
                </span>
              </button>
            ) : null}
            {onToggleMeetingFullscreen ? (
              <button
                type="button"
                onClick={onToggleMeetingFullscreen}
                className="size-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-white/10 hover:text-white"
                title="Fullscreen meeting"
              >
                <span className="material-symbols-outlined text-[22px]">
                  fullscreen
                </span>
              </button>
            ) : null}
            {onMinimize ? (
              <button
                type="button"
                onClick={onMinimize}
                className="size-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-white/10 hover:text-white"
                title="Minimize call"
              >
                <span className="material-symbols-outlined text-[22px]">
                  picture_in_picture_alt
                </span>
              </button>
            ) : null}
            {call.pending_review_count ? (
              <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded shrink-0">
                {call.pending_review_count} tasks pending review
              </span>
            ) : null}
          </div>
        </header>
      ) : null}

      {isPip && call.recording_enabled && status === "joined" ? (
        <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] text-red-400 shrink-0">
          <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording
        </div>
      ) : null}

      {status === "joining" && (
        <div className="flex-1 flex items-center justify-center gap-3 text-text-secondary">
          <span className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Joining call…
        </div>
      )}

      {status === "error" && error && (
        <div className="mx-6 mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300 space-y-3">
          <p>{error}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStatus("joining");
                joinAttemptedRef.current = false;
                void joinRoom();
              }}
              className="cursor-pointer px-3 py-1.5 rounded-lg bg-red-500/20 text-red-200 text-xs font-medium"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => router.push(`/calls/${callId}`)}
              className="cursor-pointer px-3 py-1.5 rounded-lg bg-white/10 text-text-secondary text-xs"
            >
              Back to call
            </button>
          </div>
        </div>
      )}

      {status === "joined" && isPip && (
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="relative bg-surface-dark aspect-video max-h-[280px] shrink-0 overflow-hidden">
            {viewingRemotePresenter ? (
              <div
                ref={remotePresenterContainerRef}
                className="absolute inset-0"
              >
                <div
                  ref={bindPresenterVideoRef}
                  className={VIDEO_PLAY_LAYER_CLASS}
                />
                <VideoParticipantLabel
                  size="pipMain"
                  name={labelForIdentity(remotePresenterIdentity!)}
                  muted={isRemoteMicMuted(remotePresenterIdentity!)}
                  suffix=" · presenting"
                />
              </div>
            ) : pipGridMainIdentity != null ? (
              <div className="absolute inset-0">
                <RemoteVideoTile
                  identity={pipGridMainIdentity}
                  remoteVideosRef={remoteVideosRef}
                  onTileMount={onRemoteTileMount}
                  className="absolute inset-0 w-full h-full [&>video]:object-cover"
                />
                <VideoParticipantLabel
                  size="pipMain"
                  name={labelForIdentity(pipGridMainIdentity)}
                  muted={isRemoteMicMuted(pipGridMainIdentity)}
                />
              </div>
            ) : (
              <div ref={screenShareContainerRef} className="absolute inset-0">
                <div
                  ref={bindLocalVideoRef}
                  className={
                    isScreenSharing
                      ? VIDEO_PLAY_LAYER_CLASS
                      : "w-full h-full [&>video]:object-cover"
                  }
                />
                <VideoParticipantLabel
                  size="pipMain"
                  name={localDisplayName}
                  muted={!micOn}
                  suffix={isScreenSharing ? " · presenting" : undefined}
                />
              </div>
            )}
          </div>
          {(presenterMode && viewingRemotePresenter) ||
          pipGridMainIdentity != null ||
          pipThumbIdentities.length > 0 ? (
            <div className="flex gap-1.5 px-2 py-2 overflow-x-auto shrink-0">
              {pipGridMainIdentity != null && (
                <div className="relative w-20 aspect-video bg-surface-dark rounded-lg overflow-hidden shrink-0">
                  <div
                    ref={bindLocalVideoRef}
                    className="w-full h-full [&>video]:object-cover"
                  />
                  <VideoParticipantLabel
                    size="pip"
                    name={localDisplayName}
                    muted={!micOn}
                  />
                </div>
              )}
              {presenterMode && viewingRemotePresenter && (
                <div className="relative w-20 aspect-video bg-surface-dark rounded-lg overflow-hidden shrink-0">
                  <div
                    ref={bindLocalVideoRef}
                    className="w-full h-full [&>video]:object-cover"
                  />
                  <VideoParticipantLabel
                    size="pip"
                    name={localDisplayName}
                    muted={!micOn}
                  />
                </div>
              )}
              {pipThumbIdentities.map((identity) => (
                <div
                  key={identity}
                  className="relative w-20 aspect-video bg-surface-dark rounded-lg overflow-hidden shrink-0"
                >
                  <RemoteVideoTile
                    identity={identity}
                    remoteVideosRef={remoteVideosRef}
                    onTileMount={onRemoteTileMount}
                    className="absolute inset-0 w-full h-full [&>video]:object-cover"
                  />
                  <VideoParticipantLabel
                    size="pip"
                    name={labelForIdentity(identity)}
                    muted={isRemoteMicMuted(identity)}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {status === "joined" && !isPip && (
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          {currentUser?.id ? (
            <div className="absolute left-0 top-0 bottom-0 z-30 h-full max-h-full overflow-hidden pointer-events-none [&_aside]:pointer-events-auto [&_aside]:h-full">
              <CallMeetingNotesSidebar
                ref={meetingNotesRef}
                callId={callId}
                currentUserId={currentUser.id}
                memberNameById={memberNameById}
                realtimeConnected={callRealtimeConnected}
                defaultCollapsed
              />
            </div>
          ) : null}
          <div className={videoGridClass}>
            {viewingRemotePresenter ? (
              <div
                ref={remotePresenterContainerRef}
                className={PRESENTER_STAGE_CLASS}
              >
                <div
                  ref={bindPresenterVideoRef}
                  className={VIDEO_PLAY_LAYER_CLASS}
                />
                <VideoParticipantLabel
                  name={labelForIdentity(remotePresenterIdentity!)}
                  muted={isRemoteMicMuted(remotePresenterIdentity!)}
                  suffix=" · presenting"
                />
                <button
                  type="button"
                  onClick={handleFullscreen}
                  className="cursor-pointer absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-lg bg-black/50 text-white hover:bg-black/70"
                  title="Fullscreen"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    fullscreen
                  </span>
                </button>
              </div>
            ) : (
              <div
                ref={screenShareContainerRef}
                className={
                  isScreenSharing
                    ? PRESENTER_STAGE_CLASS
                    : soloCall
                      ? `${VIDEO_TILE_CLASS} col-span-full`
                      : VIDEO_TILE_CLASS
                }
              >
                <div
                  ref={bindLocalVideoRef}
                  className={
                    isScreenSharing
                      ? VIDEO_PLAY_LAYER_CLASS
                      : "w-full h-full [&>video]:object-cover"
                  }
                />
                <VideoParticipantLabel
                  name={localDisplayName}
                  muted={!micOn}
                  suffix={localLabelSuffix}
                />
                {soloCall && showAiAssistant ? (
                  <div
                    className={`${VIDEO_TILE_CLASS} absolute bottom-3 right-3 z-10 w-36 sm:w-44 aspect-video shadow-lg border border-cyan-500/30 flex items-center justify-center`}
                  >
                    <span className="material-symbols-outlined text-3xl text-cyan-400">
                      smart_toy
                    </span>
                    <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-cyan-500/20 text-cyan-200 px-1.5 py-0.5 rounded">
                      OneWork Assistant
                    </span>
                  </div>
                ) : null}
                {isScreenSharing && (
                  <button
                    type="button"
                    onClick={handleFullscreen}
                    className="absolute top-2 right-2 size-8 rounded-lg bg-black/50 flex items-center justify-center text-white hover:bg-black/70"
                    title="Fullscreen"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      fullscreen
                    </span>
                  </button>
                )}
              </div>
            )}

            {presenterMode ? (
              <div className={PRESENTER_SIDEBAR_CLASS}>
                {viewingRemotePresenter && (
                  <div className={SIDEBAR_TILE_CLASS}>
                    <div
                      ref={bindLocalVideoRef}
                      className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover"
                    />
                    <VideoParticipantLabel
                      name={localDisplayName}
                      muted={!micOn}
                      suffix={localSidebarSuffix}
                    />
                  </div>
                )}
                {showAiAssistant && (
                  <div
                    className={`${SIDEBAR_TILE_CLASS} flex items-center justify-center border border-cyan-500/30`}
                  >
                    <span className="material-symbols-outlined text-3xl text-cyan-400">
                      smart_toy
                    </span>
                    <span className="absolute bottom-2 left-2 text-xs bg-cyan-500/20 text-cyan-200 px-2 py-0.5 rounded">
                      OneWork Assistant
                    </span>
                  </div>
                )}
                {sidebarTileIdentities.map((identity) => (
                  <div key={identity} className={SIDEBAR_TILE_CLASS}>
                    <RemoteVideoTile
                      identity={identity}
                      remoteVideosRef={remoteVideosRef}
                      onTileMount={onRemoteTileMount}
                      className="absolute inset-0 w-full h-full [&>video]:object-cover"
                    />
                    <VideoParticipantLabel
                      name={labelForIdentity(identity)}
                      muted={isRemoteMicMuted(identity)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {showAiAssistant && !soloCall ? (
                  <div
                    className={`${VIDEO_TILE_CLASS} flex items-center justify-center border border-cyan-500/30`}
                  >
                    <span className="material-symbols-outlined text-5xl text-cyan-400">
                      smart_toy
                    </span>
                    <span className="absolute bottom-2 left-2 text-xs bg-cyan-500/20 text-cyan-200 px-2 py-0.5 rounded">
                      OneWork Assistant
                    </span>
                  </div>
                ) : null}
                {tileIdentities.map((identity) => (
                  <div key={identity} className={VIDEO_TILE_CLASS}>
                    <RemoteVideoTile
                      identity={identity}
                      remoteVideosRef={remoteVideosRef}
                      onTileMount={onRemoteTileMount}
                      className="w-full h-full"
                    />
                    <VideoParticipantLabel
                      name={labelForIdentity(identity)}
                      muted={isRemoteMicMuted(identity)}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
          {rateLimitBanner ? (
            <p className="absolute top-2 left-1/2 -translate-x-1/2 z-50 text-xs bg-amber-900/90 text-amber-100 px-3 py-1.5 rounded-lg border border-amber-600/40 max-w-md text-center">
              {rateLimitBanner}
            </p>
          ) : null}
          <div className="absolute right-0 top-0 bottom-0 z-30 h-full max-h-full overflow-hidden pointer-events-none [&_aside]:pointer-events-auto [&_aside]:h-full">
            <CallAiSidebarHost
              ref={aiSidebarHostRef}
              callId={callId}
              aiEnabled={call.ai_enabled}
              agentInRoom={agentInRoom}
              callStatus={call.status}
              defaultCollapsed
              localSession={localSession}
              live={livePayload}
              liveLoaded={liveLoaded}
              loadError={liveLoadError}
              liveAiError={liveAiError}
              liveDataControlled
              onRefreshLive={refreshLive}
              realtimeConnected={callRealtimeConnected}
            />
          </div>
        </div>
      )}

      {status === "joined" && !isPip ? (
        <div
          ref={quickActionsRef}
          className="pointer-events-none absolute bottom-24 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-28 sm:right-6"
        >
          {quickActionsOpen && (
            <div
              data-call-quick-actions-menu
              className="pointer-events-auto flex flex-col items-end gap-2"
            >
              {inCallQuickActions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className="group flex cursor-pointer items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <span className={CALL_QUICK_LABEL_CLASS}>{action.label}</span>
                  <span className={CALL_QUICK_ICON_CLASS}>
                    <span className="material-symbols-outlined text-[20px]">
                      {action.icon}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            data-call-quick-fab
            onClick={() => setQuickActionsOpen((open) => !open)}
            aria-expanded={quickActionsOpen}
            aria-haspopup="true"
            aria-label={quickActionsOpen ? "Close add menu" : "Open add menu"}
            className={CALL_QUICK_FAB_CLASS}
            title="Add"
          >
            <span className="material-symbols-outlined text-[28px]">
              {quickActionsOpen ? "close" : "add"}
            </span>
          </button>
        </div>
      ) : null}

      {status === "joined" && audioPlaybackBlocked ? (
        <div className="px-3 sm:px-6 py-2 border-t border-amber-500/30 bg-amber-500/10 flex items-center justify-center gap-3 shrink-0">
          <p className="text-xs sm:text-sm text-amber-100">
            Remote audio is paused. Click to hear other participants.
          </p>
          <button
            type="button"
            onClick={() => void enableRemoteAudioPlayback()}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-amber-400"
          >
            Enable audio
          </button>
        </div>
      ) : null}

      <footer
        className={
          isPip
            ? "px-2 py-2 border-t border-border-dark flex flex-wrap items-center justify-center gap-1 shrink-0 relative"
            : "px-3 sm:px-6 py-3 sm:py-4 border-t border-border-dark flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 md:gap-3 shrink-0 relative"
        }
      >
        {isPip && onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            disabled={status !== "joined"}
            className={`${controlBtnClass} bg-white/10`}
            title="Expand call"
          >
            <span className="material-symbols-outlined text-[18px]">
              open_in_full
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={status !== "joined"}
          className={`${controlBtnClass} ${micOn ? "bg-white/10" : "bg-red-500/20 text-red-400"}`}
          title="Mute (M)"
        >
          <span className="material-symbols-outlined">
            {micOn ? "mic" : "mic_off"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void toggleCam()}
          disabled={status !== "joined" || isScreenSharing}
          className={`${controlBtnClass} ${camOn ? "bg-white/10" : "bg-red-500/20 text-red-400"}`}
          title={
            isScreenSharing
              ? "Camera (stop screen share first)"
              : "Camera (V)"
          }
        >
          <span className="material-symbols-outlined text-[18px]">
            {camOn ? "videocam" : "videocam_off"}
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            isScreenSharing ? void stopScreenShare() : void startScreenShare()
          }
          disabled={status !== "joined" || screenBusy}
          className={`${controlBtnClass} ${isScreenSharing ? "bg-emerald-600 text-white" : "bg-white/10"}`}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isScreenSharing ? "cancel_presentation" : "present_to_all"}
          </span>
        </button>
        {!isPip ? (
          <button
            type="button"
            onClick={() => void toggleNoiseCancellation()}
            disabled={status !== "joined" || deviceBusy}
            className={`${controlBtnClass} ${noiseCancellationOn ? "bg-emerald-600 text-white" : "bg-white/10"}`}
            title="Noise cancellation"
          >
            <span className="material-symbols-outlined">noise_aware</span>
          </button>
        ) : null}
        {!isPip ? (
          <div className="relative" ref={devicesPopoverRef}>
            <button
              type="button"
              onClick={() => setDevicesOpen((o) => !o)}
              disabled={status !== "joined"}
              className={`${controlBtnClass} bg-white/10`}
              title="Audio & video devices"
            >
              <span className="material-symbols-outlined">settings_voice</span>
            </button>
            {devicesOpen && status === "joined" ? (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[85vw] rounded-xl border border-border-dark bg-surface-dark p-3 shadow-xl z-20">
                <p className="text-xs text-text-secondary mb-2">
                  Audio &amp; video devices
                </p>
                <label className="block text-xs text-text-secondary mb-1">
                  Microphone
                </label>
                <select
                  value={selectedMicDevice}
                  disabled={deviceBusy}
                  onChange={(e) => void applyMicDevice(e.target.value)}
                  className="w-full mb-3 px-2 py-1.5 rounded-lg bg-background-dark border border-border-dark text-white text-xs"
                >
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {supportsAudioOutputSelection() ? (
                  <>
                    <label className="block text-xs text-text-secondary mb-1">
                      Speaker
                    </label>
                    <select
                      value={selectedSpeakerDevice}
                      disabled={deviceBusy}
                      onChange={(e) => void applySpeakerDevice(e.target.value)}
                      className="w-full mb-3 px-2 py-1.5 rounded-lg bg-background-dark border border-border-dark text-white text-xs"
                    >
                      {speakers.map((speaker) => (
                        <option key={speaker.deviceId} value={speaker.deviceId}>
                          {speaker.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <p className="text-[11px] text-text-secondary mb-3">
                    Speaker selection is not supported in this browser. Remote
                    audio uses the system default output.
                  </p>
                )}
                <label className="block text-xs text-text-secondary mb-1">
                  Camera
                </label>
                <select
                  value={selectedCamDevice}
                  disabled={deviceBusy || isScreenSharing}
                  onChange={(e) => void applyCamDevice(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-background-dark border border-border-dark text-white text-xs"
                >
                  {cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
        {!isPip ? (
          <button
            type="button"
            onClick={() => void toggleRaiseHand()}
            disabled={status !== "joined" || !currentUser?.id}
            className={`${controlBtnClass} ${myHandRaised ? "bg-amber-500/30 text-amber-200" : "bg-white/10"}`}
            title={myHandRaised ? "Lower hand" : "Raise hand"}
          >
            <span className="material-symbols-outlined">back_hand</span>
          </button>
        ) : null}
        {!isPip && isHost ? (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            disabled={status !== "joined"}
            className={`${controlBtnClass} bg-white/10`}
            title="Invite people"
          >
            <span className="material-symbols-outlined">person_add</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={leaveCall}
          disabled={ending}
          className={
            isPip
              ? "cursor-pointer px-2 h-8 rounded-full bg-white/10 text-[10px] font-medium disabled:opacity-50"
              : "cursor-pointer px-2 sm:px-4 h-9 sm:h-11 md:h-12 rounded-full bg-white/10 text-xs sm:text-sm font-medium disabled:opacity-50"
          }
        >
          {isHost ? "Leave" : "Leave call"}
        </button>
        {isHost ? (
          <button
            type="button"
            onClick={endCall}
            disabled={ending}
            className={
              isPip
                ? "cursor-pointer px-2 h-8 rounded-full bg-red-600 text-white text-[10px] font-bold disabled:opacity-50"
                : "cursor-pointer px-2 sm:px-4 h-9 sm:h-11 md:h-12 rounded-full bg-red-600 text-white text-xs sm:text-sm font-bold disabled:opacity-50"
            }
          >
            {ending ? "Ending…" : "End call"}
          </button>
        ) : null}
      </footer>

      {inviteOpen && !isPip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-dark border border-border-dark rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-2">Invite to call</h2>
            <p className="text-xs text-text-secondary mb-3">
              Choose workspace members who are not already in this meeting.
            </p>
            <div className="max-h-56 overflow-y-auto space-y-1 mb-4">
              {workspaceMembers.filter(
                (m) =>
                  m.isMember &&
                  m.id &&
                  m.id !== currentUser?.id &&
                  !call.participants.some(
                    (p) => p.user_id === m.id && !p.left_at,
                  ),
              ).length === 0 ? (
                <p className="text-xs text-text-secondary px-2">
                  No additional members to invite.
                </p>
              ) : (
                workspaceMembers
                  .filter(
                    (m) =>
                      m.isMember &&
                      m.id &&
                      m.id !== currentUser?.id &&
                      !call.participants.some(
                        (p) => p.user_id === m.id && !p.left_at,
                      ),
                  )
                  .map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={inviteSelected.includes(m.id)}
                        onChange={() => toggleInviteMember(m.id)}
                      />
                      <span className="text-sm text-white">{m.name}</span>
                    </label>
                  ))
              )}
            </div>
            {inviteError ? (
              <p className="text-sm text-red-400 mb-3">{inviteError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="cursor-pointer px-4 py-2 text-sm text-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inviteLoading || inviteSelected.length === 0}
                onClick={() => void submitInvite()}
                className="cursor-pointer px-4 py-2 text-sm font-bold bg-primary text-white rounded-lg disabled:opacity-50"
              >
                {inviteLoading ? "Sending…" : "Send invites"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
