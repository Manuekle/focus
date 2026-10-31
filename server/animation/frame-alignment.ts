import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { actionSpec, type AnimationAction, type DrawingId, type FlipbookAlignment } from "../../shared/flipbook";
import { AppError } from "../errors";
import { readMetaConfig } from "../ai/meta";
import { segmentImage } from "../ai/sam";

// Raw drawings are not animation frames yet. This module cuts the character
// out of each opaque Muse Image drawing, measures it, and registers every
// drawing on one shared sprite cell: same canvas, same scale, feet on the
// same ground line, torso on the same vertical. Body height per pose follows
// the plan's bob chart, so the head rises and falls on purpose, not because
// a drawing came out a little larger.

export const CELL_HEIGHT = 768;
export const TARGET_HEIGHT = 600;
export const BASELINE_Y = 712;
const CELL_MARGIN = 28;
const MIN_CELL_WIDTH = 512;
const MAX_CELL_WIDTH = 1280;

export const MeasureSchema = z.object({
  rawWidth: z.number().int().positive(),
  rawHeight: z.number().int().positive(),
  /** Cut-out box inside the raw drawing. */
  crop: z.object({ left: z.number().int(), top: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }),
  /** In crop coordinates. */
  topY: z.number(),
  footY: z.number(),
  torsoX: z.number(),
  lowerSpan: z.number().nonnegative(),
  coverage: z.number().min(0).max(1),
  /** Like coverage, with the holes inside the outline counted: a white body cut from a white page by its line art. Older measures have none. */
  filled: z.number().min(0).max(1).optional(),
  touchesEdge: z.boolean(),
  /** 4×4×4 RGB histogram of the opaque subject pixels, sums to 1. */
  histogram: z.array(z.number()).length(64),
  method: z.enum(["sam", "key", "alpha"]),
  multiple: z.boolean(),
  /** Share of border pixels matching the dominant border color. */
  backgroundUniformity: z.number().min(0).max(1),
  /** Line-art cut-outs only: share of the subject lost through gaps in the line art (see leakShare). */
  leakShare: z.number().min(0).max(1).optional(),
});
export type Measure = z.infer<typeof MeasureSchema>;

type Rgba = { readonly data: Buffer; readonly width: number; readonly height: number };

