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
/**
 * Each block of `size` px takes its mean color, over the whole frame or only
 * the blocks that touch `region`. Blocks sit on the frame's grid, not the
 * region's, so they stay put while a tracked subject moves under them.
 */
export function pixelate(frame: Buffer, width: number, height: number, size: number, region?: Box): Buffer {
  const out = Buffer.from(frame);
  const area = region ?? { left: 0, top: 0, right: width, bottom: height };
  for (let top = Math.floor(area.top / size) * size; top < area.bottom; top += size) {
    const bottom = Math.min(height, top + size);
    for (let left = Math.floor(area.left / size) * size; left < area.right; left += size) {
      const right = Math.min(width, left + size);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = top; y < bottom; y++) {
        for (let p = (y * width + left) * 4, end = (y * width + right) * 4; p < end; p += 4) {
          r += frame[p];
          g += frame[p + 1];
          b += frame[p + 2];
        }
      }
      const count = (bottom - top) * (right - left);
      const [mr, mg, mb] = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
      for (let y = top; y < bottom; y++) {
        for (let p = (y * width + left) * 4, end = (y * width + right) * 4; p < end; p += 4) {
          out[p] = mr;
          out[p + 1] = mg;
          out[p + 2] = mb;
        }
      }
    }
  }
  return out;
}

export function padBox(box: Box, margin: number, width: number, height: number): Box {
  return {
    left: Math.max(0, box.left - margin),
    top: Math.max(0, box.top - margin),
    right: Math.min(width, box.right + margin),
    bottom: Math.min(height, box.bottom + margin),
  };
}

/**
 * Reality Shift · spotlight: the background darkens and loses some color,
 * except for a soft pool of light around the subject. `center` and `radius`
 * place the pool in source pixels.
 */
export function spotlight(frame: Buffer, alpha: Uint8Array, width: number, darkness: number, pool: { x: number; y: number; radius: number } | null): Buffer {
  const out = Buffer.allocUnsafe(frame.length);
  const inner = pool ? pool.radius * 0.7 : 0;
  const outer = pool ? pool.radius * 2.4 : 1;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    let reach = 1;
    if (pool) {
      const dx = (i % width) - pool.x;
      const dy = Math.floor(i / width) - pool.y;
      const t = Math.min(1, Math.max(0, (Math.sqrt(dx * dx + dy * dy) - inner) / (outer - inner)));
      // Light falls off smoothly; even the pool keeps a little shade.
      reach = 0.3 + 0.7 * t * t * (3 - 2 * t);
    }
    const k = (darkness * reach * (255 - alpha[i])) / 255;
    const r = frame[p];
    const g = frame[p + 1];
    const b = frame[p + 2];
    const y = luma(r, g, b);
    const keep = 1 - k;
    const desaturate = 0.4 * k;
    out[p] = Math.round((r + (y - r) * desaturate) * keep);
    out[p + 1] = Math.round((g + (y - g) * desaturate) * keep);
    out[p + 2] = Math.round((b + (y - b) * desaturate) * keep);
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Grows a 0–255 mask by `radius` pixels (square structuring element). Two
 * separable passes with a running count, so the cost does not depend on the
 * radius. Erase uses it to take text outlines and drop shadows with the text.
 */
export function dilate(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r <= 0) return alpha;
  const pass = (source: Uint8Array, horizontal: boolean) => {
    const target = new Uint8Array(source.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const step = horizontal ? 1 : width;
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * width : line;
      let count = 0;
      for (let k = 0; k <= Math.min(r, length - 1); k++) if (source[base + k * step]) count++;
      for (let i = 0; i < length; i++) {
        if (count > 0) target[base + i * step] = 255;
        const enter = i + r + 1;
        const leave = i - r;
        if (enter < length && source[base + enter * step]) count++;
        if (leave >= 0 && source[base + leave * step]) count--;
      }
    }
    return target;
  };
  return pass(pass(alpha, true), false);
}

