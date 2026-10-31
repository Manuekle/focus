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
/** A loose piece this big besides the figure (px on the 1024×1536 canvas) fails the cut-out: a torn-off shard, not specks. */
const LOOSE_PIECE = 150;

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
  dropSpecks(keyed);
  return keyed;
}

type Colour = readonly [number, number, number];
/** Squared RGB distance between pixel `i` of `data` and a colour. */
const far2 = (data: Buffer, i: number, c: Colour) => (data[i] - c[0]) ** 2 + (data[i + 1] - c[1]) ** 2 + (data[i + 2] - c[2]) ** 2;
const hex = (c: Colour) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The outer ring this wide (px) is where a flat background shows. */
const RING = 3;
/** Ring pixels this close (RGB distance) to the ring's median count as the same flat colour… */
const RING_CLOSE = 40;
/** …and this share of the ring must be, for the background to be flat. */
const RING_SHARE = 0.85;

/** The colour of the picture's background when it is flat along the border (the ring's median); null when it isn't. */
export function borderColour(image: Rgba): Colour | null {
  const { width, height, data } = image;
  const ring: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= RING && y >= RING && x < width - RING && y < height - RING) { x = width - RING - 1; continue; }
      ring.push((y * width + x) * 4);
    }
  }
  const median = (channel: number) => { const values = ring.map((i) => data[i + channel]).sort((a, b) => a - b); return values[values.length >> 1]; };
  const colour: Colour = [median(0), median(1), median(2)];
  const close = ring.filter((i) => far2(data, i, colour) <= RING_CLOSE ** 2).length;
  return close >= ring.length * RING_SHARE ? colour : null;
}

/** While flooding the background a pixel may differ this much from its neighbour (smooth gradients and vignettes)… */
const FLAT_STEP = 14;
/** …and never more than this from the border's colour. */
const FLAT_REACH = 90;
/** Background enclosed by the figure (between an arm and the body) is keyed when this close to the flood's colour… */
const FLAT_ENCLOSED = 32;
/** …in pieces at least this big, and only on a saturated background: a white or grey one is also what clothes are. */
const ENCLOSED_PIECE = 64;
/** At the background's edge alpha rises from 0 to 1 between these distances from its colour (anti-aliased outlines). */
const EDGE_LOW = 18;
const EDGE_HIGH = 80;

/**
 * Keys a flat background of any colour: flooded in from the border while it changes smoothly (so it never crosses the
 * outline), plus enclosed pieces of the same colour on a saturated background. The outline's anti-aliased pixels get
 * their alpha from how far they are from that colour, and the background is taken out of their colour.
 */
