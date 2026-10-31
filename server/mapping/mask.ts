import sharp from "sharp";
import type { Rgba } from "../rotoscope/alpha";

// Binary masks (one byte per pixel, 0 or 1) and the few morphological
// operations the mapping engine needs. A mask is a silhouette: it says which
// pixels belong to the character, never where a joint is.

export type Mask = { readonly width: number; readonly height: number; readonly data: Uint8Array };

export const emptyMask = (width: number, height: number): Mask => ({ width, height, data: new Uint8Array(width * height) });

export function fromAlpha(image: Rgba, threshold = 128): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let p = 0; p < data.length; p++) data[p] = image.data[p * 4 + 3] >= threshold ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

/** True when the image carries real transparency (a cut-out), not just an opaque alpha channel. */
export function hasTransparency(image: Rgba): boolean {
  let clear = 0;
  for (let p = 3; p < image.data.length; p += 4) if (image.data[p] < 128) clear++;
  return clear > image.width * image.height * 0.02;
}

/**
 * The figure on a flat backdrop, without a model: every pixel connected to the
 * image border through backdrop-coloured pixels is background. Enclosed light
 * areas (a white shirt inside its outline) stay part of the figure. The local
 * fallback when SAM 3.1 is off or fails.
 */
export function fromBackdrop(image: Rgba, tolerance = 28): Mask {
  const { width, height, data } = image;
  const border: number[][] = [];
  for (let x = 0; x < width; x += 4) border.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y += 4) border.push([0, y], [width - 1, y]);
  const channel = (c: number) => {
    const values = border.map(([x, y]) => data[(y * width + x) * 4 + c]).sort((a, b) => a - b);
    return values[values.length >> 1];
  };
  const backdrop = [channel(0), channel(1), channel(2)];
  const isBackdrop = (p: number) => data[p * 4 + 3] < 128
    || Math.max(Math.abs(data[p * 4] - backdrop[0]), Math.abs(data[p * 4 + 1] - backdrop[1]), Math.abs(data[p * 4 + 2] - backdrop[2])) <= tolerance;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const seed = (p: number) => { if (!outside[p] && isBackdrop(p)) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < width * (height - 1)) seed(p + width);
  }
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < mask.length; p++) mask[p] = outside[p] ? 0 : 1;
  return largestComponent({ width, height, data: mask });
}

/** 4-connected components; labels start at 1. */
export function components(mask: Mask): { labels: Int32Array; sizes: number[] } {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || !data[start]) continue;
    const label = sizes.length + 1;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p < width * (height - 1) ? p + width : -1];
      for (const q of next) if (q >= 0 && !labels[q] && data[q]) { labels[q] = label; stack.push(q); }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

export function largestComponent(mask: Mask): Mask {
  const { labels, sizes } = components(mask);
  if (!sizes.length) return mask;
  const keep = sizes.indexOf(Math.max(...sizes)) + 1;
  const data = new Uint8Array(mask.data.length);
  for (let p = 0; p < data.length; p++) data[p] = labels[p] === keep ? 1 : 0;
  return { ...mask, data };
}

/** Square structuring element of half-size r, as two separable passes. */
function morph(mask: Mask, r: number, grow: boolean): Mask {
  if (r <= 0) return mask;
  const { width, height } = mask;
  const pass = (input: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(input.length);
    const [outer, inner] = horizontal ? [height, width] : [width, height];
    for (let o = 0; o < outer; o++) {
      // Running count of set pixels in the window: O(1) per pixel.
      let count = 0;
      const at = (i: number) => (horizontal ? o * width + i : i * width + o);
      for (let i = 0; i < Math.min(r, inner); i++) count += input[at(i)];
      for (let i = 0; i < inner; i++) {
        if (i + r < inner) count += input[at(i + r)];
        if (i - r - 1 >= 0) count -= input[at(i - r - 1)];
        const span = Math.min(inner - 1, i + r) - Math.max(0, i - r) + 1;
        out[at(i)] = grow ? (count > 0 ? 1 : 0) : (count === span ? 1 : 0);
      }
    }
    return out;
  };
  return { width, height, data: pass(pass(mask.data, true), false) };
}

export const dilate = (mask: Mask, r: number) => morph(mask, r, true);
export const erode = (mask: Mask, r: number) => morph(mask, r, false);

/** Fills every hole not connected to the border. */
export function fillHoles(mask: Mask): Mask {
  const inverse: Mask = { ...mask, data: mask.data.map((v) => (v ? 0 : 1)) };
  const { labels } = components(inverse);
  const borderLabels = new Set<number>();
  const { width, height } = mask;
  for (let x = 0; x < width; x++) { borderLabels.add(labels[x]); borderLabels.add(labels[(height - 1) * width + x]); }
  for (let y = 0; y < height; y++) { borderLabels.add(labels[y * width]); borderLabels.add(labels[y * width + width - 1]); }
  const data = new Uint8Array(mask.data.length);
  for (let p = 0; p < data.length; p++) data[p] = mask.data[p] || !borderLabels.has(labels[p]) ? 1 : 0;
  return { width, height, data };
}

export const area = (mask: Mask) => mask.data.reduce((sum, v) => sum + v, 0);

export function intersectionOverUnion(a: Mask, b: Mask): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error("masks differ in size");
  let [both, either] = [0, 0];
  for (let p = 0; p < a.data.length; p++) {
    if (a.data[p] && b.data[p]) both++;
    if (a.data[p] || b.data[p]) either++;
  }
  return either ? both / either : 1;
}

export function and(a: Mask, b: Mask): Mask {
  return { width: a.width, height: a.height, data: a.data.map((v, p) => (v && b.data[p] ? 1 : 0)) };
}

export function andNot(a: Mask, b: Mask): Mask {
  return { width: a.width, height: a.height, data: a.data.map((v, p) => (v && !b.data[p] ? 1 : 0)) };
}

export function bounds(mask: Mask): { left: number; top: number; right: number; bottom: number } | null {
  let [left, top, right, bottom] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Nearest-neighbour resize, for carrying a mask between image grids. */
export function resizeMask(mask: Mask, width: number, height: number): Mask {
  if (mask.width === width && mask.height === height) return mask;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
    for (let x = 0; x < width; x++) data[y * width + x] = mask.data[sy * mask.width + Math.min(mask.width - 1, Math.floor((x * mask.width) / width))];
  }
  return { width, height, data };
}

export async function maskToPng(mask: Mask): Promise<Buffer> {
  const pixels = Buffer.alloc(mask.data.length);
  for (let p = 0; p < pixels.length; p++) pixels[p] = mask.data[p] ? 255 : 0;
  return sharp(pixels, { raw: { width: mask.width, height: mask.height, channels: 1 } }).png().toBuffer();
}

export async function maskFromPng(png: Buffer): Promise<Mask> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(info.width * info.height);
  for (let p = 0; p < out.length; p++) out[p] = data[p * info.channels] >= 128 ? 1 : 0;
  return { width: info.width, height: info.height, data: out };
}
