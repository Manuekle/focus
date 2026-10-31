import { fromBackdrop } from "../mapping/mask";
import type { Rgba } from "./alpha";
import { CHIN, hairTop, type Marks, type Proportions } from "./grid";
import type { Pose } from "./pose-match";

// The video person's whole figure, hair top to soles. The character is drawn
// over exactly that span — times the ratio of the two heights when a person
// gave both — so it stands where the person stood and is as tall: never the
// person's skeleton with the character's bigger head and longer feet added on
// top, which drew every figure about an eighth taller than the person.

const at = (p: Pose, i: number) => (p.keypoints[i]?.[0] == null || (p.scores[i] ?? 0) < 0.3 ? null : p.keypoints[i] as [number, number]);
const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distance = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const median = (values: readonly number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];
const quantile = (values: readonly number[], q: number) => [...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.floor(values.length * q))];

/** COCO-WholeBody feet: big toe, small toe and heel of each foot. */
const FEET = [17, 18, 19, 20, 21, 22] as const;

/** The lowest point DWPose sees on either foot: where the soles are in this frame. */
export function solesOf(pose: Pose): number | null {
  const ys = FEET.flatMap((i) => at(pose, i)?.[1] ?? []);
  return ys.length ? Math.max(...ys) : null;
}

function anklesOf(pose: Pose): number | null {
  const ankles = [at(pose, 15), at(pose, 16)].filter((p): p is [number, number] => p !== null);
  return ankles.length ? ankles.reduce((sum, p) => sum + p[1], 0) / ankles.length : null;
}

function torsoOf(pose: Pose): number | null {
  const [ls, rs, lh, rh] = [at(pose, 5), at(pose, 6), at(pose, 11), at(pose, 12)];
  return ls && rs && lh && rh ? distance(mid(ls, rs), mid(lh, rh)) : null;
}

/** Nose to shoulders, shoulders to hips, thigh and shin (the longer side): the body between the head and the feet. */
function chainBones(pose: Pose): (number | null)[] {
  const [nose, ls, rs] = [at(pose, 0), at(pose, 5), at(pose, 6)];
  const longer =(...pairs: readonly (readonly [number, number])[]) => {
    const lengths = pairs.flatMap(([i, j]) => { const [p, q] = [at(pose, i), at(pose, j)]; return p && q ? [distance(p, q)] : []; });
    return lengths.length ? Math.max(...lengths) : null;
  };
  return [
    nose && ls && rs ? distance(nose, mid(ls, rs)) : null,
    torsoOf(pose),
    longer([11, 13], [12, 14]),
    longer([13, 15], [14, 16]),
  ];
}

/**
 * The body's length from the nose to the ankles with every bone fully extended: each bone at the 90th
 * percentile of the clip, where it is seen least foreshortened. Null when a bone is never seen.
 */
export function bodyChain(poses: readonly Pose[]): number | null {
  const bones = poses.map(chainBones);
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const seen = bones.flatMap((lengths) => lengths[i] ?? []);
    if (!seen.length) return null;
    total += quantile(seen, 0.9);
  }
  return total;
}

/**
 * The top of the person's hair in one video frame, by the rule drawings are measured with (grid.ts
 * hairTop) on the frame's silhouette against its backdrop. Null when the frame can't say: a busy
 * background (the figure runs into the edge), a face not on the figure, or a head out of proportion
 * with the torso (a raised hand merged into the hair, a shadow on the wall).
 */
export function measuredHairTop(frame: Rgba, pose: Pose): number | null {
  const [nose, ls, rs] = [at(pose, 0), at(pose, 5), at(pose, 6)];
  const torso = torsoOf(pose);
  if (!nose || !ls || !rs || !torso) return null;
  const mask = fromBackdrop(frame);
  let area = 0;
  for (const value of mask.data) area += value;
  // A backdrop that isn't one colour leaves most of the frame as "figure".
  if (area > 0.5 * frame.width * frame.height) return null;
  const solid = (x: number, y: number) => Boolean(mask.data[y * frame.width + x]);
  if (!solid(Math.round(nose[0]), Math.round(nose[1]))) return null;
  const top = hairTop(solid, frame.width, frame.height, nose, Math.abs(ls[0] - rs[0]));
  const above = nose[1] - top;
  return top > 2 && above >= 0.1 * torso && above <= torso ? top : null;
}