async function decodeRgba(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Median color of the image border and how much of the border matches it. */
function borderStats({ data, width, height }: Rgba): { rgb: [number, number, number]; uniformity: number } {
  const samples: [number, number, number][] = [];
  const push = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    samples.push([data[offset], data[offset + 1], data[offset + 2]]);
  };
  const stepX = Math.max(1, Math.floor(width / 256));
  const stepY = Math.max(1, Math.floor(height / 256));
  for (let x = 0; x < width; x += stepX) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { push(0, y); push(width - 1, y); }
  const median = (channel: number) => samples.map((sample) => sample[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const rgb: [number, number, number] = [median(0), median(1), median(2)];
  const close = samples.filter((sample) => Math.hypot(sample[0] - rgb[0], sample[1] - rgb[1], sample[2] - rgb[2]) < 40).length;
  return { rgb, uniformity: samples.length ? close / samples.length : 0 };
}

/** How far the key color's rim reaches into an opaque cut-out, in pixels. */
const SPILL_BAND = 3;

/**
 * Antialiased lines drawn on the key color keep a rim of it even where the
 * mask is opaque: a magenta fringe along blond hair. Within SPILL_BAND pixels
 * of the outline, each pixel loses the part of its chroma that points toward
 * the key's, beyond what the nearest pixel deeper inside has. Luminance stays;
 * hues away from the key, and the key's hue where the drawing really has it
 * inside, are untouched. Works in place on straight RGBA.
 */
export function despill(rgba: Buffer, width: number, height: number, key: readonly [number, number, number]): void {
  const keyGray = (key[0] + key[1] + key[2]) / 3;
  const kc = [key[0] - keyGray, key[1] - keyGray, key[2] - keyGray];
  const kn = kc[0] * kc[0] + kc[1] * kc[1] + kc[2] * kc[2];
  // A gray key has no hue to take out.
  if (kn < 900) return;
  const total = width * height;
  const along = (i: number) => {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mean = (r + g + b) / 3;
    return ((r - mean) * kc[0] + (g - mean) * kc[1] + (b - mean) * kc[2]) / kn;
  };
  const neighbors = (i: number, visit: (n: number) => void) => {
    const x = i % width, y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx);
    }
  };
  // Steps to the outside (alpha below half), breadth-first; 255 is deeper than the band.
  const distance = new Uint8Array(total).fill(255);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] < 128) { distance[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    if (distance[i] >= SPILL_BAND) continue;
    neighbors(i, (n) => { if (distance[n] === 255) { distance[n] = distance[i] + 1; queue[tail++] = n; } });
  }
  // The band takes its reference hue from the nearest pixel inside it.
  const reference = new Float32Array(total).fill(Number.NaN);
  head = 0; tail = 0;
  for (let i = 0; i < total; i++) if (distance[i] === 255) { reference[i] = along(i); queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    neighbors(i, (n) => { if (distance[n] !== 255 && Number.isNaN(reference[n])) { reference[n] = reference[i]; queue[tail++] = n; } });
  }
  for (let i = 0; i < total; i++) {
    const a = rgba[i * 4 + 3];
    if (distance[i] === 255 || a === 0) continue;
    const ref = Number.isNaN(reference[i]) ? 0 : reference[i];
    const value = along(i);
    let excess = value - Math.max(0, ref);
    // A soft edge un-blended with a mask alpha that was too low overshoots
    // past the inside, away from the key (a green rim on a magenta key): pull it back.
    if (excess <= 0) excess = a < 255 ? Math.min(0, value - Math.min(0, ref)) : 0;
    if (excess === 0) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(rgba[i * 4 + c] - excess * kc[c])));
  }
}

/** Background by flood fill from the border: only color connected to the edge counts as background. */
function keyMask({ data, width, height }: Rgba, background: readonly [number, number, number], options: { tolerance?: number; walls?: Uint8Array } = {}): Uint8Array {
  const total = width * height;
  const isBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const tolerance = options.tolerance ?? 52;
  const walls = options.walls;
  const near = (index: number) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) < tolerance;
  };
  const seed = (index: number) => {
    if (!isBackground[index] && !walls?.[index] && near(index)) { isBackground[index] = 1; queue[tail++] = index; }
  };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (index >= width) seed(index - width);
    if (index < total - width) seed(index + width);
  }
  const mask = new Uint8Array(total);
  for (let index = 0; index < total; index++) mask[index] = isBackground[index] ? 0 : 255;
  return mask;
}

const luma = (data: Buffer, index: number) => 0.2126 * data[index * 4] + 0.7152 * data[index * 4 + 1] + 0.0722 * data[index * 4 + 2];

/**
 * The drawing's line art as a barrier: pixels much darker than the
 * background, grown by `grow` pixels so the border fill can't slip through
 * the soft, broken lines of a compressed video frame. A white shirt on a
 * white background is still enclosed by its outline.
 */
function lineWalls(image: Rgba, background: readonly [number, number, number], grow: number): Uint8Array {
  const { data, width, height } = image;
  const total = width * height;
  const backgroundLuma = 0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2];
  let walls = new Uint8Array(total);
  for (let index = 0; index < total; index++) if (backgroundLuma - luma(data, index) > 70) walls[index] = 1;
  for (let step = 0; step < grow; step++) {
    const next = new Uint8Array(walls);
    for (let index = 0; index < total; index++) {
      if (!walls[index]) continue;
      const x = index % width;
      if (x > 0) next[index - 1] = 1;
      if (x < width - 1) next[index + 1] = 1;
      if (index >= width) next[index - width] = 1;
      if (index < total - width) next[index + width] = 1;
    }
    walls = next;
  }
  return walls;
}

/**
 * How much of the subject a line-art fill lost through gaps in the line
 * art: the same fill with lines grown one pixel thicker, compared by area.
 * Near 0 when the outline is closed; a white shirt drained through a broken
 * line on a white background shows up as a large share.
 */
