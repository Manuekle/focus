import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FlipbookAlignment, FrameWarning } from "../../shared/flipbook";
import { CELL_HEIGHT, MeasureSchema, extractSubject, renderSprite, type AlignInput, type Measure } from "./frame-alignment";
import { iou, silhouette } from "./quality-control";
import { readJsonFile, writeAtomic } from "./store";

// Registration of a drawing that follows a movement video. Muse Image places
// and sizes the character differently in every drawing, so "where it was
// drawn" makes the body jump from frame to frame. The movement guide doesn't:
// its body is measured once per tick (cut out by its flat background, as a
// render's simple background is), the track is smoothed to remove measuring
// noise but not the motion, and every drawing is placed with its torso, feet
// and height on the guide's at its own tick. The guide's silhouettes then
// show which drawings took another pose, or jump more than the movement does.

/** Where the guide's body is at one tick, in guide pixels. */
const GuideBodySchema = z.object({ x: z.number(), foot: z.number(), height: z.number().positive() });
type GuideBody = z.infer<typeof GuideBodySchema>;

const GuideTrackSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Measured per tick; null where the guide's body couldn't be cut out. */
  measured: z.array(GuideBodySchema.nullable()),
  /** Gaps filled and noise smoothed: what drawings are registered on. */
  smoothed: z.array(GuideBodySchema),
  measures: z.array(MeasureSchema.nullable()),
});
export type GuideTrack = z.infer<typeof GuideTrackSchema>;

/** A guide whose body was found in fewer ticks than this isn't trusted: drawings keep the place they were drawn at. */
const MIN_FOUND = 0.7;

const pending = ((globalThis as { __focusGuideTracks?: Map<string, Promise<GuideTrack | null>> }).__focusGuideTracks ??= new Map());

const sample = (dir: string, tick: number) => path.join(dir, "samples", `frame_${String(tick).padStart(4, "0")}.png`);
const guideCutout = (dir: string, tick: number) => path.join(dir, "guide", `${String(tick).padStart(4, "0")}.png`);

/**
 * The guide's body at every tick of a movement reference, measured once and
 * kept beside its samples. Null when the guide has no flat background to cut
 * the body out by (an uploaded camera video), or too few ticks were found.
 */
export function guideTrack(dir: string, ticks: number, flipbookId: string): Promise<GuideTrack | null> {
  const file = path.join(dir, "guide-track.json");
  const running = pending.get(file);
  if (running) return running;
  const work = (async () => {
    const saved = await readJsonFile(file, (value) => GuideTrackSchema.parse(value)).catch(() => null);
    // Smoothed again on read: cheap, and a saved track follows changes to the smoothing.
    if (saved) return saved.measured.length === ticks ? { ...saved, smoothed: smoothTrack(saved.measured) } : null;
    const track = await measureGuide(dir, ticks, flipbookId);
    await writeAtomic(file, JSON.stringify(track ?? { width: 1, height: 1, measured: [], smoothed: [], measures: [] }));
    return track;
  })();
  pending.set(file, work);
  void work.finally(() => pending.delete(file)).catch(() => undefined);
  return work;
}

async function measureGuide(dir: string, ticks: number, flipbookId: string): Promise<GuideTrack | null> {
  await mkdir(path.join(dir, "guide"), { recursive: true });
  const measures: (Measure | null)[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const png = await readFile(sample(dir, tick)).catch(() => null);
    if (!png) return null;
    try {
      // Free: never SAM. The line art stops the fill, so a white shirt on white stays body.
      const { cutout, measure } = await extractSubject({ png, concept: "character", flipbookId, allowAlpha: false, useSegmentation: false, keyMode: "lineart" });
      await writeAtomic(guideCutout(dir, tick), cutout);
      measures.push(measure);
    } catch {
      measures.push(null);
    }
  }
  const first = measures.find(Boolean);
  if (!first || measures.filter(Boolean).length < ticks * MIN_FOUND) return null;
  const measured = measures.map((measure) => measure ? { x: measure.crop.left + measure.torsoX, foot: measure.crop.top + measure.footY, height: measure.footY - measure.topY + 1 } : null);
  return { width: first.rawWidth, height: first.rawHeight, measured, smoothed: smoothTrack(measured), measures };
}

/**
 * Gaps filled from their neighbors, single-tick spikes removed (median of 5),
 * then a light [1 2 1] blur: a cut-out that grabs a hand one tick and not the
 * next stops shaking the body, while real travel and bobbing remain.
 */
export function smoothTrack(measured: readonly (GuideBody | null)[]): GuideBody[] {
  const known = measured.flatMap((body, tick) => body ? [tick] : []);
  if (!known.length) return [];
  const filled = measured.map((body, tick) => {
    if (body) return body;
    const before = [...known].reverse().find((index) => index < tick), after = known.find((index) => index > tick);
    if (before === undefined) return measured[after!]!;
    if (after === undefined) return measured[before]!;
    const t = (tick - before) / (after - before), a = measured[before]!, b = measured[after]!;
    return { x: a.x + (b.x - a.x) * t, foot: a.foot + (b.foot - a.foot) * t, height: a.height + (b.height - a.height) * t };
  });
  const keys = ["x", "foot", "height"] as const;
  // Windows shrink evenly at the ends: a one-sided window would pull the first and last ticks toward their neighbors.
  const around = (values: readonly GuideBody[], tick: number, radius: number) => {
    const even = Math.min(radius, tick, values.length - 1 - tick);
    return values.slice(tick - even, tick + even + 1);
  };
  const median = filled.map((_, tick) => Object.fromEntries(keys.map((key) => {
    const window = around(filled, tick, 2).map((body) => body[key]).sort((a, b) => a - b);
    return [key, window[Math.floor(window.length / 2)]];
  })) as GuideBody);
  return median.map((body, tick) => Object.fromEntries(keys.map((key) => {
    const window = around(median, tick, 1);
    return [key, window.length === 3 ? (window[0][key] + 2 * body[key] + window[2][key]) / 4 : body[key]];
  })) as GuideBody);
}

