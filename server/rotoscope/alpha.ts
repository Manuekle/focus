import sharp from "sharp";
import type { Check } from "./run-state";

// Transparent background: the generator paints the character on flat magenta
// (a colour the character doesn't wear); this keys it out. Check 3 then
// proves the result is clean: corners empty, nothing touching the edges, no
// magenta left on the figure, one body without floating specks.

export const KEY_COLOR = "#FF00FF";
/** How magenta a pixel is: min(r, b) − g. Pure magenta 255, greys and skin ≈ 0. */
const magenta = (r: number, g: number, b: number) => Math.min(r, b) - g;
const KEY_LOW = 45;
const KEY_HIGH = 120;
/** Translucent pixels this far from any background are magenta painted on the figure itself. */
const INTERIOR = 3;

export type Rgba = { readonly data: Buffer; readonly width: number; readonly height: number };

export async function toRgba(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function fromRgba(image: Rgba): Promise<Buffer> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer();
}

/** Keys magenta to alpha, removes the magenta cast it leaves everywhere (despill) and drops floating specks. */
export function keyOut(image: Rgba): Rgba {
  const data = Buffer.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const m = magenta(data[i], data[i + 1], data[i + 2]);
    const alpha = m <= KEY_LOW ? 1 : m >= KEY_HIGH ? 0 : 1 - (m - KEY_LOW) / (KEY_HIGH - KEY_LOW);
    if (m > 0) {
      data[i] = Math.max(0, data[i] - m);
      data[i + 2] = Math.max(0, data[i + 2] - m);
    }
    data[i + 3] = Math.round(Math.min(data[i + 3] / 255, alpha) * 255);
  }
  const keyed = { data, width: image.width, height: image.height };
  const { labels, sizes } = components(keyed);
  const largest = Math.max(0, ...sizes);
  for (let p = 0; p < labels.length; p++) {
    const label = labels[p];
    if (label > 0 && sizes[label - 1] < largest * 0.005) data[p * 4 + 3] = 0;
  }
  return keyed;
}

/** 4-connected components of pixels with alpha ≥ 50 %. Labels start at 1. */
export function components(image: Rgba): { labels: Int32Array; sizes: number[] } {
  const { width, height, data } = image;
  const labels = new Int32Array(width * height);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] < 128) continue;
    const label = sizes.length + 1;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < labels.length && !labels[q] && data[q * 4 + 3] >= 128) { labels[q] = label; stack.push(q); }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Pixels within `radius` of a (nearly) transparent one: the figure's outline, where soft alpha belongs. */
function nearTransparent(image: Rgba, radius: number): Uint8Array {
  const { width, height, data } = image;
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) { if (data[(y * width + x) * 4 + 3] < 24) last = x; if (x - last <= radius) rows[y * width + x] = 1; }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (data[(y * width + x) * 4 + 3] < 24) last = x; if (last - x <= radius) rows[y * width + x] = 1; }
  }
  const near = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) { if (rows[y * width + x]) last = y; if (y - last <= radius) near[y * width + x] = 1; }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (rows[y * width + x]) last = y; if (last - y <= radius) near[y * width + x] = 1; }
  }
  return near;
}

export function checkAlpha(image: Rgba): Check {
  const { width, height, data } = image;
  const total = width * height;
  const margin = 2;
  let opaque = 0;
  let edge = 0;
  const near = nearTransparent(image, INTERIOR);
  let spill = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 24 && data[i + 3] < 232 && !near[y * width + x]) spill++;
      if (data[i + 3] < 128) continue;
      opaque++;
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) edge++;
    }
  }
  const corners = [0, width - 1, (height - 1) * width, total - 1].every((p) => data[p * 4 + 3] === 0);
  const { sizes } = components(image);
  const largest = Math.max(0, ...sizes);
  const problems: string[] = [];
  const fixes: string[] = [];
  const share = opaque / total;
  if (!corners) { problems.push("background not removed at the corners"); fixes.push(`Paint the entire background flat ${KEY_COLOR} magenta, no floor, shadow or scenery.`); }
  if (share < 0.03) { problems.push(`figure too small (${(share * 100).toFixed(1)} % of canvas)`); fixes.push("Draw the character large, filling most of the height."); }
  if (share > 0.7) { problems.push(`figure fills ${(share * 100).toFixed(0)} % of canvas`); fixes.push(`Leave flat ${KEY_COLOR} magenta background around the character.`); }
  if (edge > 0) { problems.push(`figure touches the canvas edge (${edge} px)`); fixes.push("Keep the whole character inside the frame with a margin; nothing cropped."); }
  if (spill > opaque * 0.0005) { problems.push(`${spill} px of magenta painted inside the figure`); fixes.push(`Do not use magenta or pink anywhere on the character; ${KEY_COLOR} is only for the background.`); }
  if (largest < opaque * 0.97) { problems.push(`figure is in ${sizes.length} separate pieces`); fixes.push("Draw one connected character, no floating parts or extra objects."); }
  const passed = problems.length === 0;
  return {
    name: "alpha",
    passed,
    detail: passed ? `clean cutout, figure ${(share * 100).toFixed(1)} % of canvas` : problems.join("; "),
    score: Math.round(share * 1000) / 1000,
    ...(passed ? {} : { feedback: fixes.join(" ") }),
  };
}
