import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  MEDIAPIPE_WASM_BASE,
  SELFIE_SEGMENTER_MODEL,
} from "@/lib/calls/backgroundBlur/constants";

/** Cached WASM fileset only — each blur session gets its own ImageSegmenter (VIDEO timestamps). */
let visionFilesetPromise: ReturnType<
  typeof import("@mediapipe/tasks-vision").FilesetResolver.forVisionTasks
> | null = null;

async function getVisionFileset() {
  if (!visionFilesetPromise) {
    visionFilesetPromise = (async () => {
      const { FilesetResolver } = await import("@mediapipe/tasks-vision");
      return FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
    })();
  }
  return visionFilesetPromise;
}

/** Warm up WASM (call when user enables blur). */
export async function preloadImageSegmenter(): Promise<void> {
  await getVisionFileset();
}

/** New segmenter per processor so VIDEO timestamps start fresh each session. */
export async function createImageSegmenter(): Promise<ImageSegmenter> {
  const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const vision = await getVisionFileset();
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: SELFIE_SEGMENTER_MODEL },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: true,
  });
}

export function closeImageSegmenter(segmenter: ImageSegmenter): void {
  try {
    segmenter.close();
  } catch {
    /* already closed */
  }
}
