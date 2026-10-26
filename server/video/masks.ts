import { decodeMaskToRaster } from "@meta-sam/parser";
import type { Box, TrackingFrame } from "../../shared/tracking";

// Full-frame alpha masks built from SAM rasters. Everything here works on
// real pixel masks; a box is only used to place its raster, never as a mask.

export type Alpha = {
  readonly data: Uint8Array;
  /** Union box of the selected objects in this frame; null when none is visible. */
  readonly box: Box | null;
};

/** Union of the selected objects' masks at one frame, 0 or 255 per pixel. */
export function rasterizeSelection(frame: TrackingFrame | undefined, selection: ReadonlySet<string>, width: number, height: number): Alpha {
  const data = new Uint8Array(width * height);
  if (!frame) return { data, box: null };
  let union: Box | null = null;
  for (const object of frame.objects) {
    if (!selection.has(object.objectId) || !object.mask) continue;
    const raster = decodeMaskToRaster(object.mask);
    const { left, top, right, bottom } = object.box;
    const boxWidth = right - left;
    const boxHeight = bottom - top;
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    const startY = Math.max(0, top);
    const endY = Math.min(height, bottom);
    const startX = Math.max(0, left);
    const endX = Math.min(width, right);
    for (let y = startY; y < endY; y++) {
      // Nearest sampling: the raster normally matches the box 1:1.
      const row = Math.min(object.mask.height - 1, Math.floor(((y - top) * object.mask.height) / boxHeight)) * object.mask.width;
      const out = y * width;
      for (let x = startX; x < endX; x++) {
        const column = Math.min(object.mask.width - 1, Math.floor(((x - left) * object.mask.width) / boxWidth));
        if (raster[row + column] === 1) data[out + x] = 255;
      }
    }
    union = union
      ? { left: Math.min(union.left, startX), top: Math.min(union.top, startY), right: Math.max(union.right, endX), bottom: Math.max(union.bottom, endY) }
      : { left: startX, top: startY, right: endX, bottom: endY };
  }
  return { data, box: union };
}

function boxBlurPass(source: Uint8Array, target: Uint8Array, width: number, height: number, radius: number, horizontal: boolean): void {
  const span = radius * 2 + 1;
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    let sum = 0;
    // Clamp-to-edge window.
    for (let k = -radius; k <= radius; k++) sum += source[base + Math.min(length - 1, Math.max(0, k)) * step];
    for (let i = 0; i < length; i++) {
      target[base + i * step] = Math.round(sum / span);
      const outIndex = Math.max(0, i - radius);
      const inIndex = Math.min(length - 1, i + radius + 1);
      sum += source[base + inIndex * step] - source[base + outIndex * step];
    }
  }
}

/**
 * Softens mask edges. Two separable box passes approximate a Gaussian of the
 * given radius; the edge stays centered on SAM's boundary, so a subject keeps
 * its outline instead of growing a halo.
 */
export function feather(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r <= 0) return alpha;
  const a = new Uint8Array(alpha.length);
  const b = new Uint8Array(alpha.length);
  boxBlurPass(alpha, a, width, height, r, true);
  boxBlurPass(a, b, width, height, r, false);
  boxBlurPass(b, a, width, height, r, true);
  boxBlurPass(a, b, width, height, r, false);
  return b;
}

/** Feather radius in pixels for a given control value, scaled to frame size. */
export function featherRadius(control: number, width: number, height: number): number {
  return Math.round((control * Math.max(width, height)) / 1280);
}
