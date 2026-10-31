import type { Pose } from "../rotoscope/pose-match";
import type { Mask } from "./mask";
import { COCO_MIRROR, MIN_CONFIDENCE } from "./skeleton";

// The source video's pose track, made steady without changing its timing:
// left/right label swaps undone, short dropouts bridged, jitter removed with
// a One-Euro filter (still poses stay still, fast moves keep their speed),
// and every joint marked when it is occluded, bridged or off the tracked
// subject. Frame count and frame times never change.

export type JointFlags = {
  /** Below the confidence floor or missing: not used as a measurement. */
  readonly occluded: readonly number[];
  /** Filled across a dropout of at most MAX_GAP frames from its neighbours. */
  readonly bridged: readonly number[];
  /** Outside the tracked subject's SAM mask: likely another person or the background. */
  readonly offSubject: readonly number[];
};

export type TrackedFrame = Pose & {
  readonly index: number;
  /** DWPose's left and right labels were exchanged in this frame and have been put back. */
  readonly swapped: boolean;
  readonly flags: JointFlags;
};

export type StabilizeOptions = {
  readonly fps: number;
  /** Subject masks per frame (from SAM 3.1 video tracking), in the poses' pixel grid; absent frames are not checked. */
  readonly masks?: ReadonlyMap<number, Mask>;
  readonly minCutoff?: number;
  readonly beta?: number;
};

/** Body joints and toes that carry the motion; face and finger points ride on them. */
const TRACKED = Array.from({ length: 23 }, (_, i) => i).filter((i) => i >= 5 || i === 0);
const MAX_GAP = 2;

type P = [number, number] | null;

function point(pose: Pose, i: number): P {
  const [x, y] = pose.keypoints[i] ?? [null, null];
  return x === null || y === null || (pose.scores[i] ?? 0) < MIN_CONFIDENCE ? null : [x, y];
}

function torso(pose: Pose): number | null {
  const [ls, rs, lh, rh] = [point(pose, 5), point(pose, 6), point(pose, 11), point(pose, 12)];
  if (!ls || !rs || !lh || !rh) return null;
  return Math.hypot((ls[0] + rs[0] - lh[0] - rh[0]) / 2, (ls[1] + rs[1] - lh[1] - rh[1]) / 2) || null;
}

export function mirrorPose(pose: Pose): Pose {
  const keypoints = pose.keypoints.map((p) => [p[0], p[1]] as [number | null, number | null]);
  const scores = [...pose.scores];
  for (const [a, b] of COCO_MIRROR) {
    [keypoints[a], keypoints[b]] = [keypoints[b], keypoints[a]];
    [scores[a], scores[b]] = [scores[b], scores[a]];
  }
  return { keypoints, scores };
}

/** Mean distance of the limb joints between two poses, in torso lengths; null when too few are shared. */
function limbDistance(a: Pose, b: Pose, unit: number): number | null {
  let [sum, n] = [0, 0];
  for (let i = 5; i <= 16; i++) {
    const [p, q] = [point(a, i), point(b, i)];
    if (!p || !q) continue;
    sum += Math.hypot(p[0] - q[0], p[1] - q[1]);
    n++;
  }
  return n >= 6 ? sum / n / unit : null;
}

/**
 * A frame whose left and right labels came out exchanged: its mirror-labelled
 * version sits much closer to the previous frame than it does. The body can't
 * turn half around in one frame, the labels can.
 */
export function swappedAgainst(previous: Pose, current: Pose): boolean {
  const unit = torso(previous) ?? torso(current);
  if (!unit) return false;
  const [straight, mirrored] = [limbDistance(previous, current, unit), limbDistance(previous, mirrorPose(current), unit)];
  return straight !== null && mirrored !== null && mirrored < straight * 0.5 && straight - mirrored > 0.25;
}

