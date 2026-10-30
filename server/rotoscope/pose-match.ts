import type { Check } from "./run-state";

// Check 1: does the drawing hold the source frame's pose? Compared as bone
// directions, not pixel positions, so the character's own proportions don't
// count against it. Bones the source doesn't show clearly (low confidence, or
// foreshortened toward the camera) are skipped: DWPose can't measure them.

export type Pose = { readonly keypoints: readonly (readonly [number | null, number | null])[]; readonly scores: readonly number[] };

/** COCO-WholeBody indices. "Right" is the subject's right side. */
const BONES = [
  { name: "right upper arm", from: 6, to: 8 },
  { name: "right forearm", from: 8, to: 10 },
  { name: "left upper arm", from: 5, to: 7 },
  { name: "left forearm", from: 7, to: 9 },
  { name: "right thigh", from: 12, to: 14 },
  { name: "right shin", from: 14, to: 16 },
  { name: "left thigh", from: 11, to: 13 },
  { name: "left shin", from: 13, to: 15 },
] as const;

export type PoseThresholds = { readonly maxBoneDegrees: number; readonly meanDegrees: number; readonly minConfidence: number; readonly minBoneShare: number };
export const DEFAULT_POSE_THRESHOLDS: PoseThresholds = { maxBoneDegrees: 25, meanDegrees: 12, minConfidence: 0.3, minBoneShare: 0.45 };

type Point = readonly [number, number];

function point(pose: Pose, index: number, minConfidence: number): Point | null {
  const [x, y] = pose.keypoints[index] ?? [null, null];
  return x === null || y === null || (pose.scores[index] ?? 0) < minConfidence ? null : [x, y];
}

function mid(a: Point | null, b: Point | null): Point | null {
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
}

function torso(pose: Pose, minConfidence: number): number | null {
  const shoulders = mid(point(pose, 5, minConfidence), point(pose, 6, minConfidence));
  const hips = mid(point(pose, 11, minConfidence), point(pose, 12, minConfidence));
  return shoulders && hips ? Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]) || null : null;
}

/** Screen direction in words, for feedback the generator can act on. */
export function direction(dx: number, dy: number): string {
  const names = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return names[((Math.round(angle / 45) % 8) + 8) % 8];
}

export function angleBetween(a: Point, b: Point): number {
  const diff = Math.abs(Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])) * (180 / Math.PI);
  return diff > 180 ? 360 - diff : diff;
}

export type BoneResult = { readonly name: string; readonly degrees: number; readonly source: string; readonly drawn: string };

const average = (bones: readonly BoneResult[]) => (bones.length ? bones.reduce((sum, bone) => sum + bone.degrees, 0) / bones.length : 0);
const MIRROR_BONE_SHARE = 0.2;
const MIRROR: Record<number, number> = { 5: 6, 6: 5, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15 };

function measure(source: Pose, drawn: Pose, sourceTorso: number, thresholds: PoseThresholds, mirror: boolean, minBoneShare = thresholds.minBoneShare): { bones: BoneResult[]; missing: string[] } {
  const { minConfidence } = thresholds;
  const bones: BoneResult[] = [];
  const missing: string[] = [];
  for (const bone of BONES) {
    const a = point(source, bone.from, minConfidence);
    const b = point(source, bone.to, minConfidence);
    if (!a || !b) continue;
    const vs: Point = [b[0] - a[0], b[1] - a[1]];
    if (Math.hypot(...vs) < minBoneShare * sourceTorso) continue;
    const c = point(drawn, mirror ? MIRROR[bone.from] : bone.from, minConfidence);
    const d = point(drawn, mirror ? MIRROR[bone.to] : bone.to, minConfidence);
    if (!c || !d) { missing.push(bone.name); continue; }
    const vd: Point = [(d[0] - c[0]) * (mirror ? -1 : 1), d[1] - c[1]];
    bones.push({ name: bone.name, degrees: Math.round(angleBetween(vs, vd)), source: direction(...vs), drawn: direction(...vd) });
  }
  return { bones, missing };
}

