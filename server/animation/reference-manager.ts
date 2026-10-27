import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { type CharacterAnalysis, type FlipbookDirection } from "../../shared/flipbook";
import { AppError } from "../errors";
import { readMetaConfig } from "../ai/meta";
import { extractSubject, MeasureSchema, segmentation, type Measure } from "./frame-alignment";
import { generateImage, type GeneratedImage } from "./muse-image";
import { backdropPrompt, referencePrompt, scenePrompt } from "./pose-planning";
import { flipbookFiles, readJsonFile, writeAtomic } from "./store";

// The character anchor. Every drawing is made from one immutable reference
// image: the upload itself when it already is a usable side view, otherwise
// one clean side-view redraw made once and reused. A redraw never becomes the
// reference for the next one, so the cycle cannot drift away from it.

export const REFERENCE_SIZE = "1024x1536";

/** Whether the upload can anchor a side-view walk as it is. */
export function decideReference(analysis: CharacterAnalysis): { kind: "original" | "clean"; reason: string } {
  if (analysis.view === "side" && analysis.fullBodyVisible && analysis.feetVisible && analysis.background !== "detailed") {
    return { kind: "original", reason: "Your illustration is already a full-body side view, so it is the reference." };
  }
  const why = analysis.view !== "side" ? "isn’t in side view" : !analysis.fullBodyVisible || !analysis.feetVisible ? "doesn’t show the full body" : "has a detailed background";
  return { kind: "clean", reason: `Your illustration ${why}, so a clean full-body side view was drawn from it first.` };
}

