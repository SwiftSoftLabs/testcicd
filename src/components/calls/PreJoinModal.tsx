"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  readNoiseCancellationFromStorage,
  writeNoiseCancellationToStorage,
} from "@/lib/calls/microphoneAudioConfig";
import type {
  CallParticipantRow,
  CallSessionDetail,
  CallSyncPayload,
} from "@/types/calls";
import { useCallRealtime } from "@/hooks/useCallRealtime";
import {
  createBackgroundBlurProcessor,
  preloadImageSegmenter,
  type BackgroundBlurProcessor,
} from "@/lib/calls/backgroundBlur/createBackgroundBlurProcessor";
import {
  createMicLevelMonitor,
  type MicLevelMonitor,
} from "@/lib/calls/micLevelMonitor";
import { acquirePreviewStream } from "@/lib/calls/previewMediaStream";

export interface JoinConfig {
  videoDeviceId?: string;
  audioDeviceId?: string;
  blurEnabled: boolean;
  noiseCancellationEnabled: boolean;
}

interface PreJoinModalProps {
  call: CallSessionDetail;
  onJoin: (config: JoinConfig) => void;
  onCancel: () => void;
}

interface DeviceInfo {
  deviceId: string;
  label: string;
}

function avatarForParticipant(p: CallParticipantRow): string {
  if (p.avatar_url) return p.avatar_url;
  const name = p.display_name || "User";
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
}