export type PersonFigure = {
  /** The top of the hair above the nose, in video-frame pixels. */
  readonly headAboveNose: number;
  /** The soles below the ankles: where a frame's soles are when DWPose doesn't see its feet. */
  readonly solesBelowAnkles: number;
  /** How the hair top was found: on the frames' silhouettes, else scaled from the character sheet by the face or by the body. */
  readonly method: "silhouette" | "face" | "body";
  /** Frames whose silhouette gave a hair top, of those measured. */
  readonly seen: number;
  readonly of: number;
};

/**
 * The person's hair top and soles for the whole clip. The hair top is the median of the frames whose
 * silhouette shows it (at least three, and a quarter of those measured); otherwise it is the character
 * sheet's, scaled by the face (nose to chin) or, without a chin, by the body between nose and ankles.
 */
export function personFigure(input: {
  /** Frames whose silhouette is measured, with their pose. */
  readonly samples: readonly { readonly frame: Rgba; readonly pose: Pose }[];
  /** Every pose of the clip. */
  readonly poses: readonly Pose[];
  /** The character sheet's pose and its proportions (grid.ts proportions). */
  readonly reference: Pose;
  readonly sheet: Proportions;
}): PersonFigure {
  const { samples, poses, reference, sheet } = input;
  const heads = samples.flatMap(({ frame, pose }) => {
    const top = measuredHairTop(frame, pose);
    const nose = at(pose, 0);
    return top !== null && nose ? [nose[1] - top] : [];
  });
  const [person, character] = [bodyChain(poses), bodyChain([reference])];
  const body = person && character ? person / character : null;
  const chins = poses.flatMap((pose) => { const [nose, chin] = [at(pose, 0), at(pose, CHIN)]; return nose && chin && chin[1] > nose[1] ? [chin[1] - nose[1]] : []; });
  const [nose, chin] = [at(reference, 0), at(reference, CHIN)];
  const face = chins.length && nose && chin && chin[1] > nose[1] ? median(chins) / (chin[1] - nose[1]) : null;
  const feet = poses.flatMap((pose) => { const [soles, ankles] = [solesOf(pose), anklesOf(pose)]; return soles !== null && ankles !== null && soles >= ankles ? [soles - ankles] : []; });
  const solesBelowAnkles = feet.length ? median(feet) : sheet.solesBelowAnkles * (body ?? 1);
  if (heads.length >= Math.max(3, Math.ceil(samples.length / 4))) {
    return { headAboveNose: median(heads), solesBelowAnkles, method: "silhouette", seen: heads.length, of: samples.length };
  }
  const scale = face ?? body;
  if (scale === null) throw new Error("the video person has no face or body to measure their height by");
  return { headAboveNose: sheet.headAboveNose * scale, solesBelowAnkles, method: face !== null ? "face" : "body", seen: heads.length, of: samples.length };
}

/**
 * Where the character's hair top, soles and hips belong in one video frame, in its pixels: the person's
 * own hair top and soles, the span scaled about the soles by `ratio` (the character's height over the
 * person's: 1 when either is unknown). Null without a nose or hips to place it by.
 */
export function personMarks(pose: Pose, figure: PersonFigure, ratio = 1): Marks | null {
  const [nose, lh, rh] = [at(pose, 0), at(pose, 11), at(pose, 12)];
  const ankles = anklesOf(pose);
  const feet = solesOf(pose) ?? (ankles !== null ? ankles + figure.solesBelowAnkles : null);
  if (!nose || !lh || !rh || feet === null) return null;
  const head = nose[1] - figure.headAboveNose;
  return { head: feet - (feet - head) * ratio, feet, center: (lh[0] + rh[0]) / 2 };
}

/** The character's height over the video person's, from the run's measures; 1 when either is unknown. */
export function heightRatio(measures: { readonly heightCm?: number | null; readonly personHeightCm?: number | null } | null): number {
  const [character, person] = [measures?.heightCm ?? null, measures?.personHeightCm ?? null];
  return character && person ? character / person : 1;
}
