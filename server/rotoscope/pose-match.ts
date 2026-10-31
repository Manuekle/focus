import type { Check } from "./run-state";

// Check 1: does the drawing hold the source frame's pose? Compared as bone
// directions, not pixel positions, so the character's own proportions don't
// count against it. A bone too short on screen for its direction to rise above
// the estimator's keypoint noise (foreshortened toward the camera) is skipped,
// and a frame where too few of the clip's moving bones could be measured gets
// no verdict.

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

export type PoseThresholds = {
  readonly maxBoneDegrees: number;
  readonly meanDegrees: number;
  /** In the estimator's own score units (RTMW SimCC scores run 0–10, not probabilities): below it a point is not reported at all. */
  readonly minConfidence: number;
  /**
   * The estimator's keypoint noise in torso lengths: RTMW-x moves a joint 0.014–0.019 torso lengths between an
   * image and its mirror (docs/sam-character-mapping.md, pose benchmark). A bone's direction is only as sure as
   * its length allows against it (boneUncertainty).
   */
  readonly keypointNoise: number;
  /** The share of the clip's moving bones that must be measurable for a verdict; fewer: inconclusive. */
  readonly minCoverage: number;
};
export const DEFAULT_POSE_THRESHOLDS: PoseThresholds = { maxBoneDegrees: 25, meanDegrees: 12, minConfidence: 0.3, keypointNoise: 0.02, minCoverage: 0.5 };

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

/**
 * How uncertain a bone's screen direction is, in degrees (two sigma), when each of its two joints is
 * off by `noise` pixels: a short (foreshortened) bone's direction is noise, a long one's is sure.
 */