export function PreJoinModal({
  call: initialCall,
  onJoin,
  onCancel,
}: PreJoinModalProps) {
  const [call, setCall] = useState(initialCall);
  const videoRef = useRef<HTMLVideoElement>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement>(null);
  const blurProcessorRef = useRef<BackgroundBlurProcessor | null>(null);
  const blurProcessorGenRef = useRef(0);
  const previewStreamRef = useRef<MediaStream | null>(null);
  /** Bumps when preview stops so in-flight `getUserMedia` from an older start discards its stream. */
  const previewGenerationRef = useRef(0);
  const micLevelBarRef = useRef<HTMLDivElement>(null);
  const micMonitorRef = useRef<MicLevelMonitor | null>(null);

  const [cameras, setCameras] = useState<DeviceInfo[]>([]);
  const [mics, setMics] = useState<DeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [blurLoading, setBlurLoading] = useState(false);
  /** Bumped when preview stream is ready so blur can attach to the video track. */
  const [previewVersion, setPreviewVersion] = useState(0);
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(true);
  const [videoPreviewUnavailable, setVideoPreviewUnavailable] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let defaultEnabled = true;
      try {
        const { settings } = await api.workspaces.getCallSettings(
          call.workspace_id,
        );
        const s = settings as Record<string, unknown>;
        if (typeof s.call_noise_cancellation_default === "boolean") {
          defaultEnabled = s.call_noise_cancellation_default;
        }
      } catch {
        /* workspace default stays true */
      }
      const stored = readNoiseCancellationFromStorage();
      if (!cancelled) {
        setNoiseCancellationEnabled(stored ?? defaultEnabled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call.workspace_id]);

  const stopBlurProcessor = useCallback(() => {
    blurProcessorRef.current?.cleanup();
    blurProcessorRef.current = null;
    setBlurLoading(false);
  }, []);

  const assignStreamToVideo = useCallback((stream: MediaStream) => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, []);

  const stopPreview = useCallback(() => {
    previewGenerationRef.current += 1;
    stopBlurProcessor();
    micMonitorRef.current?.stop();
    micMonitorRef.current = null;
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopBlurProcessor]);

  const resumeMicMonitor = useCallback(() => {
    void micMonitorRef.current?.resume();
  }, []);

  const startPreview = useCallback(
    async (cameraId?: string, micId?: string) => {
      stopPreview();
      const myGeneration = previewGenerationRef.current;
      setPermError(null);
      setVideoPreviewUnavailable(false);
      try {
        const { stream, videoUnavailable } = await acquirePreviewStream(
          cameraId,
          micId,
        );
        if (myGeneration !== previewGenerationRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        setVideoPreviewUnavailable(videoUnavailable);
        if (!videoUnavailable) {
          assignStreamToVideo(stream);
        }
        setPreviewVersion((v) => v + 1);

        micMonitorRef.current?.stop();
        micMonitorRef.current = createMicLevelMonitor(stream, () =>
          micLevelBarRef.current,
        );
        void micMonitorRef.current.resume();

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          }));
        const micsArr = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${i + 1}`,
          }));
        setCameras(cams);
        setMics(micsArr);

        if (cameraId) {
          setSelectedCamera(cameraId);
        } else if (cams[0]) {
          setSelectedCamera(cams[0].deviceId);
        }
        if (micId) {
          setSelectedMic(micId);
        } else if (micsArr[0]) {
          setSelectedMic(micsArr[0].deviceId);
        }
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "Could not access camera/mic";
        if (msg.includes("Permission") || msg.includes("NotAllowed")) {
          setPermError(
            "Camera or microphone access was denied. Allow access in your browser settings.",
          );
        } else {
          setPermError(msg);
        }
      }
    },
    [stopPreview, assignStreamToVideo],
  );

  useEffect(() => {
    if (!blurEnabled) {
      stopBlurProcessor();
      return;
    }

    const stream = previewStreamRef.current;
    const canvas = blurCanvasRef.current;
    const videoTrack = stream?.getVideoTracks()[0];
    if (!videoTrack || !canvas) return;

    const gen = ++blurProcessorGenRef.current;
    setBlurLoading(true);

    void (async () => {
      try {
        await preloadImageSegmenter();
        if (gen !== blurProcessorGenRef.current) return;
        const processor = await createBackgroundBlurProcessor(videoTrack, {
          displayCanvas: canvas,
        });
        if (gen !== blurProcessorGenRef.current) {
          processor.cleanup();
          return;
        }
        blurProcessorRef.current = processor;
      } catch {
        /* blur stays off; user can retry toggle */
      } finally {
        if (gen === blurProcessorGenRef.current) {
          setBlurLoading(false);
        }
      }
    })();

    return () => {
      if (gen === blurProcessorGenRef.current) {
        stopBlurProcessor();
        blurProcessorGenRef.current += 1;
      }
    };
  }, [blurEnabled, selectedCamera, previewVersion, stopBlurProcessor]);

  useEffect(() => {
    if (videoPreviewUnavailable) {
      setBlurEnabled(false);
    }
  }, [videoPreviewUnavailable]);

  useEffect(() => {
    void startPreview();
    return stopPreview;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCall(initialCall);
  }, [initialCall]);

  const applySync = useCallback((sync: CallSyncPayload) => {
    setCall((prev) => ({
      ...prev,
      status: sync.status,
      metadata: sync.metadata,
      ai_enabled: sync.ai_enabled,
      participants: sync.participants,
    }));
  }, []);

  const refreshSync = useCallback(() => {
    void api.calls
      .sync(initialCall.id)
      .then(applySync)
      .catch(() => undefined);
  }, [initialCall.id, applySync]);

  const { connected: preJoinRealtimeConnected } = useCallRealtime(
    initialCall.id,
    { onSyncUpdate: applySync },
  );

  useEffect(() => {
    refreshSync();
    if (preJoinRealtimeConnected) return undefined;
    const interval = setInterval(refreshSync, 15_000);
    return () => clearInterval(interval);
  }, [initialCall.id, refreshSync, preJoinRealtimeConnected]);

  const inCall = call.participants.filter((p) => p.joined_at && !p.left_at);
  const invited = call.participants.filter((p) => !p.joined_at);

  const handleCameraChange = (deviceId: string) => {
    setSelectedCamera(deviceId);
    void startPreview(deviceId, selectedMic || undefined);
  };

  const handleMicChange = (deviceId: string) => {
    setSelectedMic(deviceId);
    void startPreview(selectedCamera || undefined, deviceId);
  };

  const handleJoin = () => {
    stopPreview();
    onJoin({
      videoDeviceId: selectedCamera || undefined,
      audioDeviceId: selectedMic || undefined,
      blurEnabled,
      noiseCancellationEnabled,
    });
  };

  const handleCancel = () => {
    stopPreview();
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="bg-surface-dark border border-border-dark rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90dvh]"
        onPointerDown={resumeMicMonitor}
      >
        <div className="px-6 pt-5 pb-3 border-b border-border-dark shrink-0">
          <h2 className="text-lg font-bold text-white">Ready to join?</h2>
          <p className="text-sm text-text-secondary mt-0.5">{call.title}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-0 overflow-y-auto min-h-0">
          <div className="md:w-1/2 p-4 flex flex-col gap-3 shrink-0">
            <div className="relative isolate bg-black rounded-xl overflow-hidden aspect-video max-h-44 sm:max-h-none">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={
                  blurEnabled
                    ? "sr-only"
                    : "w-full h-full object-cover"
                }
                aria-hidden={blurEnabled}
              />
              {blurEnabled ? (
                <canvas
                  ref={blurCanvasRef}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : null}
              {blurEnabled && blurLoading ? (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/50 pointer-events-none">
                  <span className="size-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-white/90">
                    Loading background blur…
                  </span>
                </div>
              ) : null}
              {blurEnabled && !blurLoading ? (
                <div className="absolute inset-0 z-20 flex items-end p-2 pointer-events-none">
                  <span className="text-xs bg-black/60 text-white px-2 py-0.5 rounded-full">
                    Blur preview
                  </span>
                </div>
              ) : null}
              {videoPreviewUnavailable && !permError && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-3 text-center">
                  <p className="text-xs text-text-secondary">
                    Camera unavailable. You can still test your microphone below.
                  </p>
                </div>
              )}
              {permError && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-3 text-center">
                  <p className="text-xs text-red-300">{permError}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-text-secondary">
                mic
              </span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  ref={micLevelBarRef}
                  className="h-full w-[var(--mic-level,0%)] bg-green-400 rounded-full transition-[width] duration-75"
                />
              </div>
            </div>
          </div>

          <div className="md:w-1/2 p-4 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-border-dark">
            <div>
              <label className="text-xs text-text-secondary block mb-1">
                Camera
              </label>
              <select
                value={selectedCamera}
                onChange={(e) => handleCameraChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-sm text-white"
              >
                {cameras.length === 0 && (
                  <option value="">No camera found</option>
                )}
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-text-secondary block mb-1">
                Microphone
              </label>
              <select
                value={selectedMic}
                onChange={(e) => handleMicChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background-dark border border-border-dark text-sm text-white"
              >
                {mics.length === 0 && (
                  <option value="">No microphone found</option>
                )}
                {mics.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-border-dark pt-3">
              <p className="text-xs font-medium text-text-secondary mb-2">
                In the room ({inCall.length})
              </p>
              {inCall.length === 0 ? (
                <p className="text-xs text-text-secondary">
                  No one has joined yet.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-24 overflow-y-auto">
                  {inCall.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 text-sm text-white"
                    >
                      <img
                        src={avatarForParticipant(p)}
                        alt=""
                        className="size-6 rounded-full object-cover"
                      />
                      <span className="truncate">
                        {p.display_name || "Participant"}
                      </span>
                      <span className="text-[10px] text-green-400 ml-auto shrink-0">
                        Live
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {invited.length > 0 && (
                <>
                  <p className="text-xs font-medium text-text-secondary mt-3 mb-2">
                    Invited ({invited.length})
                  </p>
                  <ul className="space-y-1.5 max-h-20 overflow-y-auto">
                    {invited.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-2 text-sm text-text-secondary"
                      >
                        <img
                          src={avatarForParticipant(p)}
                          alt=""
                          className="size-6 rounded-full object-cover opacity-70"
                        />
                        <span className="truncate">
                          {p.display_name || "Participant"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <label
              className={`flex items-center justify-between select-none ${
                videoPreviewUnavailable
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer"
              }`}
            >
              <div>
                <span className="text-sm text-white font-medium">
                  Blur background
                </span>
                <p className="text-xs text-text-secondary">
                  {videoPreviewUnavailable
                    ? "Requires a working camera preview"
                    : "Blurs the background and keeps you in focus"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={blurEnabled}
                aria-disabled={videoPreviewUnavailable}
                disabled={videoPreviewUnavailable}
                onClick={() => {
                  if (videoPreviewUnavailable) return;
                  setBlurEnabled((v) => !v);
                }}
                className={`cursor-pointer relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  blurEnabled ? "bg-primary" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    blurEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer select-none">
              <div>
                <span className="text-sm text-white font-medium">
                  Noise cancellation
                </span>
                <p className="text-xs text-text-secondary">
                  Reduces background noise from your microphone
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={noiseCancellationEnabled}
                onClick={() => {
                  setNoiseCancellationEnabled((v) => {
                    const next = !v;
                    writeNoiseCancellationToStorage(next);
                    return next;
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  noiseCancellationEnabled ? "bg-primary" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    noiseCancellationEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </label>

            <div className="text-xs text-text-secondary space-y-1 pt-1 border-t border-border-dark">
              {call.recording_enabled && (
                <p>
                  <span className="text-red-400 font-medium">●</span> This
                  meeting will be <span className="text-white">recorded</span>{" "}
                  and transcribed.
                </p>
              )}
              {call.ai_enabled && (
                <p>
                  <span className="text-cyan-400 font-medium">●</span> An{" "}
                  <span className="text-white">AI assistant</span> may join to
                  capture action items.
                </p>
              )}
              <p>Only workspace members can access call artifacts.</p>
            </div>

            <div className="flex gap-2 mt-auto pt-2">
              <button
                type="button"
                onClick={handleCancel}
                className="cursor-pointer flex-1 py-2 rounded-lg text-sm text-text-secondary hover:text-white border border-border-dark"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleJoin}
                className="cursor-pointer flex-1 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-blue-600"
              >
                Join call
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
