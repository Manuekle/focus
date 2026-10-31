import path from "node:path";
import sharp from "sharp";
import { deform } from "../mapping/deform";
import { followSkeleton } from "../mapping/follow";
import { interpolateSkeleton, largestTurn } from "../mapping/interpolate";
import { area, emptyMask, erode, fillHoles, type Mask } from "../mapping/mask";
import { dist, segmentDistance, type Vec } from "../mapping/geometry";
import { poseToolAvailable } from "../mapping/pose-estimator";
import type { Pose } from "../rotoscope/pose-match";
import { analyzeDrawing, type Analysis } from "../mapping/profile";
import { BONES, JOINT_NAMES, normalFrame, skeletonFromPose, toNormal, type BoneName, type JointName, type Skeleton } from "../mapping/skeleton";
import { localSegmenter } from "../mapping/segmenter";
import { measureAndCut, placeOnCanvas, type Measure } from "./frame-alignment";

// An in-between made by moving the character, not by asking a model to draw
// it. Both key drawings are measured with the Character Mapping Engine (their
// cut-outs, a whole-body pose estimate, a rig); the pose between the two is
// computed bone by bone (mapping/interpolate.ts) and the nearer key drawing is
// deformed onto it. The line art is resampled, so the identity cannot drift,
// and the in-between costs no drawing. When the keys are too far apart, or the
// deformation folds or stretches the drawing, it refuses and the caller draws
// the in-between with Muse Image instead.

/** A key drawing as the flipbook holds it: the raw drawing and its cut-out with the measure of where the cut-out sits. */
export type KeyDrawing = { readonly raw: Buffer; readonly cutout: Buffer; readonly measure: Measure };

export type SkeletonDrawing = {
  readonly raw: Buffer;
  readonly cutout: Buffer;
  readonly measure: Measure;
  /** The widest turn of any bone between the two keys, degrees. */
  readonly turn: number;
  /** What the deformation had to invent, stretch or tear open, as shares of the drawing it moved. */
  readonly quality: { readonly exposed: number; readonly distorted: number; readonly size: number; readonly torn: number };
};

/** Why a pose can't be carried by the skeleton; the caller falls back to a drawing. */
export class SkeletonRefused extends Error {
  /** Set when one key drawing itself can't be measured: no in-between around it will work either. */
  constructor(readonly reason: string, readonly key?: "from" | "to") {
    super(reason);
    this.name = "SkeletonRefused";
  }
}

/** Past this the keys are different poses, not one move: a model has to draw what is between. */
export const MAX_TURN_DEGREES = 160;
const MAX_DISTORTED = 0.04;
const MAX_EXPOSED = 0.025;
const AREA_RANGE = [0.8, 1.25] as const;
/** New see-through holes inside the arms and legs, as a share of the figure: a knee, a sleeve or a skirt hem split open. */
export const MAX_LIMB_HOLES = 0.0008;
/**
 * New slivers along the arms and legs: the share of their pixels in parts thinner than about 1% of the drawing's
 * height. Where two legs cross, the rig gives some of one leg's pixels to the other, and moving them leaves
 * jagged shards of skin and notched outlines that no hole check sees.
 */
export const MAX_LIMB_SLIVERS = 0.007;

/** Upper and lower limb of each arm and leg: where a joint bent past what its drawing holds, the drawing opens up. */
const LIMB_CHAINS: readonly (readonly [BoneName, BoneName])[] = [["leftThigh", "leftShin"], ["rightThigh", "rightShin"], ["leftUpperArm", "leftForearm"], ["rightUpperArm", "rightForearm"]];

/**
 * The pixels along the arms and legs of a pose, each chain as wide as its
 * thinner bone (a thigh's measured width takes in a skirt). Hair and the
 * torso stay out: their own gaps (between strands) move with them and would
 * hide or fake a tear.
 */
