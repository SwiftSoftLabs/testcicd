import {
  MASK_FEATHER_RADIUS_PX,
  MASK_INFERENCE_INTERVAL_MS,
  MASK_TEMPORAL_NEW_WEIGHT,
  OUTPUT_FPS,
} from "@/lib/calls/backgroundBlur/constants";
import { createCanvasBackgroundBlurCompositor } from "@/lib/calls/backgroundBlur/canvasCompositor";
import { copyPersonMaskFromResult } from "@/lib/calls/backgroundBlur/maskUtils";
import {
  blendMaskTemporal,
  featherMaskInPlace,
} from "@/lib/calls/backgroundBlur/maskPostProcess";
import {
  closeImageSegmenter,
  createImageSegmenter,
  preloadImageSegmenter,
} from "@/lib/calls/backgroundBlur/segmenter";
import {
  createWebGLBackgroundBlurCompositor,
  isWebGL2Available,
} from "@/lib/calls/backgroundBlur/webglCompositor";

export type BackgroundBlurProcessor = {
  getMediaStreamTrack: () => MediaStreamTrack;
  /** Resolves after the compositor draws at least one frame (safe to publish). */
  waitForFirstFrame: (timeoutMs?: number) => Promise<boolean>;
  /** Reattach camera after setEnabled / setDevice without creating a new segmenter. */
  reconnectSource: (sourceMST: MediaStreamTrack) => Promise<void>;
  cleanup: () => void;
};

export type CreateBackgroundBlurProcessorOptions = {
  /** Canvas shown in UI (e.g. pre-join preview). Uses an internal canvas when omitted. */
  displayCanvas?: HTMLCanvasElement | null;
};

