import type { ImageSegmenterResult, MPMask } from "@mediapipe/tasks-vision";

/** Documented selfie indices: background = 0, person = 1. */
const PERSON_CATEGORY_INDEX = 1;

function maskBufferMax(out: Float32Array, len: number): number {
  let max = 0;
  for (let i = 0; i < len; i++) {
    const v = out[i] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

function resizeFloatMask(
  src: Float32Array,
  sw: number,
  sh: number,
  targetW: number,
  targetH: number,
  out: Float32Array,
): void {
  const needed = targetW * targetH;
  if (out.length < needed) {
    throw new Error("Mask buffer too small");
  }

  if (sw === targetW && sh === targetH) {
    out.set(src.subarray(0, needed));
    return;
  }

  const xScale = sw / targetW;
  const yScale = sh / targetH;

  for (let y = 0; y < targetH; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < targetW; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;

      const i00 = y0 * sw + x0;
      const i10 = y0 * sw + x1;
      const i01 = y1 * sw + x0;
      const i11 = y1 * sw + x1;

      const v00 = src[i00] ?? 0;
      const v10 = src[i10] ?? 0;
      const v01 = src[i01] ?? 0;
      const v11 = src[i11] ?? 0;

      const top = v00 * (1 - fx) + v10 * fx;
      const bottom = v01 * (1 - fx) + v11 * fx;
      out[y * targetW + x] = top * (1 - fy) + bottom * fy;
    }
  }
}

/** Map category uint8 (0, 1, or 0/255) to person confidence 0..1. */
function categoryByteToPerson(v: number): number {
  if (v === PERSON_CATEGORY_INDEX || v === 255) return 1;
  if (v === 0) return 0;
  return v > 127 ? 1 : 0;
}

function resizeCategoryMask(
  src: Uint8Array,
  sw: number,
  sh: number,
  targetW: number,
  targetH: number,
  out: Float32Array,
): void {
  const needed = targetW * targetH;
  if (out.length < needed) {
    throw new Error("Mask buffer too small");
  }

  if (sw === targetW && sh === targetH) {
    for (let i = 0; i < needed; i++) {
      out[i] = categoryByteToPerson(src[i] ?? 0);
    }
    return;
  }

  const xScale = sw / targetW;
  const yScale = sh / targetH;

  for (let y = 0; y < targetH; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < targetW; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;

      const sample = (ix: number, iy: number) =>
        categoryByteToPerson(src[iy * sw + ix] ?? 0);

      const v00 = sample(x0, y0);
      const v10 = sample(x1, y0);
      const v01 = sample(x0, y1);
      const v11 = sample(x1, y1);

      const top = v00 * (1 - fx) + v10 * fx;
      const bottom = v01 * (1 - fx) + v11 * fx;
      out[y * targetW + x] = top * (1 - fy) + bottom * fy;
    }
  }
}

/** Bilinear-resize a confidence mask into `out` (length = targetW * targetH). */
export function copyMaskIntoBuffer(
  mask: MPMask,
  targetW: number,
  targetH: number,
  out: Float32Array,
): void {
  const src = mask.getAsFloat32Array();
  resizeFloatMask(src, mask.width, mask.height, targetW, targetH, out);
}

function copyCategoryMaskIntoBuffer(
  mask: MPMask,
  targetW: number,
  targetH: number,
  out: Float32Array,
): void {
  const src = mask.getAsUint8Array();
  resizeCategoryMask(src, mask.width, mask.height, targetW, targetH, out);
}

function copyConfidencePersonMask(
  result: ImageSegmenterResult,
  targetW: number,
  targetH: number,
  out: Float32Array,
): boolean {
  const masks = result.confidenceMasks;
  if (!masks?.length) return false;

  // Selfie: [0]=background, [1]=person when both exist; single mask = person.
  const personMask = masks.length > 1 ? masks[1]! : masks[0]!;
  copyMaskIntoBuffer(personMask, targetW, targetH, out);
  return true;
}

/**
 * Person mask: 1 = sharp foreground (Meet-style composite).
 * Confidence masks are primary — verified in runtime logs; category mask is fallback only.
 */
export function copyPersonMaskFromResult(
  result: ImageSegmenterResult,
  targetW: number,
  targetH: number,
  out: Float32Array,
): { ok: boolean; source: "category" | "confidence" | "none" } {
  const len = targetW * targetH;

  if (copyConfidencePersonMask(result, targetW, targetH, out)) {
    const max = maskBufferMax(out, len);
    if (max > 0.05) {
      return { ok: true, source: "confidence" };
    }
  }

  if (result.categoryMask) {
    copyCategoryMaskIntoBuffer(result.categoryMask, targetW, targetH, out);
    const max = maskBufferMax(out, len);
    if (max > 0.05) {
      return { ok: true, source: "category" };
    }
  }

  return { ok: false, source: "none" };
}