/** One-Euro filter (Casiez et al. 2012): low cutoff when still, rising with speed so fast moves aren't delayed. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(private readonly rate: number, private readonly minCutoff: number, private readonly beta: number, private readonly dCutoff = 1) {}
  private alpha(cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau * this.rate);
  }
  reset() { this.x = null; this.dx = 0; }
  next(value: number, unit: number): number {
    if (this.x === null) { this.x = value; return value; }
    const derivative = (value - this.x) * this.rate;
    this.dx += this.alpha(this.dCutoff) * (derivative - this.dx);
    // The speed term is in torso lengths per second: the same filter for a close-up and a wide shot.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx / unit);
    this.x += this.alpha(cutoff) * (value - this.x);
    return this.x;
  }
}

export function stabilizeTrack(frames: readonly Pose[], options: StabilizeOptions): TrackedFrame[] {
  // Measured on two real 9 fps runs (docs/sam-character-mapping.md): a cutoff near 0.28 × fps keeps
  // the extremities' lag at about a fifth of their travel and still removes a fifth of the jitter.
  const minCutoff = options.minCutoff ?? Math.max(1, options.fps * 0.28);
  const beta = options.beta ?? 3;
  // 1. Left/right swaps, against the last frame kept.
  const fixed: { pose: Pose; swapped: boolean }[] = [];
  let reference: Pose | null = null;
  for (const raw of frames) {
    const swapped: boolean = reference !== null && swappedAgainst(reference, raw);
    const pose: Pose = swapped ? mirrorPose(raw) : raw;
    fixed.push({ pose, swapped });
    if (torso(pose)) reference = pose;
  }
  // 2. Off-subject joints lose their confidence.
  const offSubject = fixed.map(({ pose }, t) => {
    const mask = options.masks?.get(t);
    if (!mask) return [] as number[];
    return TRACKED.filter((i) => {
      const p = point(pose, i);
      if (!p) return false;
      const [x, y] = [Math.round(p[0]), Math.round(p[1])];
      // A joint sits on the outline or a little outside it (a wrist at the edge of a sleeve): allow a margin.
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
        const [qx, qy] = [x + dx, y + dy];
        if (qx >= 0 && qy >= 0 && qx < mask.width && qy < mask.height && mask.data[qy * mask.width + qx]) return false;
      }
      return true;
    });
  });
  const seen = (t: number, i: number) => point(fixed[t].pose, i) !== null && !offSubject[t].includes(i);
  const unit = (() => {
    const torsos = fixed.map(({ pose }) => torso(pose)).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return torsos.length ? torsos[torsos.length >> 1] : 100;
  })();
  // 3. Bridge short dropouts, then 4. smooth each joint through time.
  const out = fixed.map(({ pose }) => ({ keypoints: pose.keypoints.map((p) => [p[0], p[1]] as [number | null, number | null]), scores: [...pose.scores] }));
  const bridged = frames.map(() => [] as number[]);
  const occluded = frames.map(() => [] as number[]);
  for (const i of TRACKED) {
    for (let t = 0; t < frames.length; t++) {
      if (seen(t, i)) continue;
      let end = t;
      while (end < frames.length && !seen(end, i)) end++;
      for (let k = t; k < end; k++) occluded[k].push(i);
      const [before, after] = [t - 1, end];
      if (before >= 0 && after < frames.length && end - t <= MAX_GAP) {
        const [a, b] = [point(fixed[before].pose, i)!, point(fixed[after].pose, i)!];
        for (let k = t; k < end; k++) {
          const f = (k - before) / (after - before);
          out[k].keypoints[i] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          out[k].scores[i] = Math.min(fixed[before].pose.scores[i], fixed[after].pose.scores[i]) * 0.5;
          bridged[k].push(i);
        }
      } else {
        for (let k = t; k < end; k++) if (offSubject[k].includes(i)) out[k].scores[i] = 0;
      }
      t = end - 1;
    }
    const fx = new OneEuro(options.fps, minCutoff, beta);
    const fy = new OneEuro(options.fps, minCutoff, beta);
    for (let t = 0; t < frames.length; t++) {
      const [x, y] = out[t].keypoints[i];
      if (x === null || y === null || (out[t].scores[i] ?? 0) < MIN_CONFIDENCE * 0.5) { fx.reset(); fy.reset(); continue; }
      out[t].keypoints[i] = [fx.next(x, unit), fy.next(y, unit)];
    }
  }
  // Face, hands and feet points move with their joint, by the joint's smoothing offset.
  const riders: readonly [number, readonly number[]][] = [
    [0, Array.from({ length: 68 }, (_, k) => 23 + k).concat([1, 2, 3, 4])],
    [9, Array.from({ length: 21 }, (_, k) => 91 + k)],
    [10, Array.from({ length: 21 }, (_, k) => 112 + k)],
  ];
  for (let t = 0; t < frames.length; t++) {
    for (const [joint, points] of riders) {
      const [before, after] = [fixed[t].pose.keypoints[joint], out[t].keypoints[joint]];
      if (before[0] === null || before[1] === null || after[0] === null || after[1] === null) continue;
      const [dx, dy] = [after[0] - before[0], after[1] - before[1]];
      for (const k of points) {
        const [x, y] = out[t].keypoints[k];
        if (x !== null && y !== null) out[t].keypoints[k] = [x + dx, y + dy];
      }
    }
  }
  return out.map((pose, t) => ({ ...pose, index: t + 1, swapped: fixed[t].swapped, flags: { occluded: occluded[t], bridged: bridged[t], offSubject: offSubject[t] } }));
}