export async function drawCleanReference(input: {
  readonly sourceFlat: Buffer;
  readonly analysis: CharacterAnalysis | null;
  readonly direction: FlipbookDirection;
  readonly flipbookId: string;
  readonly signal?: AbortSignal;
}): Promise<GeneratedImage> {
  return generateImage({
    prompt: referencePrompt(input.analysis, input.direction),
    references: [{ png: input.sourceFlat, role: "the original character illustration (identity reference)." }],
    size: REFERENCE_SIZE,
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

/** Stores a reference image and its measurements (for color checks). A failed cut-out is a caveat, not a failure. */
export async function storeReference(input: {
  readonly flipbookId: string;
  readonly version: string;
  /** What the models receive: opaque. */
  readonly png: Buffer;
  /** What the character is cut out of; the upload with its alpha when it had one. */
  readonly measureFrom?: Buffer;
  readonly concept: string;
  readonly allowAlpha: boolean;
  readonly signal?: AbortSignal;
}): Promise<{ measure: Measure | null }> {
  await writeAtomic(flipbookFiles.reference(input.flipbookId, input.version), input.png);
  try {
    const { measure } = await extractSubject({ png: input.measureFrom ?? input.png, concept: input.concept, flipbookId: input.flipbookId, allowAlpha: input.allowAlpha, signal: input.signal });
    await writeAtomic(flipbookFiles.referenceMeasure(input.flipbookId, input.version), JSON.stringify(measure));
    return { measure };
  } catch (error) {
    if (error instanceof AppError && error.code === "canceled") throw error;
    return { measure: null };
  }
}

export async function readReference(flipbookId: string, version: string): Promise<{ png: Buffer; measure: Measure | null }> {
  const png = await readFile(flipbookFiles.reference(flipbookId, version)).catch(() => null);
  if (!png) throw new AppError("reference_missing", 409, "The character reference is missing. Choose a reference again.");
  const measure = await readJsonFile(flipbookFiles.referenceMeasure(flipbookId, version), (value) => MeasureSchema.parse(value));
  return { png, measure };
}

/** The uploaded scene without the character: one background plate, generated once. */
export async function drawScenePlate(input: { readonly sourceFlat: Buffer; readonly analysis: CharacterAnalysis | null; readonly width: number; readonly height: number; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<GeneratedImage> {
  const landscape = input.width >= input.height;
  return generateImage({
    prompt: scenePrompt(input.analysis),
    references: [{ png: input.sourceFlat, role: "the original illustration, scene and character." }],
    size: landscape ? "1536x1024" : "1024x1536",
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

/** A setting drawn for a character that came without one, in the character's style. */
export async function drawBackdrop(input: { readonly sourceFlat: Buffer; readonly analysis: CharacterAnalysis | null; readonly prompt?: string; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<GeneratedImage> {
  return generateImage({
    prompt: backdropPrompt(input.analysis, input.prompt),
    references: [{ png: input.sourceFlat, role: "the character, for its illustration style only." }],
    size: "1536x1024",
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

/** Share of the width the seam is searched in. */
const LOOP_OVERLAP = 0.12;
/** Pixels blended on each side of the cut, so it never reads as a hard line. */
const SEAM_FEATHER = 3;

/**
 * Makes a plate tile horizontally. The last strip is laid over the first
 * along the path where the two differ least (a minimum-error cut, as in image
 * quilting), then dropped, so the right edge leads straight into the left
 * one without the double exposure of a plain cross-fade. The model is asked
 * for a repeating scene; this guarantees the seam.
 */
export async function seamlessPlate(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const overlap = Math.max(4 * SEAM_FEATHER, Math.round(width * LOOP_OVERLAP));
  const outWidth = width - overlap;
  // The cut stays clear of the strip's edges, so column 0 always comes from the tail and the wrap is continuous.
  const low = SEAM_FEATHER + 1;
  const high = overlap - SEAM_FEATHER - 2;
  const span = high - low + 1;
  const cost = new Float64Array(height * span);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < span; i++) {
      const head = (y * width + low + i) * channels;
      const tail = (y * width + outWidth + low + i) * channels;
      let error = 0;
      for (let c = 0; c < channels; c++) error += (data[head + c] - data[tail + c]) ** 2;
      const above = y === 0 ? 0 : Math.min(cost[(y - 1) * span + i], i > 0 ? cost[(y - 1) * span + i - 1] : Infinity, i < span - 1 ? cost[(y - 1) * span + i + 1] : Infinity);
      cost[y * span + i] = error + above;
    }
  }
  const cut = new Int32Array(height);
  let best = 0;
  for (let i = 1; i < span; i++) if (cost[(height - 1) * span + i] < cost[(height - 1) * span + best]) best = i;
  for (let y = height - 1; y >= 0; y--) {
    cut[y] = low + best;
    if (y === 0) break;
    let next = best;
    for (const i of [best - 1, best + 1]) if (i >= 0 && i < span && cost[(y - 1) * span + i] < cost[(y - 1) * span + next]) next = i;
    best = next;
  }
  const out = Buffer.alloc(outWidth * height * channels);
  for (let y = 0; y < height; y++) {
    data.copy(out, y * outWidth * channels, y * width * channels, (y * width + outWidth) * channels);
    for (let x = 0; x < overlap; x++) {
      // Tail left of the cut, head right of it, a short blend across it.
      const t = Math.min(1, Math.max(0, (x - cut[y] + SEAM_FEATHER) / (2 * SEAM_FEATHER)));
      const head = (y * width + x) * channels;
      const tail = (y * width + outWidth + x) * channels;
      const target = (y * outWidth + x) * channels;
      for (let c = 0; c < channels; c++) out[target + c] = Math.round(data[head + c] * t + data[tail + c] * (1 - t));
    }
  }
  return sharp(out, { raw: { width: outWidth, height, channels } }).png().toBuffer();
}

// ── Depth ──────────────────────────────────────────────────────────────────
//
// Parallax from one picture: SAM finds the sky, and what floats in it, in the
// seamless strip; that becomes the far layer and everything else the near one. Where the near
// layer slides off the sky, the far layer must have something to show, so its
// non-sky pixels are filled with the average sky color of their row (skies
// are mostly horizontal gradients). Both layers keep the strip's width, so
// they wrap like it.

/** What belongs to the far layer. Each is one SAM frame; "sky" alone leaves clouds and the sun in front. */
export const FAR_CONCEPTS = ["sky", "cloud", "sun"] as const;

/** Sky share of the picture outside this range: no useful parallax (all sky, or none). */
const SKY_RANGE = [0.08, 0.9] as const;

export async function splitDepth(input: { readonly strip: Buffer; readonly flipbookId: string; readonly signal?: AbortSignal }): Promise<{ far: Buffer; near: Buffer } | null> {
  if (!segmentation.segment || !readMetaConfig()) return null;
  const { data, info } = await sharp(input.strip).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const found = await Promise.all(FAR_CONCEPTS.map(async (concept) => ({
    concept,
    masks: await segmentation.segment!({ png: input.strip, width: info.width, height: info.height, concept, flipbookId: input.flipbookId, signal: input.signal }),
  })));
  // Clouds and suns float high: a "cloud" found down by the ground is a bush.
  const masks = found.flatMap(({ concept, masks: list }) => list.filter((mask) => concept === "sky" || (mask.box.top + mask.box.bottom) / 2 < info.height * 0.6));
  if (!masks.length) return null;
  const sky = new Uint8Array(info.width * info.height);
  for (const mask of masks) for (let index = 0; index < sky.length; index++) if (mask.alpha[index] > sky[index]) sky[index] = mask.alpha[index];
  return depthLayers(data, info.width, info.height, sky);
}

/** Pure: an RGB strip and its sky mask into the far (sky, filled) and near (the rest, transparent sky) layers. */
export async function depthLayers(rgb: Buffer, width: number, height: number, sky: Uint8Array): Promise<{ far: Buffer; near: Buffer } | null> {
  // The near layer lets a little more through than the sky itself, so anti-aliased cloud and sun
  // edges go with the sky instead of sliding with the ground. Colors come from the sky as found.
  const open = growMask(sky, width, height, 2);
  let skyPixels = 0;
  for (const value of sky) if (value >= 128) skyPixels++;
  const share = skyPixels / sky.length;
  if (share < SKY_RANGE[0] || share > SKY_RANGE[1]) return null;

  // Average sky color per row; rows with no sky borrow the nearest row above, then below.
  const rows: ([number, number, number] | null)[] = [];
  for (let y = 0; y < height; y++) {
    let r = 0, g = 0, b = 0, count = 0;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (sky[index] < 128) continue;
      r += rgb[index * 3]; g += rgb[index * 3 + 1]; b += rgb[index * 3 + 2]; count++;
    }
    rows.push(count ? [r / count, g / count, b / count] : null);
  }
  let last: [number, number, number] | null = null;
  for (let y = 0; y < height; y++) {
    if (rows[y]) last = rows[y];
    else rows[y] = last;
  }
  last = null;
  for (let y = height - 1; y >= 0; y--) {
    if (rows[y]) last = rows[y];
    else rows[y] = last;
  }

  const far = Buffer.alloc(width * height * 3);
  const near = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const fill = rows[y]!;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const k = sky[index] / 255;
      for (let c = 0; c < 3; c++) {
        far[index * 3 + c] = Math.round(rgb[index * 3 + c] * k + fill[c] * (1 - k));
        near[index * 4 + c] = rgb[index * 3 + c];
      }
      near[index * 4 + 3] = 255 - open[index];
    }
  }
  return {
    far: await sharp(far, { raw: { width, height, channels: 3 } }).png().toBuffer(),
    near: await sharp(near, { raw: { width, height, channels: 4 } }).png().toBuffer(),
  };
}

/** A max filter of the given radius, in two passes (rows, then columns). */
export function growMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dx = Math.max(0, x - radius); dx <= Math.min(width - 1, x + radius); dx++) if (mask[y * width + dx] > max) max = mask[y * width + dx];
      rows[y * width + x] = max;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dy = Math.max(0, y - radius); dy <= Math.min(height - 1, y + radius); dy++) if (rows[dy * width + x] > max) max = rows[dy * width + x];
      out[y * width + x] = max;
    }
  }
  return out;
}