export function limbBand(width: number, height: number, joint: (name: JointName) => Vec | null, radius: (name: BoneName) => number): Mask {
  const band = emptyMask(width, height);
  for (const chain of LIMB_CHAINS) {
    const reach = 0.9 * Math.min(...chain.map(radius));
    for (const name of chain) {
      const def = BONES.find((bone) => bone.name === name)!;
      const [a, b] = [joint(def.from as JointName), joint(def.to as JointName)];
      if (!a || !b) continue;
      for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach)); y <= Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + reach)); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach)); x <= Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + reach)); x++) {
          if (segmentDistance([x + 0.5, y + 0.5], a, b).distance <= reach) band.data[y * width + x] = 1;
        }
      }
    }
  }
  return band;
}

/** The share of a band's figure pixels in parts thinner than `2 × radius`: what an erosion by `radius` removes. */
export function sliversWithin(mask: Mask, band: Mask, radius: number): number {
  const core = erode(mask, radius);
  let figure = 0;
  let thin = 0;
  for (let p = 0; p < mask.data.length; p++) {
    if (!band.data[p] || !mask.data[p]) continue;
    figure++;
    if (!core.data[p]) thin++;
  }
  return figure ? thin / figure : 0;
}

/** See-through pixels the figure encloses inside a band. */
export function holesWithin(mask: Mask, band: Mask): number {
  const filled = fillHoles(mask);
  let holes = 0;
  for (let p = 0; p < mask.data.length; p++) if (band.data[p] && filled.data[p] && !mask.data[p]) holes++;
  return holes;
}

export function skeletonInbetweensEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.FOCUS_SKELETON_INBETWEENS !== "off" && poseToolAvailable();
}

const analyses = ((globalThis as { __focusSkeletonAnalyses?: Map<string, Promise<Analysis>> }).__focusSkeletonAnalyses ??= new Map());

/** One key drawing measured once (and kept on disk by its hash); the same key serves every in-between around it. */
function analyse(key: KeyDrawing, cacheDir: string, signal?: AbortSignal): Promise<Analysis> {
  const id = `${cacheDir}:${key.cutout.length}:${key.cutout.subarray(0, 64).toString("base64")}:${key.cutout.subarray(-64).toString("base64")}`;
  let known = analyses.get(id);
  if (!known) {
    known = (async () => {
      const { rawWidth, rawHeight, crop } = key.measure;
      // Measured on the raw drawing's own pixels, so the in-between lands where the keys are.
      const placed = await placeOnCanvas(key.cutout, { left: crop.left, top: crop.top }, { width: rawWidth, height: rawHeight });
      return analyzeDrawing(placed, { cacheDir, segmenter: localSegmenter, signal });
    })();
    analyses.set(id, known);
    known.catch(() => analyses.delete(id));
  }
  return known;
}