function leakShare(image: Rgba, background: readonly [number, number, number], mask: Uint8Array): number {
  const thicker = lineWalls(image, background, 2);
  const tighter = keyMask(image, background, { tolerance: 28, walls: thicker });
  let lost = 0;
  let sealed = 0;
  for (let index = 0; index < mask.length; index++) {
    if (tighter[index] < 128) continue;
    sealed++;
    // The thicker lines themselves are always kept by the tighter fill: only what lies beyond them counts.
    if (mask[index] < 128 && !thicker[index]) lost++;
  }
  return sealed ? lost / sealed : 0;
}

/**
 * Background showing through gaps the border fill can't reach (between the
 * legs, inside a bent arm, between strands of hair). A gap is a connected run
 * of near-exact key color inside the mask. The key is picked away from the
 * character's palette, so a run of a few dozen pixels is already background
 * (SAM keeps those slivers in its mask); only stray single pixels stay.
 */
function removeEnclosedBackground(mask: Uint8Array, { data, width, height }: Rgba, background: readonly [number, number, number]): Uint8Array {
  const total = width * height;
  const minArea = 24;
  const near = (index: number) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) < 30;
  };
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const members: number[] = [];
  for (let start = 0; start < total; start++) {
    if (seen[start] || mask[start] < 128 || !near(start)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    members.length = 0;
    while (head < tail) {
      const index = queue[head++];
      members.push(index);
      const x = index % width;
      const visit = (next: number) => {
        if (!seen[next] && mask[next] >= 128 && near(next)) { seen[next] = 1; queue[tail++] = next; }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index < total - width) visit(index + width);
    }
    if (members.length >= minArea) for (const index of members) out[index] = 0;
  }
  return out;
}

/** Keeps connected parts of the mask that matter: the body plus detached pieces at least 2% of its size. */
function keepMainComponents(mask: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const labels = new Int32Array(total);
  const sizes: number[] = [0];
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (mask[start] < 128 || labels[start]) continue;
    const label = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let size = 0;
    while (head < tail) {
      const index = queue[head++];
      size++;
      const x = index % width;
      const visit = (next: number) => {
        if (mask[next] >= 128 && !labels[next]) { labels[next] = label; queue[tail++] = next; }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index < total - width) visit(index + width);
    }
    sizes.push(size);
  }
  const largest = Math.max(0, ...sizes);
  const keep = sizes.map((size) => size >= largest * 0.02);
  const out = new Uint8Array(total);
  for (let index = 0; index < total; index++) if (labels[index] && keep[labels[index]]) out[index] = 255;
  return out;
}

/** One pixel of erosion, then a small blur: drops the background fringe and softens SAM's stair steps. */
function refineEdges(mask: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mask[index] < 128) continue;
      const solid = (x === 0 || mask[index - 1] >= 128) && (x === width - 1 || mask[index + 1] >= 128) && (y === 0 || mask[index - width] >= 128) && (y === height - 1 || mask[index + width] >= 128);
      eroded[index] = solid ? 255 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += eroded[yy * width + xx];
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

export type Extraction = { readonly cutout: Buffer; readonly measure: Measure };

/** The concepts tried in order: the phrase, its head noun ("boy in red hoodie" → "boy"), then "character". */
export function segmentationConcepts(concept: string): string[] {
  const head = concept.split(/\s+(?:with|in|wearing|holding|on|and|of)\s+/i)[0].trim().split(/\s+/).at(-1) ?? "";
  return [...new Set([concept.trim(), head, "character"].filter(Boolean))];
}

/** Replaceable in tests: null means no SAM call ever runs. */
export const segmentation: { segment: typeof segmentImage | null } = { segment: segmentImage };

/**
 * Cuts the character out of one drawing. Real transparency is used when the
 * image has it; otherwise SAM 3.1 segments the subject; when SAM is not
 * available or finds nothing usable, the flat key background is removed by a
 * flood fill from the border. Each path is recorded in the measure; a drawing
 * none of them can separate fails loudly instead of becoming a fake sprite.
 */
