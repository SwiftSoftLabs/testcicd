import {
  BLUR_DOWNSCALE,
  BLUR_RADIUS_PX,
} from "@/lib/calls/backgroundBlur/constants";
import { maskToPersonAlpha } from "@/lib/calls/backgroundBlur/maskPostProcess";

export type CanvasBackgroundBlurCompositor = {
  resize: (width: number, height: number) => void;
  render: (video: HTMLVideoElement, mask: Float32Array) => void;
  renderSharp: (video: HTMLVideoElement) => void;
  destroy: () => void;
};

export function createCanvasBackgroundBlurCompositor(
  canvas: HTMLCanvasElement,
): CanvasBackgroundBlurCompositor {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D not available");

  const blurCanvas = document.createElement("canvas");
  const blurCtx = blurCanvas.getContext("2d");
  if (!blurCtx) throw new Error("Canvas 2D not available");

  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Canvas 2D not available");

  const fgCanvas = document.createElement("canvas");
  const fgCtx = fgCanvas.getContext("2d");
  if (!fgCtx) throw new Error("Canvas 2D not available");

  let outputW = 0;
  let outputH = 0;
  let maskImageData: ImageData | null = null;

  const resize = (width: number, height: number) => {
    if (width === outputW && height === outputH) return;
    outputW = width;
    outputH = height;
    canvas.width = width;
    canvas.height = height;
    fgCanvas.width = width;
    fgCanvas.height = height;
    const bw = Math.max(1, Math.round(width * BLUR_DOWNSCALE));
    const bh = Math.max(1, Math.round(height * BLUR_DOWNSCALE));
    blurCanvas.width = bw;
    blurCanvas.height = bh;
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskImageData = maskCtx.createImageData(width, height);
  };

  const render = (video: HTMLVideoElement, mask: Float32Array) => {
    if (!maskImageData || outputW === 0 || outputH === 0) return;

    const data = maskImageData.data;

    for (let i = 0; i < outputW * outputH; i++) {
      const m = mask[i] ?? 0;
      const alpha = Math.round(maskToPersonAlpha(m) * 255);
      const o = i * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = alpha;
    }
    maskCtx.putImageData(maskImageData, 0, 0);

    const blurPx = Math.max(4, Math.round(BLUR_RADIUS_PX * BLUR_DOWNSCALE));
    blurCtx.filter = `blur(${blurPx}px)`;
    blurCtx.drawImage(video, 0, 0, blurCanvas.width, blurCanvas.height);
    blurCtx.filter = "none";

    ctx.drawImage(blurCanvas, 0, 0, outputW, outputH);

    fgCtx.clearRect(0, 0, outputW, outputH);
    fgCtx.drawImage(video, 0, 0, outputW, outputH);
    fgCtx.globalCompositeOperation = "destination-in";
    fgCtx.drawImage(maskCanvas, 0, 0, outputW, outputH);
    fgCtx.globalCompositeOperation = "source-over";

    ctx.drawImage(fgCanvas, 0, 0, outputW, outputH);
  };

  const renderSharp = (video: HTMLVideoElement) => {
    if (outputW === 0 || outputH === 0) return;
    ctx.drawImage(video, 0, 0, outputW, outputH);
  };

  const destroy = () => {
    /* auxiliary canvases are GC'd with the processor */
  };

  return { resize, render, renderSharp, destroy };
}