/** The pixel at the corner of a drawing: the flat key color it was drawn on. */
async function backgroundOf(raw: Buffer): Promise<readonly [number, number, number]> {
  const { data } = await sharp(raw).extract({ left: 1, top: 1, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

/** `position` is the move's progress, 0 at `from` and 1 at `to`, easing already applied. */
export async function skeletonInbetween(input: {
  readonly from: KeyDrawing;
  readonly to: KeyDrawing;
  readonly position: number;
  readonly cacheDir: string;
  /** Which key drawing to move; by default the nearer one. */
  readonly base?: "from" | "to";
  readonly signal?: AbortSignal;
}): Promise<SkeletonDrawing> {
  const { from, to, position } = input;
  if (from.measure.rawWidth !== to.measure.rawWidth || from.measure.rawHeight !== to.measure.rawHeight) throw new SkeletonRefused("the two key drawings differ in size");
  const measured = (key: KeyDrawing, which: "from" | "to") => analyse(key, input.cacheDir, input.signal).catch((error: unknown) => {
    throw new SkeletonRefused(error instanceof Error ? error.message : "a key drawing could not be measured", which);
  });
  const [a, b] = await Promise.all([measured(from, "from"), measured(to, "to")]);
  const turn = largestTurn(a.rig.skeleton, b.rig.skeleton);
  if (turn > MAX_TURN_DEGREES) throw new SkeletonRefused(`the keys are ${Math.round(turn)}° apart`);
  const target = interpolateSkeleton(a.rig.skeleton, b.rig.skeleton, position);
  if (!target) throw new SkeletonRefused("a key drawing has no torso");

  // The nearer key carries the move: its own drawing, resampled, never a blend of two. When its rig can't
  // (legs crossed in that drawing, so one leg's pixels belong to the other), the other key may still carry it.
  const nearer = position <= 0.5 ? "from" : "to";
  let refusal: SkeletonRefused | null = null;
  for (const which of input.base ? [input.base] : [nearer, nearer === "from" ? "to" : "from"] as const) {
    try {
      return { ...(await render(which === "from" ? a : b, which === "from" ? from : to, target)), turn };
    } catch (error) {
      if (!(error instanceof SkeletonRefused)) throw error;
      refusal ??= error;
    }
  }
  throw refusal!;
}

/** The most a neighboring in-between is turned to reach the next pose along a gap: a small step, or the chain has gone wrong. */
const MAX_NEIGHBOR_TURN = 60;

/**
 * An in-between moved from a finished drawing next to it in the same gap
 * (another in-between, already checked) instead of from a key: where a key's
 * rig can't carry the move (its legs cross, so one leg's pixels belong to the
 * other), the gap is filled step by step from its cleaner end, each step a
 * small turn, like following a movement. The pose is still the keys' own at
 * `position`; only the drawing that is moved differs.
 */
export async function skeletonFromNeighbor(input: {
  readonly from: KeyDrawing;
  readonly to: KeyDrawing;
  readonly neighbor: KeyDrawing;
  readonly position: number;
  readonly cacheDir: string;
  readonly signal?: AbortSignal;
}): Promise<SkeletonDrawing> {
  const measured = (key: KeyDrawing, which?: "from" | "to") => analyse(key, input.cacheDir, input.signal).catch((error: unknown) => {
    throw new SkeletonRefused(error instanceof Error ? error.message : "a drawing could not be measured", which);
  });
  const [a, b, near] = await Promise.all([measured(input.from, "from"), measured(input.to, "to"), measured(input.neighbor)]);
  const target = interpolateSkeleton(a.rig.skeleton, b.rig.skeleton, input.position);
  if (!target) throw new SkeletonRefused("a key drawing has no torso");
  const turn = largestTurn(near.rig.skeleton, target);
  if (turn > MAX_NEIGHBOR_TURN) throw new SkeletonRefused(`the neighbor is ${Math.round(turn)}° from this pose`);
  return { ...(await render(near, input.neighbor, target)), turn };
}

/**
 * How far the body moves between two key drawings: the widest bone turn
 * (degrees) and the farthest any joint travels against the torso (torso
 * lengths, so the character's size and place in the frame don't count).
 */
export async function measureMove(input: { readonly from: KeyDrawing; readonly to: KeyDrawing; readonly cacheDir: string; readonly signal?: AbortSignal }): Promise<{ readonly turn: number; readonly travel: number }> {
  const [a, b] = await Promise.all([analyse(input.from, input.cacheDir, input.signal), analyse(input.to, input.cacheDir, input.signal)]);
  const [fa, fb] = [normalFrame(a.rig.skeleton), normalFrame(b.rig.skeleton)];
  let travel = 0;
  if (fa && fb) {
    for (const name of JOINT_NAMES) {
      const [p, q] = [a.rig.skeleton[name], b.rig.skeleton[name]];
      if (p && q) travel = Math.max(travel, dist(toNormal(fa, p.p), toNormal(fb, q.p)));
    }
  }
  return { turn: largestTurn(a.rig.skeleton, b.rig.skeleton), travel };
}

/** The base drawing deformed onto a pose, as a finished drawing and cut-out; refuses what would look wrong. */
async function render(base: Analysis, drawing: KeyDrawing, target: Skeleton): Promise<Omit<SkeletonDrawing, "turn">> {
  const result = deform(base.image, base.rig, target);
  const { stats } = result;
  if (stats.flipped > Math.max(2, stats.triangles * 0.002)) throw new SkeletonRefused("the drawing folds over itself in this pose");
  if (stats.distortedArea > stats.coverageArea * MAX_DISTORTED) throw new SkeletonRefused("a limb would stretch too far");
  if (stats.exposedArea > stats.coverageArea * MAX_EXPOSED) throw new SkeletonRefused("the pose shows body the drawing never showed");

  const { width, height, data } = result.image;
  const alpha = new Uint8Array(width * height);
  let opaque = 0;
  for (let index = 0; index < alpha.length; index++) {
    alpha[index] = data[index * 4 + 3];
    if (alpha[index] >= 128) opaque++;
  }
  const ratio = opaque / Math.max(1, area(base.mask));
  if (ratio < AREA_RANGE[0] || ratio > AREA_RANGE[1]) throw new SkeletonRefused("the body would change size");

  // The stretch and exposure checks miss a joint that opens wider than the drawing can follow: the limb
  // comes apart there (a knee split, a sleeve or a skirt hem torn) and the background shows through.
  const moved: Mask = { width, height, data: alpha.map((value) => (value >= 128 ? 1 : 0)) };
  const radius = (name: BoneName) => base.rig.bones.find((bone) => bone.name === name)?.radius ?? 0;
  const [keyBand, movedBand] = [limbBand(width, height, (name) => base.rig.skeleton[name]?.p ?? null, radius), limbBand(width, height, (name) => result.plan.generated[name]?.p ?? null, (name) => radius(name) * result.plan.scale)];
  const torn = Math.max(0, holesWithin(moved, movedBand) - holesWithin(base.mask, keyBand)) / Math.max(1, opaque);
  if (torn > MAX_LIMB_HOLES) throw new SkeletonRefused("an arm or a leg would tear open at a joint");
  const sliver = Math.max(1, Math.round(height / 192));
  if (sliversWithin(moved, movedBand, sliver) - sliversWithin(base.mask, keyBand, sliver) > MAX_LIMB_SLIVERS) throw new SkeletonRefused("an arm or a leg would break into shards where the limbs overlap");

  const background = await backgroundOf(drawing.raw);
  const subject = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const raw = await sharp({ create: { width, height, channels: 3, background: { r: background[0], g: background[1], b: background[2] } } }).composite([{ input: subject }]).png().toBuffer();
  const extraction = await measureAndCut({ data, width, height }, alpha, { method: "alpha", multiple: false, background: { rgb: [background[0], background[1], background[2]], uniformity: 1 } });
  return { raw, cutout: extraction.cutout, measure: extraction.measure, quality: { exposed: stats.exposedArea / Math.max(1, stats.coverageArea), distorted: stats.distortedArea / Math.max(1, stats.coverageArea), size: ratio, torn } };
}

/** The most a drawing is asked to turn from the key it is made from: a video's key is a few ticks away, so more means a bad track. */
const MAX_FOLLOW_TURN = 70;

/**
 * A drawing of a movement video at one moment: the nearest key drawing,
 * deformed so each bone turns by what the same bone of the video's person
 * turned between the key's moment and this one (mapping/follow.ts). `sourceKey`
 * and `sourceNow` are the video's pose track at those two ticks.
 */
export async function skeletonFollow(input: {
  readonly key: KeyDrawing;
  readonly sourceKey: Pose;
  readonly sourceNow: Pose;
  readonly cacheDir: string;
  readonly signal?: AbortSignal;
}): Promise<SkeletonDrawing> {
  const base = await analyse(input.key, input.cacheDir, input.signal).catch((error: unknown) => {
    throw new SkeletonRefused(error instanceof Error ? error.message : "the key drawing could not be measured", "from");
  });
  const target = followSkeleton(base.rig.skeleton, skeletonFromPose(input.sourceKey), skeletonFromPose(input.sourceNow));
  if (!target) throw new SkeletonRefused("the video's person has no torso here");
  const turn = largestTurn(base.rig.skeleton, target);
  if (turn > MAX_FOLLOW_TURN) throw new SkeletonRefused(`the video moves ${Math.round(turn)}° from the key`);
  return { ...(await render(base, input.key, target)), turn };
}

export const skeletonCacheDir = (flipbookDir: string) => path.join(flipbookDir, "skeleton");