/**
 * Fills the pixels of `hole` (alpha > 0) inside `region` from the known pixels
 * around them. Edges that cross the hole are continued along lines
 * (directionalFill); pull-push interpolation covers what no line reaches: the
 * region is averaged down a pyramid using only known pixels, then each level
 * fills its gaps from the bilinear upsample of the next. Deterministic.
 * Writes into `out`.
 */
export function inpaintRegion(out: Buffer, hole: Uint8Array, width: number, region: Box): void {
  const w0 = region.right - region.left;
  const h0 = region.bottom - region.top;
  if (w0 <= 0 || h0 <= 0) return;
  type Level = { w: number; h: number; color: Float32Array; weight: Float32Array };
  const base: Level = { w: w0, h: h0, color: new Float32Array(w0 * h0 * 3), weight: new Float32Array(w0 * h0) };
  let known = 0;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      const i = (region.top + y) * width + region.left + x;
      if (hole[i]) continue;
      const j = y * w0 + x;
      const p = i * 4;
      base.weight[j] = 1;
      base.color[j * 3] = out[p];
      base.color[j * 3 + 1] = out[p + 1];
      base.color[j * 3 + 2] = out[p + 2];
      known++;
    }
  }
  // Nothing to fill from: leave the pixels as they are rather than inventing a color.
  if (known === 0) return;
  const levels: Level[] = [base];
  // Pull: weighted averages of 2×2 blocks; weights saturate at 1.
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const fine = levels.at(-1)!;
    const w = Math.ceil(fine.w / 2);
    const h = Math.ceil(fine.h / 2);
    const coarse: Level = { w, h, color: new Float32Array(w * h * 3), weight: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++) {
          const fy = y * 2 + dy;
          if (fy >= fine.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const fx = x * 2 + dx;
            if (fx >= fine.w) continue;
            const f = fy * fine.w + fx;
            const a = fine.weight[f];
            if (a <= 0) continue;
            sum += a;
            r += fine.color[f * 3] * a;
            g += fine.color[f * 3 + 1] * a;
            b += fine.color[f * 3 + 2] * a;
          }
        }
        const c = y * w + x;
        if (sum > 0) {
          coarse.color[c * 3] = r / sum;
          coarse.color[c * 3 + 1] = g / sum;
          coarse.color[c * 3 + 2] = b / sum;
          coarse.weight[c] = Math.min(1, sum);
        }
      }
    }
    levels.push(coarse);
  }
  // Push: every level blends its own (partial) knowledge over the coarser estimate.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      const cy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(cy);
      const y1 = Math.min(coarse.h - 1, y0 + 1);
      const ty = cy - y0;
      for (let x = 0; x < fine.w; x++) {
        const f = y * fine.w + x;
        const a = fine.weight[f];
        if (a >= 1) continue;
        const cx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const tx = cx - x0;
        for (let c = 0; c < 3; c++) {
          const top = coarse.color[(y0 * coarse.w + x0) * 3 + c] * (1 - tx) + coarse.color[(y0 * coarse.w + x1) * 3 + c] * tx;
          const bottom = coarse.color[(y1 * coarse.w + x0) * 3 + c] * (1 - tx) + coarse.color[(y1 * coarse.w + x1) * 3 + c] * tx;
          const estimate = top * (1 - ty) + bottom * ty;
          fine.color[f * 3 + c] = fine.color[f * 3 + c] * a + estimate * (1 - a);
        }
        fine.weight[f] = 1;
      }
    }
  }
  const lines = directionalFill(out, hole, width, region);
  // Pull-push only speaks where no line crosses the hole, or every crossing is long and incoherent.
  const reach = 2 * Math.max(w0, h0);
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      const i = (region.top + y) * width + region.left + x;
      if (!hole[i]) continue;
      const k = y * w0 + x;
      const j = k * 3;
      const p = i * 4;
      const fallback = lines.weight[k] > 0 ? Math.min(1, lines.best[k] / reach) ** FILL_FALLOFF : 1;
      const w = lines.weight[k] + fallback;
      out[p] = Math.round((lines.color[j] + base.color[j] * fallback) / w);
      out[p + 1] = Math.round((lines.color[j + 1] + base.color[j + 1] * fallback) / w);
      out[p + 2] = Math.round((lines.color[j + 2] + base.color[j + 2] * fallback) / w);
    }
  }
}

