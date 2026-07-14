"use client";

import type { LocalAudioTrack } from "livekit-client";
import type { KrispNoiseFilterProcessor } from "@livekit/krisp-noise-filter";
import type { DenoiseTrackProcessor } from "livekit-rnnoise-processor";
import { ENHANCED_NOISE_CAPTURE_SAMPLE_RATE } from "@/lib/calls/microphoneAudioConfig";

export type EnhancedNoiseProcessor =
  | KrispNoiseFilterProcessor
  | DenoiseTrackProcessor;

export function isLowPowerDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4;
}

/** Krisp NC requires LiveKit Cloud auth; skip on self-hosted SFU. */
function isLikelyLiveKitCloud(): boolean {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim() ?? "";
  return url.includes("livekit.cloud");
}

async function resumeAudioContext(ctx: AudioContext): Promise<AudioContext> {
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }
  return ctx;
}

/** setProcessor requires an AudioContext on the track (LiveKit SDK). */
async function ensureKrispAudioContext(track: LocalAudioTrack): Promise<void> {
  const ctx = await resumeAudioContext(
    new AudioContext({ latencyHint: "interactive" }),
  );
  track.setAudioContext(ctx);
}

async function tryAttachKrisp(
  track: LocalAudioTrack,
  enabled: boolean,
): Promise<KrispNoiseFilterProcessor | null> {
  if (!isLikelyLiveKitCloud()) return null;

  const { isKrispNoiseFilterSupported, KrispNoiseFilter } = await import(
    "@livekit/krisp-noise-filter"
  );
  if (!isKrispNoiseFilterSupported()) return null;

  const processor = KrispNoiseFilter({
    quality: isLowPowerDevice() ? "low" : "medium",
    bufferOverflowMs: 100,
    bufferDropMs: 200,
  });

  await ensureKrispAudioContext(track);
  await track.setProcessor(processor);
  await processor.setEnabled(enabled);
  return processor;
}

/** RNNoise expects 48 kHz; mismatch with AudioContext causes slow/robotic audio. */
async function ensureRnnoiseAudioContext(
  track: LocalAudioTrack,
): Promise<AudioContext> {
  // Always use a dedicated 48 kHz context — never reuse the Room's shared
  // AudioContext (often 44.1 kHz), which causes slow-motion / demon voice.
  const dedicated = await resumeAudioContext(
    new AudioContext({
      sampleRate: ENHANCED_NOISE_CAPTURE_SAMPLE_RATE,
      latencyHint: "interactive",
    }),
  );
  track.setAudioContext(dedicated);
  return dedicated;
}

/** Match capture constraints to the processor AudioContext (Krisp-style). */
async function alignCaptureTrackForRnnoise(
  track: LocalAudioTrack,
  sampleRate: number,
): Promise<void> {
  try {
    await track.mediaStreamTrack.applyConstraints({
      sampleRate,
      noiseSuppression: false,
    });
  } catch {
    /* device may ignore sampleRate — worklet resamplers still run */
  }
}

async function attachRnnoiseToAudioTrack(
  track: LocalAudioTrack,
  enabled: boolean,
): Promise<DenoiseTrackProcessor | null> {
  const { DenoiseTrackProcessor } = await import("livekit-rnnoise-processor");
  if (!DenoiseTrackProcessor.isSupported()) return null;

  const ctx = await ensureRnnoiseAudioContext(track);
  await alignCaptureTrackForRnnoise(track, ctx.sampleRate);

  const processor = new DenoiseTrackProcessor();
  await track.setProcessor(processor);
  await processor.setEnabled(enabled);
  return processor;
}

/** Krisp on LiveKit Cloud; RNNoise WASM fallback for self-hosted SFU. */
export async function attachEnhancedNoiseToAudioTrack(
  track: LocalAudioTrack,
  enabled: boolean,
): Promise<EnhancedNoiseProcessor | null> {
  try {
    const krisp = await tryAttachKrisp(track, enabled);
    if (krisp) return krisp;
  } catch {
    /* fall through to RNNoise */
  }

  try {
    return await attachRnnoiseToAudioTrack(track, enabled);
  } catch {
    return null;
  }
}

export async function willUseEnhancedNoiseFilter(
  noiseCancellationEnabled: boolean,
): Promise<boolean> {
  if (!noiseCancellationEnabled) return false;
  return isEnhancedNoiseCancellationSupported();
}

export async function isEnhancedNoiseCancellationSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isLikelyLiveKitCloud()) {
    try {
      const { isKrispNoiseFilterSupported } = await import(
        "@livekit/krisp-noise-filter"
      );
      if (isKrispNoiseFilterSupported()) return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const { DenoiseTrackProcessor } = await import("livekit-rnnoise-processor");
    return DenoiseTrackProcessor.isSupported();
  } catch {
    return false;
  }
}

export async function setNoiseFilterEnabled(
  processor: EnhancedNoiseProcessor,
  enabled: boolean,
): Promise<void> {
  await processor.setEnabled(enabled);
}

export async function disposeNoiseFilter(
  processor: EnhancedNoiseProcessor | null,
): Promise<void> {
  if (!processor) return;
  try {
    await processor.destroy();
  } catch {
    /* best effort */
  }
}
