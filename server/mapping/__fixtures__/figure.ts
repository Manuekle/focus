import type { Rgba } from "../../rotoscope/alpha";
import type { Pose } from "../../rotoscope/pose-match";
import { segmentDistance, type Vec } from "../geometry";
import { BONES, poseFromSkeleton, torsoLength, type BoneName, type JointName, type Skeleton } from "../skeleton";

// A synthetic character for the mapping tests: every bone a capsule in its
// own flat colour with a dark outline (line art), the torso a quad, the head
// a disc. Because each bone has a unique colour, the pose of any warped copy
// can be measured from its pixels alone, with no pose model.

export const COLOURS: Readonly<Record<BoneName, readonly [number, number, number]>> = {
  torso: [235, 235, 235], head: [90, 90, 170],
  leftUpperArm: [230, 90, 90], leftForearm: [235, 160, 80], leftHand: [240, 210, 130],
  rightUpperArm: [90, 110, 230], rightForearm: [90, 180, 235], rightHand: [160, 215, 240],
  leftThigh: [90, 190, 90], leftShin: [60, 140, 70], leftFoot: [150, 110, 60],
  rightThigh: [200, 90, 200], rightShin: [150, 70, 150], rightFoot: [110, 70, 130],
};
const OUTLINE = 3;
const RADIUS: Partial<Record<BoneName, number>> = { leftUpperArm: 0.11, rightUpperArm: 0.11, leftForearm: 0.09, rightForearm: 0.09, leftHand: 0.1, rightHand: 0.1, leftThigh: 0.16, rightThigh: 0.16, leftShin: 0.12, rightShin: 0.12, leftFoot: 0.1, rightFoot: 0.1 };

export const joints = (points: Partial<Record<JointName, Vec>>, score = 0.9): Skeleton =>
  Object.fromEntries((["pelvis", "neck", "head", "leftShoulder", "leftElbow", "leftWrist", "leftHand", "rightShoulder", "rightElbow", "rightWrist", "rightHand", "leftHip", "leftKnee", "leftAnkle", "leftToe", "rightHip", "rightKnee", "rightAnkle", "rightToe"] as JointName[])
    .map((name) => [name, points[name] ? { p: points[name]!, score } : null])) as unknown as Skeleton;

/** Pelvis and neck filled in from the hips and shoulders. */
export function withCentres(s: Skeleton): Skeleton {
  const mid = (a: JointName, b: JointName) => (s[a] && s[b] ? { p: [(s[a]!.p[0] + s[b]!.p[0]) / 2, (s[a]!.p[1] + s[b]!.p[1]) / 2] as Vec, score: 0.9 } : null);
  return { ...s, pelvis: s.pelvis ?? mid("leftHip", "rightHip"), neck: s.neck ?? mid("leftShoulder", "rightShoulder") };
}

/** A frontal standing figure, 1024×1536, the subject's left on the image right. */
export function standing(): Skeleton {
  return withCentres(joints({
    head: [512, 300],
    leftShoulder: [600, 420], leftElbow: [650, 620], leftWrist: [680, 800], leftHand: [690, 860],
    rightShoulder: [424, 420], rightElbow: [374, 620], rightWrist: [344, 800], rightHand: [334, 860],
    leftHip: [570, 760], leftKnee: [590, 1040], leftAnkle: [600, 1320], leftToe: [640, 1360],
    rightHip: [454, 760], rightKnee: [434, 1040], rightAnkle: [424, 1320], rightToe: [384, 1360],
  }));
}

function insideQuad(p: Vec, q: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if ((q[i][1] > p[1]) !== (q[j][1] > p[1]) && p[0] < ((q[j][0] - q[i][0]) * (p[1] - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) inside = !inside;
  }
  return inside;
}

/** Renders the figure on a transparent canvas, or on `backdrop` (an opaque sheet). */
export function renderFigure(s: Skeleton, size = { width: 1024, height: 1536 }, backdrop?: readonly [number, number, number]): Rgba {
  const { width, height } = size;
  const data = Buffer.alloc(width * height * 4);
  if (backdrop) for (let p = 0; p < width * height; p++) { data[p * 4] = backdrop[0]; data[p * 4 + 1] = backdrop[1]; data[p * 4 + 2] = backdrop[2]; data[p * 4 + 3] = 255; }
  const torso = torsoLength(s) ?? 300;
  const paint = (inside: (p: Vec) => number, colour: readonly [number, number, number]) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const d = inside([x + 0.5, y + 0.5]);
      if (d > OUTLINE) continue;
      const c = d > 0 ? [25, 25, 30] : colour;
      const p = (y * width + x) * 4;
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  };
  const order: BoneName[] = ["torso", "leftThigh", "rightThigh", "leftShin", "rightShin", "leftFoot", "rightFoot", "head", "leftUpperArm", "rightUpperArm", "leftForearm", "rightForearm", "leftHand", "rightHand"];
  for (const name of order) {
    if (name === "torso") {
      const quad = [s.leftShoulder!.p, s.rightShoulder!.p, s.rightHip!.p, s.leftHip!.p];
      const edges = (p: Vec) => (insideQuad(p, quad) ? -1 : Math.min(...quad.map((a, i) => segmentDistance(p, a, quad[(i + 1) % 4]).distance)));
      paint(edges, COLOURS.torso);
      continue;
    }
    if (name === "head") {
      const r = torso * 0.32;
      paint((p) => Math.hypot(p[0] - s.head!.p[0], p[1] - s.head!.p[1]) - r, COLOURS.head);
      continue;
    }
    const def = BONES.find((bone) => bone.name === name)!;
    const [a, b] = [s[def.from as JointName], s[def.to as JointName]];
    if (!a || !b) continue;
    const r = (RADIUS[name] ?? 0.1) * torso;
    paint((p) => segmentDistance(p, a.p, b.p).distance - r, COLOURS[name]);
  }
  return { data, width, height };
}