/** How fast a crossing loses weight against the pixel's cheapest one: (best / cost) ** FILL_FALLOFF. */
const FILL_FALLOFF = 16;

/** The four line directions directional fill crosses a hole along. */
const FILL_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
] as const;

/**
 * Edge-aware part of the fill. Every horizontal, vertical and diagonal line
 * through the region is walked; each run of hole pixels with known pixels at
 * both ends is a crossing, interpolated between those ends. A crossing costs
 * its length, more when its ends disagree. Each pixel weighs its crossings
 * against its own cheapest one with a steep falloff, so an edge that runs
 * through the hole (a stripe under a subtitle) is continued sharply, while
 * longer lines that slip across other content barely count. Returns colors
 * premultiplied by those relative weights; linear in the region size.
 */
function directionalFill(out: Buffer, hole: Uint8Array, width: number, region: Box): { color: Float32Array; weight: Float32Array; best: Float32Array } {
  const w0 = region.right - region.left;
  const h0 = region.bottom - region.top;
  const color = new Float32Array(w0 * h0 * 3);
  const weight = new Float32Array(w0 * h0);
  const best = new Float32Array(w0 * h0).fill(Infinity);
  const isHole = (x: number, y: number) => hole[(region.top + y) * width + region.left + x] > 0;
  const rgbAt = (x: number, y: number) => {
    const p = ((region.top + y) * width + region.left + x) * 4;
    return [out[p], out[p + 1], out[p + 2]] as const;
  };
  // Positions of the current line, reused between lines.
  const xs = new Int32Array(w0 + h0);
  const ys = new Int32Array(w0 + h0);
  const crossings = (visit: (start: number, end: number, cost: number, a: readonly number[], b: readonly number[]) => void) => {
    for (const [dx, dy] of FILL_DIRECTIONS) {
      const step = dx && dy ? Math.SQRT2 : 1;
      const starts: [number, number][] = [];
      if (dy === 0) for (let y = 0; y < h0; y++) starts.push([0, y]);
      else {
        for (let x = 0; x < w0; x++) starts.push([x, 0]);
        if (dx === 1) for (let y = 1; y < h0; y++) starts.push([0, y]);
        if (dx === -1) for (let y = 1; y < h0; y++) starts.push([w0 - 1, y]);
      }
      for (const [sx, sy] of starts) {
        let n = 0;
        for (let x = sx, y = sy; x >= 0 && x < w0 && y < h0; x += dx, y += dy, n++) {
          xs[n] = x;
          ys[n] = y;
        }
        let k = 0;
        while (k < n) {
          if (!isHole(xs[k], ys[k])) {
            k++;
            continue;
          }
          const start = k;
          while (k < n && isHole(xs[k], ys[k])) k++;
          // Both ends must be known pixels inside the region.
          if (start === 0 || k === n) continue;
          const a = rgbAt(xs[start - 1], ys[start - 1]);
          const b = rgbAt(xs[k], ys[k]);
          const disagreement = (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
          visit(start, k, (k - start + 1) * step * (1 + disagreement / 12), a, b);
        }
      }
    }
  };
  crossings((start, end, cost) => {
    for (let m = start; m < end; m++) {
      const q = ys[m] * w0 + xs[m];
      if (cost < best[q]) best[q] = cost;
    }
  });
  crossings((start, end, cost, a, b) => {
    const span = end - start + 1;
    for (let m = start; m < end; m++) {
      const q = ys[m] * w0 + xs[m];
      const w = (best[q] / cost) ** FILL_FALLOFF;
      if (w < 1e-4) continue;
      const t = (m - start + 1) / span;
      color[q * 3] += (a[0] + (b[0] - a[0]) * t) * w;
      color[q * 3 + 1] += (a[1] + (b[1] - a[1]) * t) * w;
      color[q * 3 + 2] += (a[2] + (b[2] - a[2]) * t) * w;
      weight[q] += w;
    }
  });
  return { color, weight, best };
}