export async function extractSubject(input: {
  readonly png: Buffer;
  readonly concept: string;
  readonly flipbookId: string;
  readonly allowAlpha: boolean;
  /** False skips SAM (a paid call per image): only real transparency or a flat key background. */
  readonly useSegmentation?: boolean;
  /**
   * "lineart" for frames rendered elsewhere (Reference Motion): their
   * background color can also be the character's (a white shirt on white),
   * so the key fill is stopped by the line art and nothing inside the body
   * is removed. "drawing" (default) is Muse Image's key, picked away from
   * the character's palette.
   */
  readonly keyMode?: "drawing" | "lineart";
  /**
   * A drawing of several characters: every figure SAM finds is kept (the
   * union of its masks), not just the largest. It stops looking once it has
   * found as many figures as `expected`.
   */
  readonly group?: { readonly concepts: readonly string[]; readonly expected: number };
  readonly signal?: AbortSignal;
}): Promise<Extraction> {
  const image = await decodeRgba(input.png);
  const { width, height, data } = image;
  const total = width * height;
  const border = borderStats(image);

  let mask: Uint8Array | null = null;
  let leak: number | undefined;
  let method: Measure["method"] = "key";
  let multiple = false;

  if (input.allowAlpha) {
    let transparent = 0;
    for (let index = 0; index < total; index++) if (data[index * 4 + 3] < 250) transparent++;
    if (transparent > total * 0.01) {
      mask = new Uint8Array(total);
      for (let index = 0; index < total; index++) mask[index] = data[index * 4 + 3];
      method = "alpha";
    }
  }

  if (!mask && input.useSegmentation !== false && segmentation.segment && readMetaConfig()) {
    try {
      if (input.group) {
        const found = await segmentGroup({ png: input.png, width, height, concepts: input.group.concepts, expected: input.group.expected, flipbookId: input.flipbookId, signal: input.signal });
        if (found) { mask = found; method = "sam"; }
      }
      // A detailed phrase ("girl with horse ears") can match nothing: fall back to its head noun, then to "character".
      if (!input.group) for (const concept of segmentationConcepts(input.concept)) {
        const masks = (await segmentation.segment({ png: input.png, width, height, concept, flipbookId: input.flipbookId, signal: input.signal }))
          .filter((candidate) => candidate.area > total * 0.005 && candidate.area < total * 0.92);
        if (!masks.length) continue;
        mask = masks[0].alpha;
        method = "sam";
        multiple = masks.length > 1 && masks[1].area > masks[0].area * 0.15;
        break;
      }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof AppError && error.code === "canceled")) throw error;
      console.warn("[focus] flipbook: SAM image segmentation failed, using the key background", error instanceof Error ? error.message : error);
    }
  }

  if (!mask) {
    if (border.uniformity < 0.85) {
      throw new AppError("extraction_failed", 422, "We couldn’t separate the character from this drawing’s background. Redraw it, or upload a drawing on a plain background.");
    }
    const lineart = input.keyMode === "lineart";
    mask = keyMask(image, border.rgb, lineart ? { tolerance: 28, walls: lineWalls(image, border.rgb, 1) } : {});
    if (lineart) leak = leakShare(image, border.rgb, mask);
    method = "key";
  }

  // With a known flat key away from the palette, gaps enclosed by the body are background too.
  // Line-art cut-outs keep them: there the background color can be part of the character.
  const opened = method !== "alpha" && border.uniformity >= 0.85 && input.keyMode !== "lineart" ? removeEnclosedBackground(mask, image, border.rgb) : mask;
  const cleaned = method === "alpha" ? mask : refineEdges(keepMainComponents(opened, width, height), width, height);
  return measureAndCut(image, cleaned, { method, multiple, background: border, leakShare: leak });
}

/**
 * A drawing Muse Image painted on a flat key color (every generated drawing
 * is): cut out locally, by the key, which costs nothing and takes a fraction
 * of a second. SAM 3.1, a paid call per image, is only the way out for one
 * the key can't separate, so a whole animation uses it once (the character's
 * own reference) plus the odd drawing that needs it.
 */