async function waitForVideoReady(
  video: HTMLVideoElement,
  timeoutMs = 4000,
): Promise<void> {
  const hasFrames = () =>
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;

  if (hasFrames()) return;

  await video.play().catch(() => undefined);

  await new Promise<void>((resolve) => {
    const deadline = performance.now() + timeoutMs;
    const tick = () => {
      if (hasFrames() || performance.now() >= deadline) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    video.onloadedmetadata = () => {
      if (hasFrames()) resolve();
    };
    requestAnimationFrame(tick);
  });
}

type Compositor = {
  resize: (width: number, height: number) => void;
  render: (video: HTMLVideoElement, mask: Float32Array) => void;
  renderSharp: (video: HTMLVideoElement) => void;
  destroy: () => void;
};

export async function createBackgroundBlurProcessor(
  sourceMST: MediaStreamTrack,
  options?: CreateBackgroundBlurProcessorOptions,
): Promise<BackgroundBlurProcessor> {
  const segmenter = await createImageSegmenter();
  let sessionStartMs = performance.now();
  let lastVideoTimestampMs = -1;

  const hiddenVideo = document.createElement("video");
  hiddenVideo.srcObject = new MediaStream([sourceMST]);
  hiddenVideo.muted = true;
  hiddenVideo.playsInline = true;
  hiddenVideo.autoplay = true;
  await waitForVideoReady(hiddenVideo);

  const outputCanvas =
    options?.displayCanvas ?? document.createElement("canvas");

  const compositor: Compositor = isWebGL2Available()
    ? createWebGLBackgroundBlurCompositor(outputCanvas)
    : createCanvasBackgroundBlurCompositor(outputCanvas);

  let frameW = hiddenVideo.videoWidth || 640;
  let frameH = hiddenVideo.videoHeight || 480;
  compositor.resize(frameW, frameH);

  let maskBuffer = new Float32Array(frameW * frameH);
  let smoothedMask = new Float32Array(frameW * frameH);
  let hasMask = false;
  let hasSmoothedMask = false;
  let lastSegmentAt = 0;
  let frameId = 0;
  let rVfcHandle = 0;
  let destroyed = false;
  let drewFirstFrame = false;

  const waitForFirstFrame = (timeoutMs = 6000): Promise<boolean> =>
    new Promise((resolve) => {
      if (drewFirstFrame) {
        resolve(true);
        return;
      }
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        if (drewFirstFrame) {
          resolve(true);
          return;
        }
        if (performance.now() >= deadline) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const ensureDimensions = (vw: number, vh: number) => {
    if (vw <= 0 || vh <= 0) return;
    if (vw === frameW && vh === frameH) return;
    frameW = vw;
    frameH = vh;
    compositor.resize(frameW, frameH);
    maskBuffer = new Float32Array(frameW * frameH);
    smoothedMask = new Float32Array(frameW * frameH);
    hasMask = false;
    hasSmoothedMask = false;
  };

  const postProcessMask = () => {
    const len = frameW * frameH;
    blendMaskTemporal(
      hasSmoothedMask ? smoothedMask : null,
      maskBuffer,
      smoothedMask,
      len,
      MASK_TEMPORAL_NEW_WEIGHT,
    );
    featherMaskInPlace(smoothedMask, frameW, frameH, MASK_FEATHER_RADIUS_PX);
    hasSmoothedMask = true;
  };

  const nextVideoTimestampMs = (): number => {
    let ts = performance.now() - sessionStartMs;
    if (ts <= lastVideoTimestampMs) ts = lastVideoTimestampMs + 1;
    lastVideoTimestampMs = ts;
    return ts;
  };

  const runSegmentation = (video: HTMLVideoElement) => {
    if (destroyed) return;
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return;

    const now = performance.now();
    if (now - lastSegmentAt < MASK_INFERENCE_INTERVAL_MS) return;
    lastSegmentAt = now;

    const ts = nextVideoTimestampMs();

    try {
      const result = segmenter.segmentForVideo(video, ts);
      const vw = video.videoWidth || frameW;
      const vh = video.videoHeight || frameH;
      ensureDimensions(vw, vh);
      const { ok } = copyPersonMaskFromResult(
        result,
        frameW,
        frameH,
        maskBuffer,
      );
      if (ok) {
        hasMask = true;
        postProcessMask();
      }
      result.close();
    } catch {
      /* reuse last mask on transient segmenter errors */
    }
  };

  const drawFrame = () => {
    if (destroyed) return;

    const vw = hiddenVideo.videoWidth;
    const vh = hiddenVideo.videoHeight;
    if (vw > 0 && vh > 0) {
      ensureDimensions(vw, vh);
    }

    if (hiddenVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      runSegmentation(hiddenVideo);
      if (hasMask && hasSmoothedMask) {
        compositor.render(hiddenVideo, smoothedMask);
      } else {
        compositor.renderSharp(hiddenVideo);
      }
      if (!drewFirstFrame && frameW > 0 && frameH > 0) {
        drewFirstFrame = true;
      }
    }

    if ("requestVideoFrameCallback" in hiddenVideo) {
      rVfcHandle = hiddenVideo.requestVideoFrameCallback(() => {
        drawFrame();
      });
    } else {
      frameId = requestAnimationFrame(drawFrame);
    }
  };

  drawFrame();

  const onVisibilityChange = () => {
    if (destroyed || document.visibilityState !== "visible") return;
    if (rVfcHandle && "cancelVideoFrameCallback" in hiddenVideo) {
      hiddenVideo.cancelVideoFrameCallback(rVfcHandle);
      rVfcHandle = 0;
    }
    cancelAnimationFrame(frameId);
    frameId = 0;
    drawFrame();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const canvasStream = outputCanvas.captureStream(OUTPUT_FPS);
  const outputTrack = canvasStream.getVideoTracks()[0];
  if (!outputTrack) {
    closeImageSegmenter(segmenter);
    throw new Error("Failed to capture blurred video track");
  }

  const reconnectSource = async (newMST: MediaStreamTrack) => {
    if (destroyed) return;
    // Keep sessionStartMs + lastVideoTimestampMs monotonic — MediaPipe VIDEO mode
    // rejects timestamps that go backwards (see segmentForVideo timestamp mismatch).
    lastSegmentAt = 0;
    hasMask = false;
    hasSmoothedMask = false;
    if (rVfcHandle && "cancelVideoFrameCallback" in hiddenVideo) {
      hiddenVideo.cancelVideoFrameCallback(rVfcHandle);
      rVfcHandle = 0;
    }
    cancelAnimationFrame(frameId);
    frameId = 0;
    hiddenVideo.srcObject = new MediaStream([newMST]);
    await waitForVideoReady(hiddenVideo);
    ensureDimensions(
      hiddenVideo.videoWidth || frameW,
      hiddenVideo.videoHeight || frameH,
    );
    drawFrame();
  };

  const cleanup = () => {
    destroyed = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (rVfcHandle && "cancelVideoFrameCallback" in hiddenVideo) {
      hiddenVideo.cancelVideoFrameCallback(rVfcHandle);
    }
    cancelAnimationFrame(frameId);
    hiddenVideo.srcObject = null;
    hiddenVideo.remove();
    compositor.destroy();
    closeImageSegmenter(segmenter);
    if (outputTrack.readyState !== "ended") {
      outputTrack.stop();
    }
  };

  return {
    getMediaStreamTrack: () => outputTrack,
    waitForFirstFrame,
    reconnectSource,
    cleanup,
  };
}

/** LiveKit path: blur a raw camera MediaStreamTrack (no Agora wrapper). */
export async function createBackgroundBlurFromTrack(
  mst: MediaStreamTrack,
): Promise<{
  track: MediaStreamTrack;
  cleanup: () => void;
  reconnectSource: (sourceMST: MediaStreamTrack) => Promise<void>;
  waitForFirstFrame: (timeoutMs?: number) => Promise<boolean>;
}> {
  const processor = await createBackgroundBlurProcessor(mst);
  return {
    track: processor.getMediaStreamTrack(),
    cleanup: processor.cleanup,
    reconnectSource: processor.reconnectSource,
    waitForFirstFrame: processor.waitForFirstFrame,
  };
}

/** Warm-up for pre-join loading UI. */
export { preloadImageSegmenter };
