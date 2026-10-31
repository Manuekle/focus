import type { Pose } from "../rotoscope/pose-match";
import { angleOf, apply, dist, mid, norm, rotation, sub, type Vec } from "./geometry";

// The articulated skeleton the mapping engine works in, read from a
// COCO-WholeBody (133-point) pose. "left"/"right" are the subject's own
// sides, as DWPose and RTMW report them. Joints come only from a pose
// estimator: a segmentation mask never places a joint.

export const JOINT_NAMES = [
  "pelvis", "neck", "head",
  "leftShoulder", "leftElbow", "leftWrist", "leftHand",
  "rightShoulder", "rightElbow", "rightWrist", "rightHand",
  "leftHip", "leftKnee", "leftAnkle", "leftToe",
  "rightHip", "rightKnee", "rightAnkle", "rightToe",
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

export type Joint = { readonly p: Vec; readonly score: number };
export type Skeleton = Readonly<Record<JointName, Joint | null>>;

/** Draw order: higher is in front. Arms over the torso and head, the head over the torso, in a frontal anime pose. */
export const BONES = [
  { name: "torso", from: "pelvis", to: "neck", parent: null, z: 0 },
  { name: "head", from: "neck", to: "head", parent: "torso", z: 2 },
  { name: "leftUpperArm", from: "leftShoulder", to: "leftElbow", parent: "torso", z: 3 },
  { name: "leftForearm", from: "leftElbow", to: "leftWrist", parent: "leftUpperArm", z: 4 },
  { name: "leftHand", from: "leftWrist", to: "leftHand", parent: "leftForearm", z: 5 },
  { name: "rightUpperArm", from: "rightShoulder", to: "rightElbow", parent: "torso", z: 3 },
  { name: "rightForearm", from: "rightElbow", to: "rightWrist", parent: "rightUpperArm", z: 4 },
  { name: "rightHand", from: "rightWrist", to: "rightHand", parent: "rightForearm", z: 5 },
  { name: "leftThigh", from: "leftHip", to: "leftKnee", parent: "torso", z: 1 },
  { name: "leftShin", from: "leftKnee", to: "leftAnkle", parent: "leftThigh", z: 1 },
  { name: "leftFoot", from: "leftAnkle", to: "leftToe", parent: "leftShin", z: 1 },
  { name: "rightThigh", from: "rightHip", to: "rightKnee", parent: "torso", z: 1 },
  { name: "rightShin", from: "rightKnee", to: "rightAnkle", parent: "rightThigh", z: 1 },
  { name: "rightFoot", from: "rightAnkle", to: "rightToe", parent: "rightShin", z: 1 },
] as const satisfies readonly { name: string; from: JointName; to: JointName; parent: string | null; z: number }[];
export type BoneName = (typeof BONES)[number]["name"];
export type BoneDef = (typeof BONES)[number];
export const BONE_NAMES = BONES.map((bone) => bone.name) as readonly BoneName[];
export const boneDef = (name: BoneName): BoneDef => BONES.find((bone) => bone.name === name)!;
export const children = (name: BoneName): BoneName[] => BONES.filter((bone) => bone.parent === name).map((bone) => bone.name);

/** The limb chains whose direction comes from the source and whose length comes from the character. */
export const LIMB_BONES: readonly BoneName[] = BONES.filter((bone) => bone.parent !== null && bone.name !== "head").map((bone) => bone.name);

export const MIRROR_JOINT: Readonly<Record<JointName, JointName>> = Object.fromEntries(JOINT_NAMES.map((name) => [
  name,
  name.startsWith("left") ? (`right${name.slice(4)}` as JointName) : name.startsWith("right") ? (`left${name.slice(5)}` as JointName) : name,
])) as Record<JointName, JointName>;

/** COCO-WholeBody indices: body 0–16, feet 17–22, face 23–90, left hand 91–111, right hand 112–132. */
export const COCO = {
  nose: 0, leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8, leftWrist: 9, rightWrist: 10,
  leftHip: 11, rightHip: 12, leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16,
  leftBigToe: 17, leftSmallToe: 18, leftHeel: 19, rightBigToe: 20, rightSmallToe: 21, rightHeel: 22,
  leftHand: 91, rightHand: 112,
} as const;

/** Pairs swapped when a whole pose's left and right labels are exchanged. */
export const COCO_MIRROR: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 20], [18, 21], [19, 22],
  ...Array.from({ length: 21 }, (_, i) => [91 + i, 112 + i] as const),
];

export const MIN_CONFIDENCE = 0.3;

export function cocoPoint(pose: Pose, index: number, minConfidence = MIN_CONFIDENCE): Joint | null {
  const [x, y] = pose.keypoints[index] ?? [null, null];
  const score = pose.scores[index] ?? 0;
  return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) || score < minConfidence ? null : { p: [x, y], score };
}

function centroid(pose: Pose, base: number, count: number, minConfidence: number): Joint | null {
  const points = Array.from({ length: count }, (_, i) => cocoPoint(pose, base + i, minConfidence)).filter((q): q is Joint => q !== null);
  if (points.length < 4) return null;
  return {
    p: [points.reduce((s, q) => s + q.p[0], 0) / points.length, points.reduce((s, q) => s + q.p[1], 0) / points.length],
    score: points.reduce((s, q) => s + q.score, 0) / points.length,
  };
}