export async function extractKeyed(input: Parameters<typeof extractSubject>[0]): Promise<Extraction> {
  try {
    const keyed = await extractSubject({ ...input, useSegmentation: false });
    if (keyed.measure.coverage > 0.01) return keyed;
  } catch (error) {
    const recoverable = error instanceof AppError && (error.code === "extraction_failed" || error.code === "no_subject");
    if (!recoverable) throw error;
  }
  return extractSubject({ ...input, useSegmentation: true });
}

/** The union of the figures SAM finds for each concept, until `expected` figures were found. Null when it finds none. */
async function segmentGroup(input: { readonly png: Buffer; readonly width: number; readonly height: number; readonly concepts: readonly string[]; readonly expected: number; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<Uint8Array | null> {
  const total = input.width * input.height;
  let union: Uint8Array | null = null;
  let figures = 0;
  for (const concept of input.concepts) {
    const masks = (await segmentation.segment!({ png: input.png, width: input.width, height: input.height, concept, flipbookId: input.flipbookId, signal: input.signal }))
      .filter((candidate) => candidate.area > total * 0.005 && candidate.area < total * 0.92);
    for (const candidate of masks) {
      union ??= new Uint8Array(total);
      for (let index = 0; index < total; index++) if (candidate.alpha[index] > union[index]) union[index] = candidate.alpha[index];
      figures++;
    }
    if (figures >= input.expected) break;
  }
  return union;
}

export async function measureAndCut(image: Rgba, alpha: Uint8Array, info: { method: Measure["method"]; multiple: boolean; background: { rgb: [number, number, number]; uniformity: number }; leakShare?: number }): Promise<Extraction> {
  const { width, height, data } = image;
  let left = width, right = -1, top = height, bottom = -1, opaque = 0;
  const rowCounts = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < 128) continue;
      opaque++;
      rowCounts[y]++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (opaque < width * height * 0.003 || right < left || bottom < top) {
    throw new AppError("no_subject", 422, "This drawing doesn’t contain a recognizable character. Redraw it.");
  }
  // The feet: the lowest rows that hold more than a stray pixel or two.
  let foot = bottom;
  while (foot > top && rowCounts[foot] < 3) foot--;
  const subjectHeight = foot - top + 1;

  // Torso column: median x of the subject between shoulders and hips, where
  // swinging legs don't reach. The median ignores a thin arm thrown forward
  // (a jab, a running arm swing) that would drag a mean toward it.
  const columns = new Uint32Array(right - left + 1);
  let countX = 0;
  for (let y = Math.round(top + subjectHeight * 0.12); y <= Math.round(top + subjectHeight * 0.5); y++) {
    for (let x = left; x <= right; x++) if (alpha[y * width + x] >= 128) { columns[x - left]++; countX++; }
  }
  let torsoX = (left + right) / 2;
  if (countX) {
    let seen = 0;
    for (let index = 0; index < columns.length; index++) {
      seen += columns[index];
      if (seen * 2 >= countX) { torsoX = left + index; break; }
    }
  }

  let spanLeft = Infinity, spanRight = -Infinity;
  for (let y = Math.round(foot - subjectHeight * 0.06); y <= foot; y++) {
    for (let x = left; x <= right; x++) if (alpha[y * width + x] >= 128) { if (x < spanLeft) spanLeft = x; if (x > spanRight) spanRight = x; }
  }
  const lowerSpan = Number.isFinite(spanLeft) ? spanRight - spanLeft + 1 : 0;

  const histogram = new Array<number>(64).fill(0);
  let histTotal = 0;
  for (let index = 0; index < width * height; index++) {
    if (alpha[index] < 200) continue;
    const offset = index * 4;
    histogram[(data[offset] >> 6) * 16 + (data[offset + 1] >> 6) * 4 + (data[offset + 2] >> 6)]++;
    histTotal++;
  }

  const pad = 2;
  const crop = { left: Math.max(0, left - pad), top: Math.max(0, top - pad), width: 0, height: 0 };
  crop.width = Math.min(width, right + pad + 1) - crop.left;
  crop.height = Math.min(height, bottom + pad + 1) - crop.top;

  // Edge pixels still carry the flat background blended in. When that
  // background is known, un-blend it so the sprite has no light or dark halo.
  const decontaminate = info.method !== "alpha" && info.background.uniformity >= 0.85;
  const [br, bg, bb] = info.background.rgb;
  const cut = Buffer.alloc(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const source = (crop.top + y) * width + crop.left + x;
      const target = (y * crop.width + x) * 4;
      const a = alpha[source];
      let r = data[source * 4], g = data[source * 4 + 1], b = data[source * 4 + 2];
      if (decontaminate && a > 0 && a < 255) {
        const k = a / 255;
        r = Math.max(0, Math.min(255, Math.round((r - (1 - k) * br) / k)));
        g = Math.max(0, Math.min(255, Math.round((g - (1 - k) * bg) / k)));
        b = Math.max(0, Math.min(255, Math.round((b - (1 - k) * bb) / k)));
      }
      cut[target] = r; cut[target + 1] = g; cut[target + 2] = b;
      cut[target + 3] = info.method === "alpha" ? Math.min(a, data[source * 4 + 3]) : a;
    }
  }
  if (decontaminate) despill(cut, crop.width, crop.height, info.background.rgb);
  const cutout = await sharp(cut, { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer();
  const edge = 2;
  return {
    cutout,
    measure: {
      rawWidth: width,
      rawHeight: height,
      crop,
      topY: top - crop.top,
      footY: foot - crop.top,
      torsoX: torsoX - crop.left,
      lowerSpan,
      coverage: opaque / (width * height),
      filled: filledArea(alpha, width, { left, top, right, bottom }) / (width * height),
      touchesEdge: left < edge || top < edge || right >= width - edge || bottom >= height - edge,
      histogram: histogram.map((count) => (histTotal ? count / histTotal : 0)),
      method: info.method,
      multiple: info.multiple,
      backgroundUniformity: info.background.uniformity,
      ...(info.leakShare !== undefined ? { leakShare: Number(info.leakShare.toFixed(4)) } : {}),
    },
  };
}


// ── Registration ───────────────────────────────────────────────────────────

export type AlignInput = {
  /** A key drawing or an in-between: both are registered on the same cell. */
  readonly frameId: DrawingId;
  readonly version: string;
  readonly phase: string;
  readonly relativeRootY: number;
  /** Feet above the ground line, share of body height (a run's flight). */
  readonly lift?: number;
  readonly measure: Measure;
};

function transformKey(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Scale that puts this drawing at the pose's height on the bob chart. */
export function poseScale(entry: Pick<AlignInput, "relativeRootY" | "measure">): number {
  const height = Math.max(1, entry.measure.footY - entry.measure.topY + 1);
  return (TARGET_HEIGHT * (1 + entry.relativeRootY)) / height;
}

/**
 * One cell for every drawing. The cell only grows (never shrinks) across
 * re-alignments, so redrawing one frame never shifts the approved ones.
 */
export function computeAlignment(entries: readonly AlignInput[], previous: FlipbookAlignment | null, action: AnimationAction = "walk", view: string = "side"): FlipbookAlignment {
  const spec = actionSpec(action);
  let needHalf = MIN_CELL_WIDTH / 2 - CELL_MARGIN;
  const placed = entries.map((entry) => {
    const scale = poseScale(entry);
    const { crop, torsoX } = entry.measure;
    needHalf = Math.max(needHalf, torsoX * scale, (crop.width - torsoX) * scale);
    return { entry, scale };
  });
  const fitted = Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, Math.ceil((needHalf + CELL_MARGIN) / 2) * 4));
  const cellWidth = previous && previous.cellHeight === CELL_HEIGHT ? Math.min(MAX_CELL_WIDTH, Math.max(previous.cellWidth, fitted)) : fitted;

  const transforms: FlipbookAlignment["transforms"] = {};
  for (const { entry, scale } of placed) {
    const left = Math.round(cellWidth / 2 - entry.measure.torsoX * scale);
    const top = Math.round(BASELINE_Y - (entry.measure.footY + 1) * scale - (entry.lift ?? 0) * TARGET_HEIGHT);
    transforms[entry.frameId] = { version: entry.version, scale: Number(scale.toFixed(6)), left, top, key: transformKey([entry.version, scale.toFixed(6), left, top, cellWidth, CELL_HEIGHT]) };
  }

  // Stride: at contact both feet are down (heel ahead, toes behind); at
  // passing only one foot is. The difference of their ground spans is one step.
  const span = (phases: readonly string[]) => {
    const values = placed.filter(({ entry }) => phases.includes(entry.phase)).map(({ entry, scale }) => entry.measure.lowerSpan * scale);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  // Only the walk has both feet planted at contact; a run's stride and a
  // fight (no travel) use the action's own figure.
  const contact = spec.stride?.contact.length ? span(spec.stride.contact) : null;
  const passing = spec.stride?.passing.length ? span(spec.stride.passing) : null;
  const step = contact !== null && passing !== null ? contact - passing : null;
  const strideMeasured = view === "side" && step !== null && step >= TARGET_HEIGHT * 0.1 && step <= TARGET_HEIGHT * 0.8;
  return {
    cellWidth,
    cellHeight: CELL_HEIGHT,
    baselineY: BASELINE_Y,
    targetHeight: TARGET_HEIGHT,
    strideX: Math.round(strideMeasured ? 2 * step! : (spec.stride?.fallback ?? 0) * TARGET_HEIGHT),
    strideMeasured,
    transforms,
  };
}

/**
 * Registration of a scene: the camera is fixed, so no drawing is moved to
 * match another. Each keeps the place it was drawn at, all at one scale (the
 * cell is the drawing's own frame, CELL_HEIGHT tall), so the characters move
 * inside it and only by what the drawings show.
 */
export function computeEnsembleAlignment(entries: readonly AlignInput[]): FlipbookAlignment {
  const scaleOf = (entry: AlignInput) => CELL_HEIGHT / entry.measure.rawHeight;
  const cellWidth = Math.max(1, ...entries.map((entry) => Math.round(entry.measure.rawWidth * scaleOf(entry))));
  const transforms: FlipbookAlignment["transforms"] = {};
  for (const entry of entries) {
    const scale = scaleOf(entry);
    const { crop, rawWidth } = entry.measure;
    // A drawing a little narrower than the cell stays centered in it.
    const left = Math.round(crop.left * scale + (cellWidth - rawWidth * scale) / 2);
    const top = Math.round(crop.top * scale);
    transforms[entry.frameId] = { version: entry.version, scale: Number(scale.toFixed(6)), left, top, key: transformKey([entry.version, scale.toFixed(6), left, top, cellWidth, CELL_HEIGHT]) };
  }
  return { cellWidth, cellHeight: CELL_HEIGHT, baselineY: CELL_HEIGHT, targetHeight: CELL_HEIGHT, strideX: 0, strideMeasured: false, transforms };
}

/**
 * Pose to pose: one fixed ground line and one size for the whole action,
 * whatever framing Muse Image drew each pose in. The size comes from the
 * silhouette's filled area, which squash and stretch keep, so a crouch stays low
 * and a stretch tall; the first drawing sets the standing height. Each
 * drawing is raised by its planned lift, torso centered, so a jump leaves
 * the ground. The whole action shrinks just enough to keep its highest
 * pose inside the cell.
 */
export function computeTimedAlignment(entries: readonly (AlignInput & { readonly lift: number })[]): FlipbookAlignment {
  const area = (entry: AlignInput) => Math.max(1, (entry.measure.filled ?? entry.measure.coverage) * entry.measure.rawWidth * entry.measure.rawHeight);
  const areas = entries.map(area).sort((a, b) => a - b);
  const typical = areas[Math.floor(areas.length / 2)] ?? 1;
  // Cell pixels per drawn pixel, up to one factor k for the whole action.
  const relative = entries.map((entry) => Math.sqrt(typical / area(entry)));
  const drawn = entries.map((entry) => Math.max(1, entry.measure.footY - entry.measure.topY + 1));
  const standing = drawn[0] * relative[0];
  const reach = Math.max(1, ...entries.map((entry, index) => drawn[index] * relative[index] + entry.lift * standing));
  const k = Math.min(TARGET_HEIGHT / standing, (BASELINE_Y - CELL_MARGIN) / reach);
  const placed = entries.map((entry, index) => ({ entry, scale: k * relative[index] }));
  const half = Math.max(MIN_CELL_WIDTH / 2 - CELL_MARGIN, ...placed.map(({ entry, scale }) => Math.max(entry.measure.torsoX, entry.measure.crop.width - entry.measure.torsoX) * scale));
  const cellWidth = Math.min(MAX_CELL_WIDTH, Math.ceil((half + CELL_MARGIN) / 2) * 4);
  const transforms: FlipbookAlignment["transforms"] = {};
  for (const { entry, scale } of placed) {
    const left = Math.round(cellWidth / 2 - entry.measure.torsoX * scale);
    const top = Math.round(BASELINE_Y - entry.lift * standing * k - (entry.measure.footY + 1) * scale);
    transforms[entry.frameId] = { version: entry.version, scale: Number(scale.toFixed(6)), left, top, key: transformKey(["timed", entry.version, scale.toFixed(6), left, top, cellWidth, CELL_HEIGHT]) };
  }
  return { cellWidth, cellHeight: CELL_HEIGHT, baselineY: BASELINE_Y, targetHeight: Math.max(1, Math.round(standing * k)), strideX: 0, strideMeasured: false, transforms };
}

/** Opaque pixels plus the transparent ones the outline encloses: everything in the box not reachable from its border. */
export function filledArea(alpha: ArrayLike<number>, width: number, box: { left: number; top: number; right: number; bottom: number }): number {
  const w = box.right - box.left + 3, h = box.bottom - box.top + 3;
  // A one-pixel transparent margin around the box, so the outside is one connected region.
  const outside = new Uint8Array(w * h);
  const open = (x: number, y: number) => {
    const sx = x + box.left - 1, sy = y + box.top - 1;
    return sx < box.left || sx > box.right || sy < box.top || sy > box.bottom || alpha[sy * width + sx] < 128;
  };
  const stack = [0];
  outside[0] = 1;
  let reached = 0;
  while (stack.length) {
    const index = stack.pop()!;
    reached++;
    const x = index % w, y = (index - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const next = ny * w + nx;
      if (!outside[next] && open(nx, ny)) { outside[next] = 1; stack.push(next); }
    }
  }
  return w * h - reached;
}

/** Places an image on a transparent canvas, clipping whatever falls outside. */
export async function placeOnCanvas(overlay: Buffer, at: { left: number; top: number }, canvas: { width: number; height: number }): Promise<Buffer> {
  const meta = await sharp(overlay).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const x0 = Math.max(0, at.left), y0 = Math.max(0, at.top);
  const x1 = Math.min(canvas.width, at.left + width), y1 = Math.min(canvas.height, at.top + height);
  const base = sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (x1 <= x0 || y1 <= y0) return base.png().toBuffer();
  const visible = await sharp(overlay).extract({ left: x0 - at.left, top: y0 - at.top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
  return base.composite([{ input: visible, left: x0, top: y0 }]).png().toBuffer();
}

/** The aligned sprite: the cut-out scaled and registered on the shared cell. */
export async function renderSprite(cutout: Buffer, measure: Measure, transform: { scale: number; left: number; top: number }, cell: { width: number; height: number }): Promise<Buffer> {
  const width = Math.max(1, Math.round(measure.crop.width * transform.scale));
  const height = Math.max(1, Math.round(measure.crop.height * transform.scale));
  const scaled = await sharp(cutout).resize(width, height, { kernel: "lanczos3", fit: "fill" }).png().toBuffer();
  return placeOnCanvas(scaled, { left: transform.left, top: transform.top }, cell);
}