const near = (data: Buffer, p: number, c: readonly number[]) => Math.abs(data[p * 4] - c[0]) <= 8 && Math.abs(data[p * 4 + 1] - c[1]) <= 8 && Math.abs(data[p * 4 + 2] - c[2]) <= 8 && data[p * 4 + 3] > 200;

/** A bone's pixels: centroid, principal axis and end points (the round caps trimmed off). */
export function measureBone(image: Rgba, bone: BoneName): { centre: Vec; ends: [Vec, Vec]; count: number } | null {
  let [n, sx, sy] = [0, 0, 0];
  const points: Vec[] = [];
  for (let p = 0; p < image.width * image.height; p++) {
    if (!near(image.data, p, COLOURS[bone])) continue;
    const q: Vec = [(p % image.width) + 0.5, Math.floor(p / image.width) + 0.5];
    points.push(q); sx += q[0]; sy += q[1]; n++;
  }
  if (n < 30) return null;
  const centre: Vec = [sx / n, sy / n];
  let [xx, xy, yy] = [0, 0, 0];
  for (const [x, y] of points) { xx += (x - centre[0]) ** 2; xy += (x - centre[0]) * (y - centre[1]); yy += (y - centre[1]) ** 2; }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis: Vec = [Math.cos(angle), Math.sin(angle)];
  let [lo, hi, wide] = [Infinity, -Infinity, 0];
  for (const [x, y] of points) {
    const t = (x - centre[0]) * axis[0] + (y - centre[1]) * axis[1];
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    wide = Math.max(wide, Math.abs(-(x - centre[0]) * axis[1] + (y - centre[1]) * axis[0]));
  }
  const trim = Math.min(wide, (hi - lo) / 3);
  return { centre, ends: [[centre[0] + axis[0] * (lo + trim), centre[1] + axis[1] * (lo + trim)], [centre[0] + axis[0] * (hi - trim), centre[1] + axis[1] * (hi - trim)]], count: n };
}

/**
 * The pose of a synthetic figure, measured from its colours: each chain bone's end nearer its parent's
 * far joint is its first joint (nearer the parent's centre flips a forearm folded back past the elbow).
 */
export function measuredPose(image: Rgba): Pose {
  const s: Partial<Record<JointName, Vec>> = {};
  const torso = measureBone(image, "torso");
  const head = measureBone(image, "head");
  // An arm starts at the end nearer the head (a hanging arm's elbow can be nearer the torso's centre); a leg at the end nearer the torso.
  const chain = (bones: readonly BoneName[], names: readonly JointName[]) => {
    let anchor = (bones[0].endsWith("UpperArm") ? head?.centre : torso?.centre) ?? [image.width / 2, image.height / 2];
    for (const [i, bone] of bones.entries()) {
      const m = measureBone(image, bone);
      if (!m) return;
      const [a, b] = m.ends;
      const [from, to] = Math.hypot(a[0] - anchor[0], a[1] - anchor[1]) <= Math.hypot(b[0] - anchor[0], b[1] - anchor[1]) ? [a, b] : [b, a];
      if (i === 0) s[names[0]] = from;
      s[names[i + 1]] = to;
      anchor = to;
    }
  };
  chain(["leftUpperArm", "leftForearm"], ["leftShoulder", "leftElbow", "leftWrist"]);
  chain(["rightUpperArm", "rightForearm"], ["rightShoulder", "rightElbow", "rightWrist"]);
  chain(["leftThigh", "leftShin"], ["leftHip", "leftKnee", "leftAnkle"]);
  chain(["rightThigh", "rightShin"], ["rightHip", "rightKnee", "rightAnkle"]);
  if (head) s.head = head.centre;
  return poseFromSkeleton(withCentres(joints(s)));
}