export function boneUncertainty(length: number, noise: number): number {
  return length <= 0 ? 180 : (2 * Math.atan((Math.SQRT2 * noise) / length) * 180) / Math.PI;
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

export type BoneResult = {
  readonly name: string;
  readonly degrees: number;
  /** Two-sigma direction uncertainty of the source and drawn bones together: errors within it are noise. */
  readonly uncertainty: number;
  readonly source: string;
  readonly drawn: string;
};

/** The angle beyond what the keypoints' noise can explain. */
const excess = (bone: BoneResult) => Math.max(0, bone.degrees - bone.uncertainty);
const average = (values: readonly number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const MIRROR: Record<number, number> = { 5: 6, 6: 5, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15 };

/**
 * Bones whose direction changes across the clip by more than `limit` degrees: the motion the clip is
 * about. A verdict that measured none of them says nothing about the frame.
 */
export function movingBones(clip: readonly Pose[], thresholds: PoseThresholds = DEFAULT_POSE_THRESHOLDS): string[] {
  const { minConfidence, keypointNoise, maxBoneDegrees } = thresholds;
  return BONES.filter((bone) => {
    const vectors = clip.flatMap((pose) => {
      const [a, b, size] = [point(pose, bone.from, minConfidence), point(pose, bone.to, minConfidence), torso(pose, minConfidence)];
      if (!a || !b || !size) return [];
      const v: Point = [b[0] - a[0], b[1] - a[1]];
      return boneUncertainty(Math.hypot(...v), keypointNoise * size) <= maxBoneDegrees ? [v] : [];
    });
    return vectors.some((v, i) => vectors.slice(i + 1).some((w) => angleBetween(v, w) > maxBoneDegrees));
  }).map((bone) => bone.name);
}

/** `limit`: the most direction uncertainty a source bone may have to be measured. */
function measure(source: Pose, drawn: Pose, thresholds: PoseThresholds, mirror: boolean, limit: number, hidden: ReadonlySet<number>): { bones: BoneResult[]; missing: string[]; unmeasured: string[] } {
  const { minConfidence, keypointNoise } = thresholds;
  const [sourceTorso, drawnTorso] = [torso(source, minConfidence) ?? 0, torso(drawn, minConfidence) ?? 0];
  const bones: BoneResult[] = [];
  const missing: string[] = [];
  const unmeasured: string[] = [];
  for (const bone of BONES) {
    const a = point(source, bone.from, minConfidence);
    const b = point(source, bone.to, minConfidence);
    if (!a || !b) continue;
    // A joint the source doesn't confirm (occluded, inferred) is never a measurement.
    if (hidden.has(bone.from) || hidden.has(bone.to)) { unmeasured.push(bone.name); continue; }
    const vs: Point = [b[0] - a[0], b[1] - a[1]];
    const sourceDoubt = boneUncertainty(Math.hypot(...vs), keypointNoise * sourceTorso);
    if (sourceDoubt > limit) { unmeasured.push(bone.name); continue; }
    const c = point(drawn, mirror ? MIRROR[bone.from] : bone.from, minConfidence);
    const d = point(drawn, mirror ? MIRROR[bone.to] : bone.to, minConfidence);
    if (!c || !d) { missing.push(bone.name); continue; }
    const vd: Point = [(d[0] - c[0]) * (mirror ? -1 : 1), d[1] - c[1]];
    // A drawn bone seen end-on has no direction to speak of either: its doubt is capped so it can't excuse everything.
    const drawnDoubt = Math.min(limit, boneUncertainty(Math.hypot(...vd), keypointNoise * drawnTorso));
    bones.push({ name: bone.name, degrees: Math.round(angleBetween(vs, vd)), uncertainty: Math.round(Math.hypot(sourceDoubt, drawnDoubt)), source: direction(...vs), drawn: direction(...vd) });
  }
  return { bones, missing, unmeasured };
}

export type PoseCheck = Check & {
  readonly bones: readonly BoneResult[];
  readonly missing: readonly string[];
  /** Bones the source shows too short to measure a direction on. */
  readonly unmeasured: readonly string[];
  /** Moving bones measured / moving bones in the frame: the share of the clip's motion this verdict saw. */
  readonly coverage: { readonly measured: number; readonly of: number };
};

/**
 * Check: does the drawing hold the source frame's pose? Bone directions, so the character's own
 * proportions don't count against it. Each bone's tolerance widens by how uncertain its direction is
 * (boneUncertainty); a bone too short to have a direction is not measured. When `clip` is given, the
 * bones that move in it must be measured for a verdict: legs that never move (and may be hidden under
 * a skirt, where the estimator still places them) can't pass a frame whose arms were never looked at.
 * `hidden`: source keypoints not confirmed as seen (joints.ts unconfirmed), never measured.
 */
export function comparePoses(source: Pose, drawn: Pose, thresholds: PoseThresholds = DEFAULT_POSE_THRESHOLDS, clip?: readonly Pose[], hidden: ReadonlySet<number> = new Set()): PoseCheck {
  const { minConfidence } = thresholds;
  const none = { bones: [], missing: [], unmeasured: [], coverage: { measured: 0, of: 0 } };
  if (!torso(source, minConfidence)) return { name: "pose", passed: false, status: "inconclusive", detail: "source torso not visible; pose not measurable", ...none };
  if (!torso(drawn, minConfidence)) {
    return { name: "pose", passed: false, status: "fail", detail: "no full body found in the drawing", feedback: "Draw the whole character, head to feet, facing the camera as in the pose reference.", ...none };
  }
  // Facing the camera, the subject's right side is on the viewer's left.
  const [sl, sr] = [point(source, 5, minConfidence), point(source, 6, minConfidence)];
  const facing = !sl || !sr || sr[0] < sl[0];
  const screenSide = (name: string) => (name.startsWith("right") === facing ? "on the LEFT of the image" : "on the RIGHT of the image");
  const { bones, missing, unmeasured } = measure(source, drawn, thresholds, false, thresholds.maxBoneDegrees, hidden);
  const mean = average(bones.map(excess));
  // A mirrored drawing (left and right swapped) matches the source once flipped back. Which side a limb is on
  // survives foreshortening, so this looks at bones twice as uncertain as the measured ones.
  const sideBones = measure(source, drawn, thresholds, false, thresholds.maxBoneDegrees * 2, hidden).bones;
  const sides = average(sideBones.map(excess));
  const flipped = average(measure(source, drawn, thresholds, true, thresholds.maxBoneDegrees * 2, hidden).bones.map(excess));
  const mirrored = sides > thresholds.meanDegrees && flipped <= thresholds.meanDegrees * 1.5 && flipped < sides / 2;
  const off = bones.filter((bone) => excess(bone) > thresholds.maxBoneDegrees);
  const present = new Set([...bones.map((bone) => bone.name), ...missing, ...unmeasured]);
  const critical = (clip ? movingBones(clip, thresholds) : BONES.map((bone) => bone.name)).filter((name) => present.has(name));
  const coverage = { measured: critical.filter((name) => bones.some((bone) => bone.name === name) || missing.includes(name)).length, of: critical.length };
  const failed = mirrored || missing.length > 0 || off.length > 0 || mean > thresholds.meanDegrees;
  // A confident failure stands however little was measured; a pass needs the motion to have been seen.
  const covered = coverage.of === 0 || coverage.measured / coverage.of >= thresholds.minCoverage;
  const status = failed ? "fail" : covered ? "pass" : "inconclusive";
  const worst = [...bones].sort((x, y) => excess(y) - excess(x))[0];
  const detail = `${mirrored ? "MIRRORED, " : ""}${bones.length} bones, mean ${mean.toFixed(1)}° beyond noise, worst ${worst ? `${worst.name} ${worst.degrees}° (±${worst.uncertainty}°)` : "—"}${missing.length ? `, missing ${missing.join(", ")}` : ""}${clip ? `; moving bones measured ${coverage.measured}/${coverage.of}` : ""}${status === "inconclusive" ? " — too few of the moving bones measurable for a verdict" : ""}`;
  const fixes = mirrored
    ? [`The drawing is a mirror image of the pose: left and right are swapped. Keep each limb on the same side of the image as in the pose photo: ${sideBones.filter((bone) => excess(bone) > thresholds.maxBoneDegrees).map((bone) => `the ${bone.name.replace(/^(right|left) /, "")} ${screenSide(bone.name)} points ${bone.source}`).join("; ")}.`]
    : [
      ...off.map((bone) => `The ${bone.name.replace(/^(right|left) /, "")} ${screenSide(bone.name)} must point ${bone.source} on screen (it points ${bone.drawn}, ${bone.degrees}° off).`),
      ...missing.map((name) => `The ${name.replace(/^(right|left) /, "")} ${screenSide(name)} is missing or hidden; show it as in the pose photo.`),
    ];
  return { name: "pose", passed: status === "pass", status, detail, score: Math.round(mean * 10) / 10, ...(fixes.length ? { feedback: fixes.join(" ") } : status === "fail" ? { feedback: "Match every limb angle of the pose reference more closely." } : {}), bones, missing, unmeasured, coverage };
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
  return [...lines, describeLegs(source, minConfidence)].filter(Boolean).join(" ");
}

/** Each arm bone's longest length over a clip (keys "shoulder-elbow" keypoint indices): its full length, seen side-on. */
export function armLengths(poses: readonly Pose[], minConfidence = DEFAULT_POSE_THRESHOLDS.minConfidence): Map<string, number> {
  const out = new Map<string, number>();
  for (const pose of poses) {
    for (const [a, b] of [[6, 8], [8, 10], [5, 7], [7, 9]]) {
      const [p, q] = [point(pose, a, minConfidence), point(pose, b, minConfidence)];
      if (p && q) out.set(`${a}-${b}`, Math.max(out.get(`${a}-${b}`) ?? 0, Math.hypot(q[0] - p[0], q[1] - p[1])));
    }
  }
  return out;
}

/**
 * Each arm measured in degrees on the video's joints: every bone's screen angle against the
 * horizontal and how far the elbow bends. Words like "up-left" let a reader call a 90° bend
 * "nearly straight"; numbers don't, and the frame's reading and the drawing are held to them.
 */
export function measureArms(source: Pose, full?: ReadonlyMap<string, number>, minConfidence = DEFAULT_POSE_THRESHOLDS.minConfidence): string {
  const p = (i: number) => point(source, i, minConfidence);
  const [ls, rs] = [p(5), p(6)];
  if (!ls || !rs) return "";
  const facing = rs[0] < ls[0];
  // Above or below the horizontal, toward one side of the image: 0° is level, 90° straight up or down.
  const bone = (a: Point, b: Point) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const tilt = Math.round((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
    if (tilt >= 80) return `${dy < 0 ? "straight up" : "straight down"} (${tilt}° from horizontal)`;
    return `toward the ${dx < 0 ? "left" : "right"} of the image, ${tilt}° ${dy < 0 ? "above" : "below"} horizontal`;
  };
  return [
    { screen: facing ? "LEFT" : "RIGHT", shoulder: 6, elbow: 8, wrist: 10 },
    { screen: facing ? "RIGHT" : "LEFT", shoulder: 5, elbow: 7, wrist: 9 },
  ].flatMap((side) => {
    const [shoulder, elbow, wrist] = [p(side.shoulder), p(side.elbow), p(side.wrist)];
    if (!shoulder || !elbow) return [];
    // A bone seen much shorter than its longest in the clip points toward or away from the viewer.
    const seen = (a: Point, b: Point, from: number, to: number) => {
      const longest = full?.get(`${from}-${to}`);
      const share = longest ? Math.hypot(b[0] - a[0], b[1] - a[1]) / longest : 1;
      return share < 0.85 ? `, FORESHORTENED: seen at ${Math.round(share * 100)} % of its full length because it points toward the viewer — draw it exactly this short` : "";
    };
    const parts = [`upper arm from shoulder to elbow ${bone(shoulder, elbow)}${seen(shoulder, elbow, side.shoulder, side.elbow)}`];
    if (wrist) {
      parts.push(`forearm from elbow to wrist ${bone(elbow, wrist)}${seen(elbow, wrist, side.elbow, side.wrist)}`);
      // 180° is a straight arm; the smaller, the tighter the bend.
      const inner = Math.round(angleBetween([shoulder[0] - elbow[0], shoulder[1] - elbow[1]], [wrist[0] - elbow[0], wrist[1] - elbow[1]]));
      parts.push(`elbow ${inner >= 160 ? "straight" : "BENT"}: ${inner}° between upper arm and forearm (180° = straight)`);
    }
    return [`Arm on the ${side.screen} of the image: ${parts.join("; ")}.`];
  }).join(" ");
}

/**
 * The legs in screen terms: crossed, knees together or apart, feet together or apart. Measured
 * on the joints, so the reviewer and the generator get the same facts: a glance at two figures
 * calls knees-together legs crossed one time and straight the next.
 */
export function describeLegs(source: Pose, minConfidence = DEFAULT_POSE_THRESHOLDS.minConfidence): string {
  const p = (i: number) => point(source, i, minConfidence);
  const [ls, rs, lh, rh, lk, rk, la, ra] = [p(5), p(6), p(11), p(12), p(13), p(14), p(15), p(16)];
  if (!lh || !rh || !ls || !rs) return "";
  const hips = lh[0] - rh[0];
  const width = Math.abs(ls[0] - rs[0]);
  // A leg's knee or foot past the other one's, against the hips' order, is a crossed leg.
  const crossed = (l: Point | null, r: Point | null) => Boolean(l && r && Math.sign(l[0] - r[0]) !== Math.sign(hips) && Math.abs(l[0] - r[0]) > width * 0.05);
  const knees = !lk || !rk ? "" : crossed(lk, rk) ? "the legs cross at the knees" : Math.abs(lk[0] - rk[0]) < Math.abs(hips) * 0.45 ? "the knees are pulled together, touching" : "";
  // How far apart against the shoulders: told only "apart", the generator draws a wide stance.
  const gap = la && ra ? Math.abs(la[0] - ra[0]) / Math.max(1, width) : 0;
  const feet = !la || !ra ? "" : crossed(la, ra) ? "the legs cross, each foot on the other leg's side"
    : gap < 0.5 ? "the feet are close together" : gap < 1 ? "the feet are a little apart, closer than the shoulders are wide" : "the feet are apart, as wide as the shoulders or wider";
  // A knee bends when the shin leaves the thigh's line: under 12° is straight, under 25° barely
  // bent. Said either way: left unsaid, the generator bends the knees into a dance crouch.
  const bend = (hip: Point | null, knee: Point | null, ankle: Point | null) => (hip && knee && ankle ? angleBetween([knee[0] - hip[0], knee[1] - hip[1]], [ankle[0] - knee[0], ankle[1] - knee[1]]) : null);
  const bends = [bend(lh, lk, la), bend(rh, rk, ra)];
  const known = bends.every((angle) => angle !== null);
  const most = Math.max(...bends.map((angle) => angle ?? 0));
  const straight = !known ? "" : most < 12 ? "both legs straight, knees not bent" : most < 25 ? "both legs nearly straight, knees only slightly bent (no crouch)" : "";
  const parts = [straight, knees, feet].filter(Boolean);
  return parts.length ? `Legs: ${parts.join(", ")}.` : "";
}