export function keyFlat(image: Rgba, background: Colour): Rgba {
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const n = width * height;
  const fill = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const sum = [0, 0, 0];
  const take = (p: number) => { fill[p] = 1; queue[tail++] = p; sum[0] += data[p * 4]; sum[1] += data[p * 4 + 1]; sum[2] += data[p * 4 + 2]; };
  for (let x = 0; x < width; x++) for (const p of [x, (height - 1) * width + x]) if (!fill[p] && far2(data, p * 4, background) < FLAT_REACH ** 2) take(p);
  for (let y = 0; y < height; y++) for (const p of [y * width, y * width + width - 1]) if (!fill[p] && far2(data, p * 4, background) < FLAT_REACH ** 2) take(p);
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const here: Colour = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q < 0 || q >= n || fill[q]) continue;
      if (far2(data, q * 4, here) < FLAT_STEP ** 2 && far2(data, q * 4, background) < FLAT_REACH ** 2) take(q);
    }
  }
  const mean: Colour = tail ? [sum[0] / tail, sum[1] / tail, sum[2] / tail] : background;
  const [max, min] = [Math.max(...mean), Math.min(...mean)];
  if (max >= 90 && (max - min) / max >= 0.35) {
    // Enclosed pieces: flat runs of the background's colour the flood couldn't reach.
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
      if (fill[start] || seen[start] || far2(data, start * 4, mean) >= FLAT_ENCLOSED ** 2) continue;
      const piece: number[] = [start];
      seen[start] = 1;
      for (let k = 0; k < piece.length; k++) {
        const p = piece[k];
        const x = p % width;
        for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
          if (q >= 0 && q < n && !seen[q] && !fill[q] && far2(data, q * 4, mean) < FLAT_ENCLOSED ** 2) { seen[q] = 1; piece.push(q); }
        }
      }
      if (piece.length >= ENCLOSED_PIECE) for (const p of piece) fill[p] = 1;
    }
  }
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (fill[p]) { data[i + 3] = 0; continue; }
    const x = p % width;
    const y = (p - x) / width;
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2 && !edge; dx++) {
      const [qx, qy] = [x + dx, y + dy];
      if (qx >= 0 && qy >= 0 && qx < width && qy < height && fill[qy * width + qx]) edge = true;
    }
    if (!edge) continue;
    const alpha = Math.min(1, Math.max(0, (Math.sqrt(far2(data, i, mean)) - EDGE_LOW) / (EDGE_HIGH - EDGE_LOW)));
    if (alpha > 0.05) for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(255, Math.max(0, (data[i + c] - (1 - alpha) * mean[c]) / alpha)));
    data[i + 3] = Math.round(Math.min(data[i + 3] / 255, alpha) * 255);
  }
  const keyed = { data, width, height };
  dropSpecks(keyed);
  return keyed;
}

/** Floating specks (pieces under 0.5 % of the figure) become transparent. */
function dropSpecks(image: Rgba): void {
  const { labels, sizes } = components(image);
  const largest = Math.max(0, ...sizes);
  for (let p = 0; p < labels.length; p++) {
    const label = labels[p];
    if (label > 0 && sizes[label - 1] < largest * 0.005) image.data[p * 4 + 3] = 0;
  }
}

/**
 * The generator's background keyed out, whatever flat colour it came back on: the usual magenta by keyOut, any other
 * flat border colour (a pink or crimson the model chose instead) by keyFlat. Returns the colour it keyed.
 */
export function keyBackground(image: Rgba): { readonly image: Rgba; readonly background: string } {
  const colour = borderColour(image);
  if (!colour || magenta(...colour) >= KEY_HIGH) return { image: keyOut(image), background: KEY_COLOR };
  return { image: keyFlat(image, colour), background: hex(colour) };
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
  // A shard the character rig tore off a limb is small: any loose piece the size of a fingertip or more counts.
  const loose = sizes.filter((size) => size !== largest && size >= LOOSE_PIECE);
  if (largest < opaque * 0.97 || loose.length) { problems.push(`figure is in ${sizes.length} separate pieces${loose.length ? ` (${loose.length} loose, the largest ${Math.max(...loose)} px)` : ""}`); fixes.push("Draw one connected character, no floating parts, torn fragments or extra objects."); }
  const passed = problems.length === 0;
  return {
    name: "alpha",
    passed,
    detail: passed ? `clean cutout, figure ${(share * 100).toFixed(1)} % of canvas` : problems.join("; "),
    score: Math.round(share * 1000) / 1000,
    ...(passed ? {} : { feedback: fixes.join(" ") }),
  };
}

/** Cuts narrower than twice this (px) are closed: a slit across a wrist, a notch where two pieces of the rig meet. */
const CUT_RADIUS = 6;
/** A cut is short (across a limb); a gap with more pixels than this is part of the pose (between the legs) and stays. */
const CUT_AREA = 600;

/**
 * Closes the character rig's cuts without redrawing anything, so the pose it got right can't move:
 * loose fragments (any piece but the figure, under LOOSE_PIECE × 20 px) are removed, and every short
 * gap a morphological closing of the silhouette fills (dilate, then erode, by CUT_RADIUS; at most
 * CUT_AREA px in one piece) is painted with the colour of the nearest pixel of the drawing, outlines
 * included, so an outline runs on across the filled slit. Wider or longer gaps, between an arm and
 * the body or between the legs, stay open.
 */