export function comparePoses(source: Pose, drawn: Pose, thresholds: PoseThresholds = DEFAULT_POSE_THRESHOLDS): Check & { readonly bones: readonly BoneResult[]; readonly missing: readonly string[] } {
  const { minConfidence } = thresholds;
  const sourceTorso = torso(source, minConfidence);
  if (!sourceTorso) return { name: "pose", passed: true, detail: "source torso not visible; pose not measurable", bones: [], missing: [] };
  if (!torso(drawn, minConfidence)) {
    return { name: "pose", passed: false, detail: "no full body found in the drawing", feedback: "Draw the whole character, head to feet, facing the camera as in the pose reference.", bones: [], missing: [] };
  }
  // Facing the camera, the subject's right side is on the viewer's left.
  const [sl, sr] = [point(source, 5, minConfidence), point(source, 6, minConfidence)];
  const facing = !sl || !sr || sr[0] < sl[0];
  const screenSide = (name: string) => (name.startsWith("right") === facing ? "on the LEFT of the image" : "on the RIGHT of the image");
  const { bones, missing } = measure(source, drawn, sourceTorso, thresholds, false);
  const mean = average(bones);
  // A mirrored drawing (left and right swapped) matches the source once flipped back. Which side a
  // limb is on survives foreshortening, so this compares nearly every bone, not only the clear ones.
  const sideBones = measure(source, drawn, sourceTorso, thresholds, false, MIRROR_BONE_SHARE).bones;
  const sides = average(sideBones);
  const flipped = average(measure(source, drawn, sourceTorso, thresholds, true, MIRROR_BONE_SHARE).bones);
  const mirrored = sides > thresholds.meanDegrees && flipped <= thresholds.meanDegrees * 1.5 && flipped < sides / 2;
  const off = bones.filter((bone) => bone.degrees > thresholds.maxBoneDegrees);
  const passed = !mirrored && !missing.length && !off.length && mean <= thresholds.meanDegrees;
  const worst = [...bones].sort((x, y) => y.degrees - x.degrees)[0];
  const detail = `${mirrored ? "MIRRORED, " : ""}${bones.length} bones, mean ${mean.toFixed(1)}°, worst ${worst ? `${worst.name} ${worst.degrees}°` : "—"}${missing.length ? `, missing ${missing.join(", ")}` : ""}`;
  const fixes = mirrored
    ? [`The drawing is a mirror image of the pose: left and right are swapped. Keep each limb on the same side of the image as in the pose photo: ${sideBones.filter((bone) => bone.degrees > thresholds.maxBoneDegrees).map((bone) => `the ${bone.name.replace(/^(right|left) /, "")} ${screenSide(bone.name)} points ${bone.source}`).join("; ")}.`]
    : [
      ...off.map((bone) => `The ${bone.name.replace(/^(right|left) /, "")} ${screenSide(bone.name)} must point ${bone.source} on screen (it points ${bone.drawn}, ${bone.degrees}° off).`),
      ...missing.map((name) => `The ${name.replace(/^(right|left) /, "")} ${screenSide(name)} is missing or hidden; show it as in the pose photo.`),
    ];
  return { name: "pose", passed, detail, score: Math.round(mean * 10) / 10, ...(fixes.length ? { feedback: fixes.join(" ") } : passed ? {} : { feedback: "Match every limb angle of the pose reference more closely." }), bones, missing };
}

/**
 * The source pose in screen terms ("the arm on the LEFT of the image…"), for
 * the generator: told "the character's right arm", image models often draw the
 * mirror image. Bones the camera sees shortened are said to point toward the viewer.
 */
export function describePose(source: Pose, minConfidence = DEFAULT_POSE_THRESHOLDS.minConfidence): string {
  const p = (i: number) => point(source, i, minConfidence);
  const [ls, rs, lh, rh, nose] = [p(5), p(6), p(11), p(12), p(0)];
  const shoulders = mid(ls, rs);
  const hips = mid(lh, rh);
  if (!ls || !rs || !shoulders || !hips) return "";
  const torsoLength = Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]);
  const facing = rs[0] < ls[0];
  const sides = [
    { screen: facing ? "LEFT" : "RIGHT", shoulder: 6, elbow: 8, wrist: 10, hand: 112, hip: 12, knee: 14, ankle: 16 },
    { screen: facing ? "RIGHT" : "LEFT", shoulder: 5, elbow: 7, wrist: 9, hand: 91, hip: 11, knee: 13, ankle: 15 },
  ];
  // Where the hand is: its 21 points when DWPose sees them. On a forearm pointing at the camera
  // the wrist point lands high (on the forearm); the hand points stay where the hand is.
  const handAt = (base: number, wrist: Point | null): Point | null => {
    const points = Array.from({ length: 21 }, (_, i) => p(base + i)).filter((q): q is Point => q !== null);
    if (points.length < 5) return wrist;
    return [points.reduce((sum, q) => sum + q[0], 0) / points.length, points.reduce((sum, q) => sum + q[1], 0) / points.length];
  };
  const bone = (a: Point | null, b: Point | null) => {
    if (!a || !b) return "hidden";
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return length < 0.25 * torsoLength ? "toward the viewer (foreshortened)" : direction(b[0] - a[0], b[1] - a[1]);
  };
  const height = (y: number) =>
    nose && y < nose[1] - torsoLength * 0.15 ? "above the head"
      : y < shoulders[1] ? "at head height"
        : y < (shoulders[1] + hips[1]) / 2 ? "at chest height"
          : y < hips[1] + torsoLength * 0.25 ? "at waist height"
            : "below the hips";
  const lines = sides.map((side) => {
    const [shoulder, elbow, wrist] = [p(side.shoulder), p(side.elbow), p(side.wrist)];
    const hand = handAt(side.hand, wrist);
    const crosses = hand && Math.sign(hand[0] - shoulders[0]) !== Math.sign((p(side.shoulder) ?? shoulders)[0] - shoulders[0]) ? ", crossing in front of the body to the other side" : "";
    return `The arm on the ${side.screen} of the image: upper arm points ${bone(shoulder, elbow)}, forearm points ${bone(elbow, wrist)}, hand ${hand ? height(hand[1]) : "hidden"}${crosses}.`;
  });
  const [la, ra] = [p(15), p(16)];
  const feet = la && ra ? (Math.abs(la[0] - ra[0]) < Math.abs(ls[0] - rs[0]) * 0.5 ? "Legs straight with the feet close together." : "Feet apart.") : "";
  return [...lines, feet].filter(Boolean).join(" ");
}
