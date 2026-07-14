import {
  MASK_EDGE_HIGH,
  MASK_EDGE_LOW,
} from "@/lib/calls/backgroundBlur/constants";

/** Meet-style S-curve alpha from mask confidence (0 = background, 1 = person). */
export function maskToPersonAlpha(m: number, low = MASK_EDGE_LOW, high = MASK_EDGE_HIGH): number {
  const span = Math.max(0.001, high - low);
  const t = Math.min(1, Math.max(0, (m - low) / span));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** EMA: out = prev * (1 - w) + next * w. If prev is null, copies next into out. */
export function blendMaskTemporal(
  prev: Float32Array | null,
  next: Float32Array,
  out: Float32Array,
  len: number,
  newWeight: number,
): void {
  if (!prev || prev.length < len) {
    out.set(next.subarray(0, len));
    return;
  }
  const keep = 1 - newWeight;
  for (let i = 0; i < len; i++) {
    out[i] = (prev[i] ?? 0) * keep + (next[i] ?? 0) * newWeight;
  }
}

/** Separable box blur on mask values in [0, 1]. */
export function featherMaskInPlace(
  mask: Float32Array,
  w: number,
  h: number,
  radiusPx: number,
): void {
  const len = w * h;
  if (radiusPx <= 0 || len === 0) return;

  const r = Math.max(1, Math.round(radiusPx));
  const tmp = new Float32Array(len);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(w - 1, Math.max(0, x + dx));
        sum += mask[y * w + xx] ?? 0;
        count += 1;
      }
      tmp[y * w + x] = sum / count;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        sum += tmp[yy * w + x] ?? 0;
        count += 1;
      }
      mask[y * w + x] = sum / count;
    }
  }
}