const midJoint = (a: Joint | null, b: Joint | null): Joint | null => (a && b ? { p: mid(a.p, b.p), score: Math.min(a.score, b.score) } : null);

/**
 * The named skeleton of a COCO-WholeBody pose. Hands are the centroid of the
 * hand points (or a forearm's third past the wrist when DWPose missed the
 * hand); toes are the big and small toe midpoint.
 */
export function skeletonFromPose(pose: Pose, minConfidence = MIN_CONFIDENCE): Skeleton {
  const p = (i: number) => cocoPoint(pose, i, minConfidence);
  const hand = (base: number, elbow: Joint | null, wrist: Joint | null): Joint | null => {
    const found = centroid(pose, base, 21, minConfidence);
    if (found) return found;
    if (!elbow || !wrist) return null;
    const forearm = sub(wrist.p, elbow.p);
    return { p: [wrist.p[0] + forearm[0] * 0.35, wrist.p[1] + forearm[1] * 0.35], score: wrist.score * 0.5 };
  };
  const [ls, rs, le, re, lw, rw] = [p(5), p(6), p(7), p(8), p(9), p(10)];
  const [lh, rh, lk, rk, la, ra] = [p(11), p(12), p(13), p(14), p(15), p(16)];
  return {
    pelvis: midJoint(lh, rh),
    neck: midJoint(ls, rs),
    head: p(0) ?? midJoint(p(1), p(2)),
    leftShoulder: ls, leftElbow: le, leftWrist: lw, leftHand: hand(COCO.leftHand, le, lw),
    rightShoulder: rs, rightElbow: re, rightWrist: rw, rightHand: hand(COCO.rightHand, re, rw),
    leftHip: lh, leftKnee: lk, leftAnkle: la, leftToe: midJoint(p(17), p(18)) ?? p(17),
    rightHip: rh, rightKnee: rk, rightAnkle: ra, rightToe: midJoint(p(20), p(21)) ?? p(20),
  };
}

export const torsoLength = (s: Skeleton): number | null => (s.pelvis && s.neck ? dist(s.pelvis.p, s.neck.p) || null : null);

export function boneVector(s: Skeleton, bone: BoneName): Vec | null {
  const def = boneDef(bone);
  const [a, b] = [s[def.from], s[def.to]];
  return a && b ? sub(b.p, a.p) : null;
}

export function boneLength(s: Skeleton, bone: BoneName): number | null {
  const v = boneVector(s, bone);
  return v ? norm(v) : null;
}

/**
 * The normalized character coordinate system: origin at the pelvis, one unit
 * = the torso (pelvis to neck), y pointing up the spine. Poses of different
 * people, sizes and camera distances compare in it directly.
 */
export type Frame = { readonly origin: Vec; readonly unit: number; readonly angle: number };

export function normalFrame(s: Skeleton): Frame | null {
  const length = torsoLength(s);
  if (!length || !s.pelvis || !s.neck) return null;
  // Screen y grows downward: the spine points to −y in an upright pose; rotate it onto +y of the normalized frame.
  const spine = sub(s.neck.p, s.pelvis.p);
  return { origin: s.pelvis.p, unit: length, angle: angleOf(spine) + Math.PI / 2 };
}

/** Pixel → normalized character coordinates (y up the spine). */
export function toNormal(frame: Frame, p: Vec): Vec {
  const q = apply(rotation(-frame.angle), sub(p, frame.origin));
  return [q[0] / frame.unit, -q[1] / frame.unit];
}

export function fromNormal(frame: Frame, q: Vec): Vec {
  const r = apply(rotation(frame.angle), [q[0] * frame.unit, -q[1] * frame.unit]);
  return [r[0] + frame.origin[0], r[1] + frame.origin[1]];
}

export function normalizeSkeleton(s: Skeleton): Record<JointName, Vec | null> | null {
  const frame = normalFrame(s);
  if (!frame) return null;
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, s[name] ? toNormal(frame, s[name]!.p) : null])) as Record<JointName, Vec | null>;
}

/** Facing the camera, the subject's right shoulder is on the viewer's left. */
export const facingCamera = (s: Skeleton) => !s.leftShoulder || !s.rightShoulder || s.rightShoulder.p[0] < s.leftShoulder.p[0];

export function mapSkeleton(s: Skeleton, f: (p: Vec) => Vec): Skeleton {
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, s[name] ? { p: f(s[name]!.p), score: s[name]!.score } : null])) as Skeleton;
}

/** Back to a COCO-WholeBody pose (body points and toes only), for the pose check and the guide renderer. */
export function poseFromSkeleton(s: Skeleton): Pose {
  const keypoints: [number | null, number | null][] = Array.from({ length: 133 }, () => [null, null]);
  const scores = new Array<number>(133).fill(0);
  const set = (index: number, joint: Joint | null) => {
    if (!joint) return;
    keypoints[index] = [joint.p[0], joint.p[1]];
    scores[index] = joint.score;
  };
  set(0, s.head);
  set(5, s.leftShoulder); set(6, s.rightShoulder); set(7, s.leftElbow); set(8, s.rightElbow); set(9, s.leftWrist); set(10, s.rightWrist);
  set(11, s.leftHip); set(12, s.rightHip); set(13, s.leftKnee); set(14, s.rightKnee); set(15, s.leftAnkle); set(16, s.rightAnkle);
  set(17, s.leftToe); set(20, s.rightToe);
  return { keypoints, scores };
}

