import type { Rgba } from "./alpha";
import { holdColours, type Palette } from "./colour";
import { angleBetween, comparePoses, type Pose } from "./pose-match";

// Temporal consistency of an approved sequence, measured against the video it follows. Each
// frame is already checked alone; these catch what only shows across frames: a pose drifting from
// the video, motion that doesn't follow the video's motion (jitter, a limb snapping back), a figure
// changing size, colours migrating, the silhouette flickering, and any of these growing with the
// frame number (accumulation).

export type SequenceFrame = {
  readonly index: number;
  /** The video subject's pose (source pixels). */
  readonly source: Pose;
  /** DWPose on the approved drawing (canvas pixels). */
  readonly drawn: Pose;
  /** The approved drawing, transparent around the figure. */
  readonly image: Rgba;
};

export type TemporalReport = {
  readonly frames: number;
  /** Per frame: the pose check's mean error beyond noise against its video frame (degrees). */
  readonly poseDeviation: readonly (number | null)[];
  /**
   * Per step: how far the drawing's change of each limb's direction is from the video's change of the
   * same limb (degrees, mean over limbs measured in both frames of both). 0: the drawing moves exactly as
   * the video does; large: jitter, a pose snapping, or motion the video doesn't have.
   */
  readonly motionError: readonly (number | null)[];
  /**
   * The drawing's torso length (shoulders' to hips' midpoint) over the video subject's in the same frame,
   * relative to the sequence's median: registration should keep it at 1. Not the figure's height, which
   * a raised hand changes.
   */
  readonly scale: readonly number[];
  /** Per step: the largest change of any palette colour's share of the figure (identity / colour migration). */
  readonly colourShift: readonly (number | null)[];
  /** Per step: 1 − IoU of consecutive silhouettes, beside the same for the video subject's limbs' motion (flicker). */
  readonly silhouetteChange: readonly number[];
  /** Least-squares slope of the pose deviation over the frame number (degrees per frame): > 0 is drift. */
  readonly driftSlope: number | null;
};

const BONES: readonly (readonly [number, number])[] = [[6, 8], [8, 10], [5, 7], [7, 9], [12, 14], [14, 16], [11, 13], [13, 15]];
const MIN_CONFIDENCE = 0.3;

function vector(pose: Pose, [a, b]: readonly [number, number]): readonly [number, number] | null {
  const [p, q] = [pose.keypoints[a], pose.keypoints[b]];
  if (p?.[0] == null || p[1] == null || q?.[0] == null || q[1] == null) return null;
  if ((pose.scores[a] ?? 0) < MIN_CONFIDENCE || (pose.scores[b] ?? 0) < MIN_CONFIDENCE) return null;
  const v = [q[0] - p[0], q[1] - p[1]] as const;
  return Math.hypot(...v) > 1 ? v : null;
}

/** Signed turn from v to w, degrees in (−180, 180]. */
const turn = (v: readonly [number, number], w: readonly [number, number]) => (Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1]) * 180) / Math.PI;

function motionError(a: SequenceFrame, b: SequenceFrame): number | null {
  const errors = BONES.flatMap((bone) => {
    const [sa, sb, da, db] = [vector(a.source, bone), vector(b.source, bone), vector(a.drawn, bone), vector(b.drawn, bone)];
    if (!sa || !sb || !da || !db) return [];
    const difference = Math.abs(turn(sa, sb) - turn(da, db));
    return [Math.min(difference, 360 - difference)];
  });
  return errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
}

function torso(pose: Pose): number | null {
  const at = (i: number) => (pose.keypoints[i]?.[0] == null || pose.keypoints[i]?.[1] == null ? null : pose.keypoints[i] as readonly [number, number]);
  const [ls, rs, lh, rh] = [at(5), at(6), at(11), at(12)];
  return ls && rs && lh && rh ? Math.hypot((ls[0] + rs[0] - lh[0] - rh[0]) / 2, (ls[1] + rs[1] - lh[1] - rh[1]) / 2) : null;
}

function silhouetteChange(a: Rgba, b: Rgba): number {
  let [both, either] = [0, 0];
  for (let p = 0; p < a.width * a.height; p++) {
    const [x, y] = [a.data[p * 4 + 3] >= 128, b.data[p * 4 + 3] >= 128];
    if (x && y) both++;
    if (x || y) either++;
  }
  return either ? 1 - both / either : 0;
}

function slope(values: readonly (number | null)[]): number | null {
  const points = values.flatMap((value, i) => (value === null ? [] : [[i, value] as const]));
  if (points.length < 3) return null;
  const [mx, my] = [points.reduce((s, [x]) => s + x, 0) / points.length, points.reduce((s, [, y]) => s + y, 0) / points.length];
  const den = points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return den ? points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / den : null;
}

export function temporalReport(frames: readonly SequenceFrame[], palette: Palette | null): TemporalReport {
  const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
  const clip = frames.map((frame) => frame.source);
  const poseDeviation = frames.map((frame) => {
    const check = comparePoses(frame.source, frame.drawn, undefined, clip);
    return check.status === "inconclusive" ? null : round(check.score ?? null);
  });
  // Against the video's own torso in the same frame: the subject leaning or stepping changes it, and the drawing should follow.
  const torsos = frames.map((frame) => (torso(frame.drawn) ?? 0) / (torso(frame.source) || 1));
  const median = [...torsos].sort((x, y) => x - y)[Math.floor(torsos.length / 2)] || 1;
  const shares = palette ? frames.map((frame) => holdColours(frame.image, palette, null).shares) : null;
  const steps = frames.slice(1).map((frame, i) => [frames[i], frame] as const);
  return {
    frames: frames.length,
    poseDeviation,
    motionError: steps.map(([a, b]) => round(motionError(a, b))),
    scale: torsos.map((length) => Math.round((length / median) * 1000) / 1000),
    colourShift: steps.map((_, i) => (shares ? round(Math.max(...shares[i + 1].map((share, role) => Math.abs(share - shares[i][role]))), 3) : null)),
    silhouetteChange: steps.map(([a, b]) => Math.round(silhouetteChange(a.image, b.image) * 1000) / 1000),
    driftSlope: round(slope(poseDeviation), 2),
  };
}

/** The video's own change between two frames, per limb (degrees): what the drawing's motion is compared with. */
export function sourceMotion(a: Pose, b: Pose): number | null {
  const turns = BONES.flatMap((bone) => {
    const [v, w] = [vector(a, bone), vector(b, bone)];
    return v && w ? [angleBetween(v, w)] : [];
  });
  return turns.length ? turns.reduce((sum, value) => sum + value, 0) / turns.length : null;
}
