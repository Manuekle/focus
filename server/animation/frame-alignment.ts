import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { actionSpec, type AnimationAction, type FlipbookAlignment, type FrameId } from "../../shared/flipbook";
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
  touchesEdge: z.boolean(),
  /** 4×4×4 RGB histogram of the opaque subject pixels, sums to 1. */
  histogram: z.array(z.number()).length(64),
  method: z.enum(["sam", "key", "alpha"]),
  multiple: z.boolean(),
  /** Share of border pixels matching the dominant border color. */
  backgroundUniformity: z.number().min(0).max(1),
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

/** Background by flood fill from the border: only color connected to the edge counts as background. */
function keyMask({ data, width, height }: Rgba, background: readonly [number, number, number]): Uint8Array {
  const total = width * height;
  const isBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const tolerance = 52;
  const near = (index: number) => {
    const offset = index * 4;
    return Math.hypot(data[offset] - background[0], data[offset + 1] - background[1], data[offset + 2] - background[2]) < tolerance;
  };
  const seed = (index: number) => {
    if (!isBackground[index] && near(index)) { isBackground[index] = 1; queue[tail++] = index; }
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

/**
 * Background showing through gaps the border fill can't reach (between the
 * legs, inside a bent arm). A gap is a connected run of near-exact key color
 * inside the mask, large enough not to be a highlight or an eye.
 */
function removeEnclosedBackground(mask: Uint8Array, { data, width, height }: Rgba, background: readonly [number, number, number]): Uint8Array {
  const total = width * height;
  const minArea = Math.max(24, Math.round(total * 0.0002));
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
  readonly signal?: AbortSignal;
}): Promise<Extraction> {
  const image = await decodeRgba(input.png);
  const { width, height, data } = image;
  const total = width * height;
  const border = borderStats(image);

  let mask: Uint8Array | null = null;
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

  if (!mask && segmentation.segment && readMetaConfig()) {
    try {
      const masks = (await segmentation.segment({ png: input.png, width, height, concept: input.concept, flipbookId: input.flipbookId, signal: input.signal }))
        .filter((candidate) => candidate.area > total * 0.005 && candidate.area < total * 0.92);
      if (masks.length) {
        mask = masks[0].alpha;
        method = "sam";
        multiple = masks.length > 1 && masks[1].area > masks[0].area * 0.15;
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
    mask = keyMask(image, border.rgb);
    method = "key";
  }

  // With a known flat background, gaps enclosed by the body are background too.
  const opened = method !== "alpha" && border.uniformity >= 0.85 ? removeEnclosedBackground(mask, image, border.rgb) : mask;
  const cleaned = method === "alpha" ? mask : refineEdges(keepMainComponents(opened, width, height), width, height);
  return measureAndCut(image, cleaned, { method, multiple, background: border });
}

async function measureAndCut(image: Rgba, alpha: Uint8Array, info: { method: Measure["method"]; multiple: boolean; background: { rgb: [number, number, number]; uniformity: number } }): Promise<Extraction> {
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
      touchesEdge: left < edge || top < edge || right >= width - edge || bottom >= height - edge,
      histogram: histogram.map((count) => (histTotal ? count / histTotal : 0)),
      method: info.method,
      multiple: info.multiple,
      backgroundUniformity: info.background.uniformity,
    },
  };
}


// ── Registration ───────────────────────────────────────────────────────────

export type AlignInput = {
  readonly frameId: FrameId;
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
export function computeAlignment(entries: readonly AlignInput[], previous: FlipbookAlignment | null, action: AnimationAction = "walk"): FlipbookAlignment {
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
  const strideMeasured = step !== null && step >= TARGET_HEIGHT * 0.1 && step <= TARGET_HEIGHT * 0.8;
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
