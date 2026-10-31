import type { JointFlags } from "../mapping/source-track";
import type { Mask } from "../mapping/mask";
import type { Pose } from "./pose-match";

// The canonical joint: one body keypoint with everything a measurement needs to know about it —
// which side of the body it is on, where it is in image pixels and in torso units, how sure the
// estimator was, and whether it was seen at all. Measurements take VISIBLE joints only; an
// OCCLUDED, INFERRED or UNKNOWN joint is never treated as confirmed.
//
// Evidence for visibility, strongest first: no point at all or one off the image (UNKNOWN); the
// source track's flags — below the estimator's floor or outside the tracked subject's mask
// (OCCLUDED), filled across a dropout (INFERRED); a figure mask the point falls outside of
// (OCCLUDED). RTMW's scores are not probabilities and do not separate a joint hidden under
// clothing from a visible one (docs/focus-pipeline-repair/PHASE_02.md), so they are carried as
// `score` but never turned into a visibility on their own.

export type Visibility = "VISIBLE" | "OCCLUDED" | "INFERRED" | "UNKNOWN";
export type Side = "left" | "right" | "centre";

export type CanonicalJoint = {
  /** COCO-WholeBody index. */
  readonly id: number;
  readonly name: string;
  /** The subject's own side (anatomical), never the image's. */
  readonly side: Side;
  /** Pixels in `space`. Null when the estimator gave none. */
  readonly image: readonly [number, number] | null;
  /** Relative to the hips' midpoint, in torso lengths (shoulders' midpoint to hips' midpoint); null without a torso. */
  readonly normalized: readonly [number, number] | null;
  /** The estimator's raw score (RTMW SimCC: roughly 0–10), not a probability. */
  readonly score: number | null;
  readonly visibility: Visibility;
  /** Why a joint is not VISIBLE, in words. */
  readonly reason?: string;
  /** Which pixel grid `image` is in. */
  readonly space: "frame" | "canvas" | "drawing";
  /** What produced the point. */
  readonly source: string;
};

export const BODY_JOINTS = [
  "nose", "left eye", "right eye", "left ear", "right ear",
  "left shoulder", "right shoulder", "left elbow", "right elbow", "left wrist", "right wrist",
  "left hip", "right hip", "left knee", "right knee", "left ankle", "right ankle",
] as const;

/** The estimator's floor in its own score units: below it RTMW's point is noise (services/animation-worker CONFIDENT). */
export const SCORE_FLOOR = 0.3;

export type CanonicalOptions = {
  readonly space: CanonicalJoint["space"];
  readonly source: string;
  readonly width: number;
  readonly height: number;
  /** The source track's flags for this frame (mapping/source-track.ts). */
  readonly flags?: JointFlags;
  /** The figure's pixels, in the same grid. */
  readonly mask?: Mask;
};

export function canonicalJoints(pose: Pose, options: CanonicalOptions): CanonicalJoint[] {
  const raw = (i: number) => {
    const [x, y] = pose.keypoints[i] ?? [null, null];
    return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : [x, y] as const;
  };
  const [ls, rs, lh, rh] = [raw(5), raw(6), raw(11), raw(12)];
  const hips = lh && rh ? [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2] as const : null;
  const shoulders = ls && rs ? [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2] as const : null;
  const torso = hips && shoulders ? Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]) : 0;
  const flagged = (list: readonly number[] | undefined, i: number) => Boolean(list?.includes(i));
  return BODY_JOINTS.map((name, id) => {
    const image = raw(id);
    const score = pose.scores[id] ?? null;
    const base = { id, name, side: name.startsWith("left") ? "left" : name.startsWith("right") ? "right" : "centre", image, score, space: options.space, source: options.source } as const;
    const normalized = image && hips && torso > 0 ? [(image[0] - hips[0]) / torso, (image[1] - hips[1]) / torso] as const : null;
    const state = (visibility: Visibility, reason?: string): CanonicalJoint => ({ ...base, normalized, visibility, ...(reason ? { reason } : {}) });
    if (!image) return state("UNKNOWN", "no point");
    if (image[0] < 0 || image[1] < 0 || image[0] >= options.width || image[1] >= options.height) return state("UNKNOWN", "off the image");
    if ((score ?? 0) < SCORE_FLOOR) return state("UNKNOWN", "below the estimator's floor");
    if (flagged(options.flags?.offSubject, id)) return state("OCCLUDED", "outside the tracked subject");
    if (flagged(options.flags?.occluded, id)) return state("OCCLUDED", "lost by the tracker");
    if (flagged(options.flags?.bridged, id)) return state("INFERRED", "filled across a dropout");
    if (options.mask) {
      const [x, y] = [Math.round(image[0]), Math.round(image[1])];
      if (!options.mask.data[y * options.mask.width + x]) return state("OCCLUDED", "outside the figure");
    }
    return state("VISIBLE");
  });
}

/** Keypoint indices a measurement must not use as confirmed. */
export function unconfirmed(joints: readonly CanonicalJoint[]): Set<number> {
  return new Set(joints.filter((joint) => joint.visibility !== "VISIBLE").map((joint) => joint.id));
}