export function closeCuts(image: Rgba): { image: Rgba; filled: number; removed: number } {
  const { width, height, data } = image;
  const total = width * height;
  const out = Buffer.from(data);
  const { labels, sizes } = components(image);
  const largest = sizes.indexOf(Math.max(0, ...sizes)) + 1;
  let removed = 0;
  for (let p = 0; p < total; p++) {
    const label = labels[p];
    if (label && label !== largest && sizes[label - 1] < LOOSE_PIECE * 20) { out[p * 4 + 3] = 0; removed++; }
  }
  const solid = new Uint8Array(total);
  for (let p = 0; p < total; p++) solid[p] = out[p * 4 + 3] >= 128 ? 1 : 0;
  // One 4-neighbour step at a time, alternating with the diagonals, keeps the closing round enough.
  const step = (mask: Uint8Array, grow: boolean, diagonal: boolean) => {
    const next = new Uint8Array(mask);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] === (grow ? 1 : 0)) continue;
      const near = diagonal
        ? [[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]
        : [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of near) {
        // Off the canvas counts as background when growing, as figure when shrinking: the canvas edge never cuts.
        const value = nx < 0 || ny < 0 || nx >= width || ny >= height ? (grow ? 0 : 1) : mask[ny * width + nx];
        if (value === (grow ? 1 : 0)) { next[p] = grow ? 1 : 0; break; }
      }
    }
    return next;
  };
  let closed = solid;
  for (let i = 0; i < CUT_RADIUS; i++) closed = step(closed, true, i % 2 === 1);
  for (let i = 0; i < CUT_RADIUS; i++) closed = step(closed, false, i % 2 === 1);
  // The gaps, one connected piece at a time: only short ones are cuts.
  const gap = new Uint8Array(total);
  for (let p = 0; p < total; p++) gap[p] = closed[p] && !solid[p] ? 1 : 0;
  const seen = new Uint8Array(total);
  let frontier: number[] = [];
  for (let start = 0; start < total; start++) {
    if (!gap[start] || seen[start]) continue;
    const piece: number[] = [start];
    seen[start] = 1;
    for (let i = 0; i < piece.length; i++) {
      const p = piece[i];
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q >= 0 && q < total && gap[q] && !seen[q]) { seen[q] = 1; piece.push(q); }
      }
    }
    if (piece.length <= CUT_AREA) frontier.push(...piece);
  }
  // Fill the cuts from their edges inward, each pixel taking a filled or original neighbour's colour.
  const filled = frontier.length;
  const done = new Uint8Array(solid);
  while (frontier.length) {
    const waiting: number[] = [];
    const now: [number, number][] = [];
    for (const p of frontier) {
      const x = p % width;
      const source = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width].find((q) => q >= 0 && q < total && done[q]);
      if (source === undefined) waiting.push(p); else now.push([p, source]);
    }
    if (!now.length) break;
    for (const [p, source] of now) {
      out[p * 4] = out[source * 4]; out[p * 4 + 1] = out[source * 4 + 1]; out[p * 4 + 2] = out[source * 4 + 2]; out[p * 4 + 3] = 255;
    }
    for (const [p] of now) done[p] = 1;
    frontier = waiting;
  }
  // The soft edge the cut used to have is inside the figure now: make it solid, or it reads as spill.
  for (let p = 0; p < total; p++) {
    if (!done[p] || solid[p] || out[p * 4 + 3] !== 255) continue;
    const [x, y] = [p % width, Math.floor(p / width)];
    for (let dy = -INTERIOR; dy <= INTERIOR; dy++) for (let dx = -INTERIOR; dx <= INTERIOR; dx++) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (out[q * 4 + 3] > 0 && out[q * 4 + 3] < 255 && closed[q]) out[q * 4 + 3] = 255;
    }
  }
  return { image: { data: out, width, height }, filled, removed };
}
