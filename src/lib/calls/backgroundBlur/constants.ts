/** Pinned MediaPipe Tasks Vision version (must match package.json). */
export const MEDIAPIPE_TASKS_VISION_VERSION = "0.10.21";

export const MEDIAPIPE_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;

/** Landscape variant — tuned for webcam / video-call aspect ratios (Meet-style use case). */
export const SELFIE_SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";

/** Blur passes run at this fraction of output resolution. */
export const BLUR_DOWNSCALE = 0.5;

/** Gaussian blur radius in pixels at the downscaled buffer. */
export const BLUR_RADIUS_PX = 8;

/** Blur strength scale applied to separable pass texel offsets. */
export const BLUR_TEXEL_SCALE = 0.28;

/** Minimum ms between MediaPipe inference calls. */
export const MASK_INFERENCE_INTERVAL_MS = 40;

/** Output captureStream frame rate. */
export const OUTPUT_FPS = 30;

/**
 * Person-alpha edge for compositing. Feathered mask supplies spatial softness;
 * keep this band moderate to avoid a semi-transparent “double” of the subject.
 */
export const MASK_EDGE_LOW = 0.22;
export const MASK_EDGE_HIGH = 0.68;

/** Weight of the newest segmentation frame in temporal EMA (0–1). */
export const MASK_TEMPORAL_NEW_WEIGHT = 0.55;

/** Box-blur radius applied to the mask before composite (pixels). */
export const MASK_FEATHER_RADIUS_PX = 3;
