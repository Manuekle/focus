import sharp from "sharp";
import type { BlurLevel } from "../../shared/render";
import type { Box } from "../../shared/tracking";

// Pixel operations on straight (non-premultiplied) RGBA frames and 0–255
// alpha masks. All deterministic; integer math where it matters.

/** Rec. 709 luma, the grayscale the eye reads as neutral. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Reality Shift · selective color: subject keeps its color, background goes gray. */
export function selectiveColor(frame: Buffer, alpha: Uint8Array, intensity: number): Buffer {
  const out = Buffer.allocUnsafe(frame.length);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const r = frame[p];
    const g = frame[p + 1];
    const b = frame[p + 2];
    const y = luma(r, g, b);
    // Background weight: how much this pixel desaturates.
    const k = (intensity * (255 - alpha[i])) / 255;
    out[p] = Math.round(r + (y - r) * k);
    out[p + 1] = Math.round(g + (y - g) * k);
    out[p + 2] = Math.round(b + (y - b) * k);
    out[p + 3] = 255;
  }
  return out;
}

export function blurSigma(level: BlurLevel, width: number, height: number): number {
  const base = level === "low" ? 4 : level === "medium" ? 9 : 16;
  return (base * Math.max(width, height)) / 1280;
}

/**
 * Reality Shift · background blur. The background is blurred with the subject
 * cut out (normalized convolution: blur(color × w) / blur(w)), so the subject's
 * colors never smear into the background around its edges.
 */
export async function backgroundBlur(frame: Buffer, alpha: Uint8Array, width: number, height: number, sigma: number): Promise<Buffer> {
  const pixels = width * height;
  const weighted = Buffer.allocUnsafe(pixels * 3);
  const weight = Buffer.allocUnsafe(pixels);
  for (let i = 0, p = 0, q = 0; i < pixels; i++, p += 4, q += 3) {
    const w = 255 - alpha[i];
    weight[i] = w;
    weighted[q] = (frame[p] * w + 127) / 255;
    weighted[q + 1] = (frame[p + 1] * w + 127) / 255;
    weighted[q + 2] = (frame[p + 2] * w + 127) / 255;
  }
  // Sharp widens single-band raw input to sRGB unless told otherwise.
  const blur = (data: Buffer, channels: 1 | 3) => {
    const image = sharp(data, { raw: { width, height, channels } }).blur(sigma);
    return (channels === 1 ? image.toColourspace("b-w") : image).raw().toBuffer();
  };
  const [blurredColor, blurredWeight, plain] = await Promise.all([
    blur(weighted, 3),
    blur(weight, 1),
    // Fallback where the subject covers the whole neighbourhood.
    sharp(frame, { raw: { width, height, channels: 4 } }).removeAlpha().blur(sigma).raw().toBuffer(),
  ]);
  const out = Buffer.allocUnsafe(frame.length);
  for (let i = 0, p = 0, q = 0; i < pixels; i++, p += 4, q += 3) {
    const w = blurredWeight[i];
    const a = alpha[i] / 255;
    for (let c = 0; c < 3; c++) {
      const background = w > 8 ? Math.min(255, (blurredColor[q + c] * 255) / w) : plain[q + c];
      out[p + c] = Math.round(background * (1 - a) + frame[p + c] * a);
    }
    out[p + 3] = 255;
  }
  return out;
}

/** Composites `layer` over `base` in place through a mask, at an extra opacity. */
export function blendOver(base: Buffer, layer: Buffer, alpha: Uint8Array, opacity: number, region?: Box, width?: number): void {
  if (!region || width === undefined) {
    for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
      const a = (alpha[i] * opacity) / 255;
      if (a <= 0) continue;
      base[p] = Math.round(base[p] + (layer[p] - base[p]) * a);
      base[p + 1] = Math.round(base[p + 1] + (layer[p + 1] - base[p + 1]) * a);
      base[p + 2] = Math.round(base[p + 2] + (layer[p + 2] - base[p + 2]) * a);
    }
    return;
  }
  for (let y = region.top; y < region.bottom; y++) {
    for (let x = region.left; x < region.right; x++) {
      const i = y * width + x;
      const a = (alpha[i] * opacity) / 255;
      if (a <= 0) continue;
      const p = i * 4;
      base[p] = Math.round(base[p] + (layer[p] - base[p]) * a);
      base[p + 1] = Math.round(base[p + 1] + (layer[p + 1] - base[p + 1]) * a);
      base[p + 2] = Math.round(base[p + 2] + (layer[p + 2] - base[p + 2]) * a);
    }
  }
}

/** Motion Echo opacity for trail k (1 = most recent), deterministic and decreasing. */
export function trailOpacity(k: number, count: number, intensity: number): number {
  return intensity * (1 - (k - 1) / count);
}

/** A cropped copy of a frame and its mask, enough to redraw an earlier subject. */
export type Ghost = {
  readonly box: Box;
  readonly rgba: Buffer;
  readonly alpha: Uint8Array;
};

export function cropGhost(frame: Buffer, alpha: Uint8Array, box: Box, width: number): Ghost {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const rgba = Buffer.allocUnsafe(w * h * 4);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const source = (box.top + y) * width + box.left;
    frame.copy(rgba, y * w * 4, source * 4, (source + w) * 4);
    mask.set(alpha.subarray(source, source + w), y * w);
  }
  return { box, rgba, alpha: mask };
}

/** Draws a ghost back at its original source position, in place. */
export function drawGhost(base: Buffer, ghost: Ghost, opacity: number, width: number): void {
  const w = ghost.box.right - ghost.box.left;
  const h = ghost.box.bottom - ghost.box.top;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = y * w + x;
      const a = (ghost.alpha[g] * opacity) / 255;
      if (a <= 0) continue;
      const p = ((ghost.box.top + y) * width + ghost.box.left + x) * 4;
      const q = g * 4;
      base[p] = Math.round(base[p] + (ghost.rgba[q] - base[p]) * a);
      base[p + 1] = Math.round(base[p + 1] + (ghost.rgba[q + 1] - base[p + 1]) * a);
      base[p + 2] = Math.round(base[p + 2] + (ghost.rgba[q + 2] - base[p + 2]) * a);
    }
  }
}

/** Expands a box by a margin, clamped to the frame (feathered edges reach past SAM's box). */
export function padBox(box: Box, margin: number, width: number, height: number): Box {
  return {
    left: Math.max(0, box.left - margin),
    top: Math.max(0, box.top - margin),
    right: Math.min(width, box.right + margin),
    bottom: Math.min(height, box.bottom + margin),
  };
}
