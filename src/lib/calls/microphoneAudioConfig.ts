import type {
  AudioCaptureOptions,
  VideoCaptureOptions,
} from "livekit-client";

export const NOISE_CANCELLATION_STORAGE_KEY = "onework-call-noise-cancellation";

/** RNNoise / Krisp processors require 48 kHz PCM end-to-end. */
export const ENHANCED_NOISE_CAPTURE_SAMPLE_RATE = 48000;

/**
 * LiveKit / getUserMedia audio constraints (AEC, AGC, browser noise suppression).
 * When enhanced NC (Krisp/RNNoise) is active, disable browser NS and capture at 48 kHz
 * so the worklet pipeline is not double-processing or resampling at the wrong rate.
 */
export function liveKitAudioCaptureOptions(opts: {
  microphoneId?: string;
  noiseCancellationEnabled: boolean;
  /** Krisp/RNNoise track processor will handle denoising. */
  enhancedNoiseFilterActive?: boolean;
}): AudioCaptureOptions {
  const useEnhanced = opts.enhancedNoiseFilterActive === true;
  const browserNs = useEnhanced ? false : opts.noiseCancellationEnabled;
  return {
    ...(opts.microphoneId ? { deviceId: opts.microphoneId } : {}),
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: browserNs,
    ...(useEnhanced
      ? { sampleRate: ENHANCED_NOISE_CAPTURE_SAMPLE_RATE }
      : {}),
  };
}

export function liveKitVideoCaptureOptions(
  videoDeviceId?: string,
): VideoCaptureOptions {
  return videoDeviceId ? { deviceId: videoDeviceId } : {};
}

export function readNoiseCancellationFromStorage(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(NOISE_CANCELLATION_STORAGE_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

export function writeNoiseCancellationToStorage(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NOISE_CANCELLATION_STORAGE_KEY, String(enabled));
}