const transformKey = (parts: readonly (string | number)[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);

/**
 * The cell is the guide's frame at CELL_HEIGHT. Each drawing is scaled to the
 * guide body's height at its tick and placed with its torso column and feet
 * on the guide's, so the drawings move exactly as the (smoothed) movement does.
 */
export function computeGuidedAlignment(entries: readonly (AlignInput & { readonly tick: number })[], track: GuideTrack): FlipbookAlignment {
  const k = CELL_HEIGHT / track.height;
  const cellWidth = Math.max(1, Math.round(track.width * k));
  const transforms: FlipbookAlignment["transforms"] = {};
  for (const entry of entries) {
    const body = track.smoothed[Math.max(0, Math.min(track.smoothed.length - 1, Math.round(entry.tick)))];
    const drawn = Math.max(1, entry.measure.footY - entry.measure.topY + 1);
    const scale = (body.height * k) / drawn;
    const left = Math.round(body.x * k - entry.measure.torsoX * scale);
    const top = Math.round((body.foot + 1) * k - (entry.measure.footY + 1) * scale);
    transforms[entry.frameId] = { version: entry.version, scale: Number(scale.toFixed(6)), left, top, key: transformKey(["guided", entry.version, scale.toFixed(6), left, top, cellWidth, CELL_HEIGHT]) };
  }
  return { cellWidth, cellHeight: CELL_HEIGHT, baselineY: CELL_HEIGHT, targetHeight: CELL_HEIGHT, strideX: 0, strideMeasured: false, transforms };
}

/** The guide's body at one tick as it sits in the cell, for comparison with a registered drawing. */
export async function guideSprite(dir: string, track: GuideTrack, tick: number, cell: { width: number; height: number }): Promise<Buffer | null> {
  const measure = track.measures[tick];
  const cutout = measure ? await readFile(guideCutout(dir, tick)).catch(() => null) : null;
  if (!measure || !cutout) return null;
  const k = CELL_HEIGHT / track.height;
  return renderSprite(cutout, measure, { scale: k, left: Math.round(measure.crop.left * k), top: Math.round(measure.crop.top * k) }, cell);
}

/** How much more than the guide a drawing may change from the one before, as a share of their silhouettes. */
const JUMP_EXCESS = 0.2;

/**
 * Drawings in playback order beside the guide at their ticks. A drawing whose
 * silhouette overlaps the guide far less than the others do took another
 * pose; one that changes much more than the guide between neighbors (into it
 * and out of it, or once by a lot) is a jump in the motion. Relative to the
 * clip's own median, so a rigid test stand-in or a loose engine render
 * doesn't flag everything.
 */
export async function motionWarnings(entries: readonly { readonly frameId: string; readonly sprite: Buffer; readonly guide: Buffer | null }[]): Promise<Map<string, FrameWarning[]>> {
  const warnings = new Map<string, FrameWarning[]>();
  const usable = entries.filter((entry): entry is typeof entry & { guide: Buffer } => Boolean(entry.guide));
  if (usable.length < 3) return warnings;
  const drawn = await Promise.all(usable.map((entry) => silhouette(entry.sprite)));
  const guided = await Promise.all(usable.map((entry) => silhouette(entry.guide)));
  const add = (frameId: string, warning: FrameWarning) => warnings.set(frameId, [...(warnings.get(frameId) ?? []), warning]);

  const match = usable.map((_, index) => iou(drawn[index].mask, guided[index].mask));
  const typical = [...match].sort((a, b) => a - b)[Math.floor(match.length / 2)];
  match.forEach((value, index) => {
    if (value < typical - 0.15 && value < 0.6) add(usable[index].frameId, { code: "pose_mismatch", message: "Its pose doesn’t match the movement at this instant: the body covers a clearly different shape than the guide. Redraw it following the guide’s posture." });
  });

  // How much more drawing b changes from drawing a than the guide does between their ticks.
  const excess = (a: number, b: number) => (1 - iou(drawn[a].mask, drawn[b].mask)) - (1 - iou(guided[a].mask, guided[b].mask));
  // Measured from the last drawing that wasn't a spike: the one after a bad drawing changes a lot from it without jumping itself.
  let previous = 0;
  for (let index = 1; index < usable.length; index++) {
    const into = excess(previous, index), out = index + 1 < usable.length ? excess(index, index + 1) : into;
    const spike = into > JUMP_EXCESS && out > JUMP_EXCESS;
    if (spike || into > JUMP_EXCESS * 1.75) add(usable[index].frameId, { code: "motion_jump", message: "The body jumps here: it changes much more from the drawing before than the movement does. Redraw it to continue the motion between its neighbors." });
    if (!spike) previous = index;
  }
  return warnings;
}
