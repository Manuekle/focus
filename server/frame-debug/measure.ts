import type { Rgba } from "../rotoscope/alpha";
import type { Pose } from "../rotoscope/pose-match";
import { angleDiff, angleOf, dist, lerp, mid, norm, segmentDistance, sub, type Vec } from "../mapping/geometry";
import { components, type Mask } from "../mapping/mask";
import { palette, paletteSimilarity } from "../mapping/profile";
import { BONES, JOINT_NAMES, MIRROR_JOINT, cocoPoint, skeletonFromPose, torsoLength, type JointName, type Skeleton } from "../mapping/skeleton";

// The single-frame evaluation: the generated drawing against the pose reference
// (Image A) for the pose, and against the character reference (Image B) for the
// identity. Every number is measured on whole-body keypoints (RTMW, COCO-WholeBody)
// and figure masks; nothing is a model's opinion. Where no robust measure exists
// (a face's identity, a hair shape) the check says so and points at the crops
// instead of inventing a score. Each check carries the exact method and limits.
//
// "left"/"right" are the subject's own sides, as the pose estimator reports them:
// facing the viewer, the subject's left is on the right of the image.

export type Figure = { readonly pose: Pose | null; readonly image: Rgba; readonly mask: Mask | null };

export type Status = "ok" | "warn" | "fail" | "unmeasured" | "manual";

export type DebugCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: Status;
  /** One line: what was found. */
  readonly summary: string;
  /** How it was measured and against which limits. */
  readonly method: string;
  readonly values: Readonly<Record<string, unknown>>;
};

type Limit = { readonly ok: number; readonly warn: number };

/** Every limit in one place: at or under `ok` passes, over `warn` fails (similarities: at or over). */
export const LIMITS = {
  /** Mean screen-angle error over the measured bones, degrees. */
  meanDegrees: { ok: 12, warn: 20 },
  /** One bone's screen-angle error, degrees. */
  boneDegrees: { ok: 15, warn: 30 },
  /** Head tilt (eye line) and neck-to-nose direction, degrees. */
  headDegrees: { ok: 10, warn: 20 },
  /** Hand's offset from its shoulder, difference in torso lengths. */
  handTorso: { ok: 0.25, warn: 0.45 },
  /** A hand's height against the eye line, difference in face heights. */
  headContact: { ok: 0.25, warn: 0.5 },
  /** Knee and ankle spacing, difference in hip widths. */
  spacing: { ok: 0.35, warn: 0.7 },
  /** One foot higher than the other, difference in torso lengths. */
  footLift: { ok: 0.1, warn: 0.2 },
  /** A body ratio against the character reference, relative difference. */
  proportion: { ok: 0.15, warn: 0.3 },
  /** CIE76 ΔE between dominant colours. */
  colour: { ok: 12, warn: 25 },
  /** Figure colour histograms, intersection (1 = same colours in the same amounts). */
  palette: { ok: 0.6, warn: 0.4 },
} as const satisfies Record<string, Limit>;

/** A bone in Image A shorter than this share of the torso points at the camera: its direction isn't judged. */
const FORESHORTENED = 0.25;
/** A sampled segment with at least this share of background is a gap between limbs. */
const GAP = 0.15;
/** ...and with less than this share, the gap is closed. */
const CLOSED = 0.03;
const MIN_HAND_POINTS = 5;
const MIN_FACE_POINTS = 20;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

const grade = (value: number, limit: Limit): Status => (value <= limit.ok ? "ok" : value <= limit.warn ? "warn" : "fail");
const gradeHigh = (value: number, limit: Limit): Status => (value >= limit.ok ? "ok" : value >= limit.warn ? "warn" : "fail");
const RANK: Partial<Record<Status, number>> = { ok: 0, warn: 1, fail: 2 };
function worst(...statuses: Status[]): Status {
  const measured = statuses.filter((status) => RANK[status] !== undefined);
  return measured.length ? measured.reduce((a, b) => (RANK[b]! > RANK[a]! ? b : a)) : "unmeasured";
}

type Body = { readonly pose: Pose; readonly sk: Skeleton; readonly torso: number };

function body(pose: Pose | null): Body | null {
  if (!pose) return null;
  const sk = skeletonFromPose(pose);
  const torso = torsoLength(sk);
  return torso ? { pose, sk, torso } : null;
}

const at = (b: Body, name: JointName): Vec | null => b.sk[name]?.p ?? null;
function vec(b: Body, from: JointName, to: JointName): Vec | null {
  const [p, q] = [at(b, from), at(b, to)];
  return p && q ? sub(q, p) : null;
}
/** Screen-angle difference between two bones, degrees (0–180). */
const boneError = (a: Vec, b: Vec) => angleDiff(angleOf(a), angleOf(b));
/** Inner angle at `b` between b→a and b→c, degrees (180 = straight). */
const inner = (a: Vec, b: Vec, c: Vec) => angleDiff(angleOf(sub(a, b)), angleOf(sub(c, b)));
const point = (pose: Pose, index: number): Vec | null => cocoPoint(pose, index)?.p ?? null;
const count = (pose: Pose, base: number, n: number) => Array.from({ length: n }, (_, i) => point(pose, base + i)).filter(Boolean).length;
const HAND_BASE = { left: 91, right: 112 } as const;

function unmeasured(id: string, label: string, method: string, reason: string): DebugCheck {
  return { id, label, status: "unmeasured", summary: reason, method, values: {} };
}

/** The drawing with left and right exchanged and flipped back: what a mirrored drawing matches. */
function mirrored(b: Body): Body {
  const sk = Object.fromEntries(JOINT_NAMES.map((name) => {
    const joint = b.sk[MIRROR_JOINT[name]];
    return [name, joint ? { p: [-joint.p[0], joint.p[1]] as Vec, score: joint.score } : null];
  })) as unknown as Skeleton;
  return { ...b, sk };
}

/** Facing the viewer (subject's right shoulder on the image's left), sides as the viewer sees them. */
function screen(b: Body, side: "left" | "right"): string {
  const [ls, rs] = [at(b, "leftShoulder"), at(b, "rightShoulder")];
  if (!ls || !rs) return "";
  const facing = rs[0] < ls[0];
  return (side === "left") === facing ? "right of the image" : "left of the image";
}

const SEGMENTS: readonly { readonly name: string; readonly from: JointName; readonly to: JointName; readonly line?: true }[] = [
  ...BONES.map((bone) => ({ name: bone.name, from: bone.from as JointName, to: bone.to as JointName })),
  { name: "shoulderLine", from: "leftShoulder", to: "rightShoulder", line: true },
  { name: "hipLine", from: "leftHip", to: "rightHip", line: true },
];

function segmentErrors(a: Body, out: Body) {
  const bones: { name: string; degrees: number }[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  for (const segment of SEGMENTS) {
    const va = vec(a, segment.from, segment.to);
    if (!va) { skipped.push(`${segment.name} (not visible in A)`); continue; }
    if (!segment.line && norm(va) < FORESHORTENED * a.torso) { skipped.push(`${segment.name} (foreshortened in A)`); continue; }
    const vo = vec(out, segment.from, segment.to);
    if (!vo) { missing.push(segment.name); continue; }
    bones.push({ name: segment.name, degrees: Math.round(boneError(va, vo)) });
  }
  const mean = bones.length ? bones.reduce((sum, bone) => sum + bone.degrees, 0) / bones.length : null;
  return { bones, missing, skipped, mean };
}

function poseGlobal(a: Body | null, out: Body | null): DebugCheck {
  const id = "pose_global";
  const label = "Global pose fidelity";
  const method = `Screen angle of every bone (torso, neck-head, arms, hands, legs, feet) plus the shoulder and hip lines, Image A vs output. Bones shorter than ${FORESHORTENED} torso in A point at the camera and are skipped. Mean ok ≤ ${LIMITS.meanDegrees.ok}°, fail > ${LIMITS.meanDegrees.warn}°; any single bone over ${LIMITS.boneDegrees.warn}° makes it at least a warning. Mirrored when the drawing flipped left-right matches A far better (mean < 60 % of the straight one).`;
  if (!a) return unmeasured(id, label, method, "no torso found in Image A: the pose can't be measured");
  if (!out) return { id, label, status: "fail", summary: "no torso found in the output: no full body the pose estimator can read", method, values: {} };
  const straight = segmentErrors(a, out);
  const flipped = segmentErrors(a, mirrored(out));
  if (straight.mean === null) return unmeasured(id, label, method, "no bone measurable in both images");
  const isMirrored = flipped.mean !== null && flipped.mean < straight.mean * 0.6 && straight.mean > LIMITS.meanDegrees.ok;
  const worstBone = [...straight.bones].sort((x, y) => y.degrees - x.degrees)[0];
  const off = straight.bones.filter((bone) => bone.degrees > LIMITS.boneDegrees.warn).map((bone) => `${bone.name} ${bone.degrees}°`);
  // A good mean can hide one bone that is badly off: that alone is at least a warning.
  const status = isMirrored ? "fail" : worst(grade(straight.mean, LIMITS.meanDegrees), straight.missing.length || off.length ? "warn" : "ok");
  return {
    id, label, status, method,
    summary: `${isMirrored ? "MIRRORED (left and right swapped); " : ""}mean ${r1(straight.mean)}° over ${straight.bones.length} bones, worst ${worstBone.name} ${worstBone.degrees}°${off.length ? `; off by > ${LIMITS.boneDegrees.warn}°: ${off.join(", ")}` : ""}${straight.missing.length ? `; missing in output: ${straight.missing.join(", ")}` : ""}`,
    values: { meanDegrees: r1(straight.mean), mirroredMeanDegrees: flipped.mean === null ? null : r1(flipped.mean), mirrored: isMirrored, bones: straight.bones, missing: straight.missing, skipped: straight.skipped },
  };
}

function headPosition(a: Body | null, out: Body | null): DebugCheck {
  const id = "head_position";
  const label = "Head position";
  const method = `Head tilt = angle of the eye line (COCO points 1–2); head direction = neck→nose angle; turn = nose offset from the eyes' midpoint in eye distances (reported, not graded). Worst of tilt and direction: ok ≤ ${LIMITS.headDegrees.ok}°, fail > ${LIMITS.headDegrees.warn}°.`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const neckHeadA = vec(a, "neck", "head");
  const neckHeadOut = vec(out, "neck", "head");
  if (!neckHeadA) return unmeasured(id, label, method, "no nose in Image A");
  if (!neckHeadOut) return { id, label, status: "fail", summary: "no face found in the output", method, values: {} };
  const eyes = (b: Body) => {
    const [l, r] = [point(b.pose, 1), point(b.pose, 2)];
    return l && r ? { line: sub(r, l), mid: mid(l, r), width: dist(l, r) } : null;
  };
  const [ea, eo] = [eyes(a), eyes(out)];
  const direction = boneError(neckHeadA, neckHeadOut);
  const tilt = ea && eo ? boneError(ea.line, eo.line) : null;
  const turn = (b: Body, e: ReturnType<typeof eyes>) => (e && e.width > 0 ? r2((at(b, "head")![0] - e.mid[0]) / e.width) : null);
  const [turnA, turnOut] = [turn(a, ea), turn(out, eo)];
  const status = worst(grade(direction, LIMITS.headDegrees), tilt === null ? "ok" : grade(tilt, LIMITS.headDegrees));
  return {
    id, label, status, method,
    summary: `neck→head direction off by ${Math.round(direction)}°${tilt === null ? ", eye line not measurable" : `, eye-line tilt off by ${Math.round(tilt)}°`}${turnA !== null && turnOut !== null ? `, turn ${turnA} in A vs ${turnOut} in output` : ""}`,
    values: { directionDegrees: Math.round(direction), tiltDegrees: tilt === null ? null : Math.round(tilt), turnA, turnOutput: turnOut },
  };
}

function arm(a: Body | null, out: Body | null, side: "left" | "right"): DebugCheck {
  const id = `${side}_arm`;
  const label = `${side === "left" ? "Left" : "Right"} arm`;
  const method = `Subject's ${side} arm. Screen angle of the upper arm (shoulder→elbow) and forearm (elbow→wrist), and the elbow's inner angle, A vs output. Worst: ok ≤ ${LIMITS.boneDegrees.ok}°, fail > ${LIMITS.boneDegrees.warn}°. A bone shorter than ${FORESHORTENED} torso in A is foreshortened: its direction isn't judged.`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const [s, e, w] = [`${side}Shoulder`, `${side}Elbow`, `${side}Wrist`] as JointName[];
  const where = screen(a, side);
  const parts: { name: string; from: JointName; to: JointName }[] = [{ name: "upper arm", from: s, to: e }, { name: "forearm", from: e, to: w }];
  const errors: Record<string, number | string> = {};
  const notes: string[] = [];
  const statuses: Status[] = [];
  for (const part of parts) {
    const va = vec(a, part.from, part.to);
    if (!va) { notes.push(`${part.name} not visible in A`); continue; }
    const vo = vec(out, part.from, part.to);
    if (!vo) { notes.push(`${part.name} MISSING in output`); statuses.push("fail"); continue; }
    if (norm(va) < FORESHORTENED * a.torso) { notes.push(`${part.name} foreshortened in A (not judged)`); continue; }
    const error = Math.round(boneError(va, vo));
    errors[part.name] = error;
    statuses.push(grade(error, LIMITS.boneDegrees));
  }
  const joints = (b: Body) => [at(b, s), at(b, e), at(b, w)] as const;
  const [ja, jo] = [joints(a), joints(out)];
  let bend: { a: number; out: number } | null = null;
  if (ja.every(Boolean) && jo.every(Boolean)) {
    bend = { a: Math.round(inner(ja[0]!, ja[1]!, ja[2]!)), out: Math.round(inner(jo[0]!, jo[1]!, jo[2]!)) };
    statuses.push(grade(Math.abs(bend.a - bend.out), LIMITS.boneDegrees));
  }
  if (!statuses.length) return unmeasured(id, label, method, notes.join("; ") || "arm not measurable");
  const listed = Object.entries(errors).map(([name, degrees]) => `${name} off by ${degrees}°`);
  return {
    id, label, status: worst(...statuses), method,
    summary: [`on the ${where}`, ...listed, ...(bend ? [`elbow ${bend.a}° in A vs ${bend.out}° in output (180° = straight)`] : []), ...notes].join("; "),
    values: { screenSide: where, errorsDegrees: errors, elbowA: bend?.a ?? null, elbowOutput: bend?.out ?? null, notes },
  };
}

function hand(a: Body | null, out: Body | null, side: "left" | "right"): DebugCheck {
  const id = `${side}_hand`;
  const label = `${side === "left" ? "Left" : "Right"} hand`;
  const method = `Subject's ${side} hand = centroid of its 21 hand keypoints (or a point past the wrist when they aren't found). Placement = the hand's offset from its own shoulder in that image's torso lengths, A vs output: ok ≤ ${LIMITS.handTorso.ok}, fail > ${LIMITS.handTorso.warn}. Direction (wrist→hand) graded like a bone when both images have ≥ ${MIN_HAND_POINTS} hand points. Fewer than half of A's hand points found in the output is flagged: a hand the estimator can't read is often malformed, hidden or merged (weak signal on anime drawings).`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const [s, w, h] = [`${side}Shoulder`, `${side}Wrist`, `${side}Hand`] as JointName[];
  const [sa, ha, so, ho] = [at(a, s), at(a, h), at(out, s), at(out, h)];
  const pointsA = count(a.pose, HAND_BASE[side], 21);
  const pointsOut = count(out.pose, HAND_BASE[side], 21);
  if (!sa || !ha) return unmeasured(id, label, method, "hand or shoulder not visible in A");
  if (!so || !ho) return { id, label, status: "fail", summary: "hand MISSING in the output", method, values: { pointsA, pointsOutput: pointsOut } };
  const offA: Vec = [(ha[0] - sa[0]) / a.torso, (ha[1] - sa[1]) / a.torso];
  const offOut: Vec = [(ho[0] - so[0]) / out.torso, (ho[1] - so[1]) / out.torso];
  const placement = dist(offA, offOut);
  const statuses: Status[] = [grade(placement, LIMITS.handTorso)];
  let direction: number | null = null;
  const [va, vo] = [vec(a, w, h), vec(out, w, h)];
  if (va && vo && pointsA >= MIN_HAND_POINTS && pointsOut >= MIN_HAND_POINTS) {
    direction = Math.round(boneError(va, vo));
    statuses.push(grade(direction, LIMITS.boneDegrees));
  }
  const unreadable = pointsA >= 10 && pointsOut < pointsA * 0.5;
  if (unreadable) statuses.push("warn");
  const drift: Vec = sub(offOut, offA);
  return {
    id, label, status: worst(...statuses), method,
    summary: `placed ${r2(placement)} torso from where A has it (output is ${Math.abs(drift[0]) > Math.abs(drift[1]) ? (drift[0] > 0 ? "further right" : "further left") : drift[1] > 0 ? "lower" : "higher"})${direction === null ? "" : `, points ${direction}° off`}; hand keypoints ${pointsA}/21 in A, ${pointsOut}/21 in output${unreadable ? " — hand poorly readable in output" : ""}`,
    values: { placementTorso: r2(placement), offsetA: offA.map(r2), offsetOutput: offOut.map(r2), directionDegrees: direction, pointsA, pointsOutput: pointsOut },
  };
}

export type HeadContact = {
  /** The hand's height above the eye line, in face heights (brow-to-chin keypoints); negative is below. */
  readonly height: number;
  /** Its horizontal distance from the nose, in face widths. */
  readonly across: number;
  readonly zone: "on top of the head" | "at the forehead" | "at the face" | "at the chin and neck";
};

/**
 * Where a hand touches the head, measured against the face: the shoulder-relative placement can't
 * tell a palm resting on the crown from a salute at the brow, which sit a few centimetres apart.
 * Null when the hand isn't beside the head (more than 1.3 face widths across or outside the zones).
 */
function contactOf(b: Body, side: "left" | "right"): HeadContact | null {
  const face = faceBox(b);
  const [hand, eyes] = [at(b, `${side}Hand`), [point(b.pose, 1), point(b.pose, 2)] as const];
  const nose = at(b, "head");
  if (!face || !hand || !nose || !eyes[0] || !eyes[1]) return null;
  const [w, h] = [face.maxX - face.minX, face.maxY - face.minY];
  if (w <= 0 || h <= 0) return null;
  const height = ((eyes[0][1] + eyes[1][1]) / 2 - hand[1]) / h;
  const across = Math.abs(hand[0] - nose[0]) / w;
  // The brow sits about a quarter face above the eyes and the crown about three quarters.
  const zone = height > 0.75 ? "on top of the head" : height > 0.15 ? "at the forehead" : height > -0.5 ? "at the face" : height > -1.3 ? "at the chin and neck" : null;
  return zone && across <= 1.3 && height <= 1.6 ? { height: r2(height), across: r2(across), zone } : null;
}

/** The pose's hand-to-head contacts in screen terms, for a prompt; empty when no hand is at the head. */
export function headContacts(pose: Pose): string[] {
  const b = body(pose);
  if (!b) return [];
  return (["left", "right"] as const).flatMap((side) => {
    const contact = contactOf(b, side);
    return contact ? [`The hand on the ${screen(b, side).replace(" of the image", "").toUpperCase()} of the image is ${contact.zone}${contact.zone === "on top of the head" ? ", the palm resting on the crown of the hair (not a salute at the forehead)" : ""}.`] : [];
  });
}

function headContact(a: Body | null, out: Body | null): DebugCheck {
  const id = "hand_head_contact";
  const label = "Hand-to-head contact";
  const method = `For each hand at the head in Image A: its height above the eye line in face heights (face keypoints, brow to chin), A vs output: ok ≤ ${LIMITS.headContact.ok}, fail > ${LIMITS.headContact.warn}. Zones (approximate): over 0.75 on top of the head, 0.15–0.75 forehead, −0.5–0.15 face, −1.3 to −0.5 chin and neck. Tells a palm on the crown from a salute, which hand placement alone can't.`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const rows = (["left", "right"] as const).flatMap((side) => {
    const ca = contactOf(a, side);
    if (!ca) return [];
    const co = contactOf(out, side);
    return [{ side, a: ca, out: co, difference: co ? r2(Math.abs(ca.height - co.height)) : null }];
  });
  if (!rows.length) return unmeasured(id, label, method, "no hand at the head in Image A");
  const statuses = rows.map((row) => (row.difference === null ? "fail" : grade(row.difference, LIMITS.headContact)));
  return {
    id, label, status: worst(...statuses), method,
    summary: rows.map((row) => `${row.side} hand ${row.a.zone} in A (${row.a.height}) vs ${row.out ? `${row.out.zone} in output (${row.out.height})` : "NOT at the head in output"}`).join("; "),
    values: { hands: rows },
  };
}

/** Horizontal distance between two paired joints in hip widths, signed by the hips' order (negative = crossed). */
function spacing(b: Body, l: JointName, r: JointName): number | null {
  const [lh, rh, lp, rp] = [at(b, "leftHip"), at(b, "rightHip"), at(b, l), at(b, r)];
  if (!lh || !rh || !lp || !rp) return null;
  const hips = lh[0] - rh[0];
  return Math.abs(hips) < 1 ? null : (lp[0] - rp[0]) / hips;
}

const gapWords = (hipWidths: number, part: "feet" | "knees") =>
  hipWidths < 0.6 ? `the ${part} nearly together` : hipWidths < 1 ? `the ${part} a little apart, closer than the hips are wide` : `the ${part} apart, as wide as the hips or wider`;

/**
 * Image A's leg spacing against Image B's, for a prompt: a character sheet stands in its own stance
 * and Muse Image draws that stance over the pose's (feet about 1.2 hip widths apart for 0.4 in A).
 * Said with both numbers and named as B's stance, so the model knows which image the legs come from.
 * Null when B already stands about as A does.
 */
export function stanceContrast(pose: Pose, character: Pose): string | null {
  const [a, b] = [body(pose), body(character)];
  if (!a || !b) return null;
  const [ankleA, ankleB, kneeA] = [spacing(a, "leftAnkle", "rightAnkle"), spacing(b, "leftAnkle", "rightAnkle"), spacing(a, "leftKnee", "rightKnee")];
  if (ankleA === null || ankleB === null || ankleB - ankleA <= LIMITS.spacing.ok) return null;
  return [
    `Leg spacing, measured: in Image A the ankles are ${r2(ankleA)} hip widths apart${kneeA === null ? "" : ` and the knees ${r2(kneeA)}`} — ${gapWords(ankleA, "feet")}${kneeA === null ? "" : `, ${gapWords(kneeA, "knees")}`}.`,
    `Image B stands with its ankles ${r2(ankleB)} hip widths apart: that is Image B's own standing stance, NOT the pose. The legs come from Image A only.`,
    ankleA < 0.6
      ? "Draw the legs as close together as in Image A: the thighs and knees close, the shoes side by side with only a small gap between them, much narrower than Image B."
      : `Draw the feet ${r2(ankleA)} hip widths apart as in Image A, narrower than Image B.`,
  ].join(" ");
}

function legSeparation(a: Body | null, out: Body | null): DebugCheck {
  const id = "leg_separation";
  const label = "Leg separation";
  const method = `Horizontal knee and ankle spacing in hip widths, signed by the hips' order (negative = crossed), A vs output: ok ≤ ${LIMITS.spacing.ok}, fail > ${LIMITS.spacing.warn} difference, or crossed in one and not the other.`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const rows = ([["knees", "leftKnee", "rightKnee"], ["ankles", "leftAnkle", "rightAnkle"]] as const).map(([name, l, r]) => ({ name, a: spacing(a, l, r), out: spacing(out, l, r) }));
  const measured = rows.filter((row) => row.a !== null && row.out !== null) as { name: string; a: number; out: number }[];
  if (!measured.length) return rows.some((row) => row.a !== null) ? { id, label, status: "fail", summary: "knees and ankles not found in the output", method, values: {} } : unmeasured(id, label, method, "knees and ankles not visible in A");
  const statuses = measured.map((row) => ((row.a < -0.05) !== (row.out < -0.05) ? "fail" : grade(Math.abs(row.a - row.out), LIMITS.spacing)));
  return {
    id, label, status: worst(...statuses), method,
    summary: measured.map((row) => `${row.name} ${r2(row.a)} hip widths apart in A vs ${r2(row.out)} in output${(row.a < -0.05) !== (row.out < -0.05) ? " (CROSSED in one only)" : ""}`).join("; "),
    values: Object.fromEntries(measured.map((row) => [row.name, { a: r2(row.a), output: r2(row.out) }])),
  };
}

function edgesTouched(mask: Mask | null): string[] {
  if (!mask) return [];
  const { width, height, data } = mask;
  const band = 2;
  const touched = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[y * width + x]) continue;
    if (y < band) touched.top++;
    if (y >= height - band) touched.bottom++;
    if (x < band) touched.left++;
    if (x >= width - band) touched.right++;
  }
  return Object.entries(touched).filter(([, n]) => n >= 5).map(([edge]) => edge);
}

function footAlignment(a: Body | null, out: Body | null, outMask: Mask | null): DebugCheck {
  const id = "foot_alignment";
  const label = "Foot alignment";
  const method = `Foot lift = left ankle minus right ankle height in torso lengths, A vs output: ok ≤ ${LIMITS.footLift.ok}, fail > ${LIMITS.footLift.warn} difference. Foot direction (ankle→toes) graded like a bone. Fails when the output lacks an ankle A shows, or its figure mask touches the bottom edge (feet cropped).`;
  if (!a) return unmeasured(id, label, method, "no torso in Image A");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const notes: string[] = [];
  const statuses: Status[] = [];
  const cropped = edgesTouched(outMask).includes("bottom");
  if (cropped) { statuses.push("fail"); notes.push("output figure touches the bottom edge: feet likely CROPPED"); }
  for (const side of ["left", "right"] as const) {
    if (at(a, `${side}Ankle`) && !at(out, `${side}Ankle`)) { statuses.push("fail"); notes.push(`${side} ankle MISSING in output`); }
    if (at(a, `${side}Toe`) && !at(out, `${side}Toe`)) { statuses.push("warn"); notes.push(`${side} toes not found in output`); }
  }
  const lift = (b: Body) => {
    const [l, r] = [at(b, "leftAnkle"), at(b, "rightAnkle")];
    return l && r ? (l[1] - r[1]) / b.torso : null;
  };
  const [la, lo] = [lift(a), lift(out)];
  if (la !== null && lo !== null) statuses.push(grade(Math.abs(la - lo), LIMITS.footLift));
  const directions: Record<string, number> = {};
  for (const side of ["left", "right"] as const) {
    const [va, vo] = [vec(a, `${side}Ankle`, `${side}Toe`), vec(out, `${side}Ankle`, `${side}Toe`)];
    if (!va || !vo || norm(va) < 0.08 * a.torso) continue;
    directions[side] = Math.round(boneError(va, vo));
    statuses.push(grade(directions[side], LIMITS.boneDegrees));
  }
  if (!statuses.length) return unmeasured(id, label, method, "ankles not visible in A");
  return {
    id, label, status: worst(...statuses), method,
    summary: [
      ...(la !== null && lo !== null ? [`foot lift ${r2(la)} torso in A vs ${r2(lo)} in output`] : []),
      ...Object.entries(directions).map(([side, degrees]) => `${side} foot points ${degrees}° off`),
      ...notes,
    ].join("; "),
    values: { liftA: la === null ? null : r2(la), liftOutput: lo === null ? null : r2(lo), footDirectionDegrees: directions, cropped, notes },
  };
}

function faceBox(b: Body | null): { minX: number; minY: number; maxX: number; maxY: number; browY: number | null } | null {
  if (!b) return null;
  const points = Array.from({ length: 68 }, (_, i) => point(b.pose, 23 + i)).filter((p): p is Vec => p !== null);
  if (points.length < MIN_FACE_POINTS) return null;
  // COCO-WholeBody face points 17–26 (23 + 17 …) are the eyebrows.
  const brows = Array.from({ length: 10 }, (_, i) => point(b.pose, 40 + i)).filter((p): p is Vec => p !== null);
  return {
    minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])),
    browY: brows.length >= 3 ? Math.min(...brows.map((p) => p[1])) : null,
  };
}

function ratios(b: Body): Record<string, number | null> {
  const length = (from: JointName, to: JointName) => {
    const v = vec(b, from, to);
    return v ? norm(v) : null;
  };
  const limb = (parts: readonly [JointName, JointName][]) => {
    const values = parts.map(([from, to]) => length(from, to));
    return values.every((v) => v !== null) ? values.reduce((s, v) => s + v!, 0) : null;
  };
  const longest = (...values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null);
    return known.length ? Math.max(...known) / b.torso : null;
  };
  const face = faceBox(b);
  const shoulders = length("leftShoulder", "rightShoulder");
  const hips = length("leftHip", "rightHip");
  return {
    shoulderWidth: shoulders === null ? null : shoulders / b.torso,
    hipWidth: hips === null ? null : hips / b.torso,
    armLength: longest(limb([["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"]]), limb([["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"]])),
    legLength: longest(limb([["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"]]), limb([["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"]])),
    faceHeight: face ? (face.maxY - face.minY) / b.torso : null,
  };
}

function torsoProportions(character: Body | null, out: Body | null): DebugCheck {
  const id = "torso_proportions";
  const label = "Torso and body proportions";
  const method = `Against Image B (the character's own build), every ratio in that image's torso lengths (neck to pelvis): shoulder width, hip width, longest arm (upper arm + forearm), longest leg (thigh + shin), face height (face keypoints). Worst relative difference: ok ≤ ${LIMITS.proportion.ok * 100} %, fail > ${LIMITS.proportion.warn * 100} %. A limb pointing at the camera measures short, and a turned body narrower shoulders: read those against the pose.`;
  if (!character) return unmeasured(id, label, method, "no torso found in Image B");
  if (!out) return { id, label, status: "fail", summary: "no torso in the output", method, values: {} };
  const [rb, ro] = [ratios(character), ratios(out)];
  const rows = Object.keys(rb).flatMap((name) => {
    const [b, o] = [rb[name], ro[name]];
    return b !== null && o !== null && b > 0 ? [{ name, b: r2(b), out: r2(o), relative: r2(o / b - 1) }] : [];
  });
  if (!rows.length) return unmeasured(id, label, method, "no ratio measurable in both images");
  const statuses = rows.map((row) => grade(Math.abs(row.relative), LIMITS.proportion));
  return {
    id, label, status: worst(...statuses), method,
    summary: rows.map((row) => `${row.name} ${row.out} vs ${row.b} (${row.relative > 0 ? "+" : ""}${Math.round(row.relative * 100)} %)`).join("; "),
    values: { ratios: rows },
  };
}

// Colours, in CIE L*a*b* (sRGB, D65), for ΔE.
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [x, y, z] = [(0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, 0.2126 * R + 0.7152 * G + 0.0722 * B, (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export type Dominant = { readonly hex: string; readonly lab: readonly number[]; readonly share: number; readonly pixels: number };

/** The most common colour (16 levels a channel) of the pixels `inside` keeps, averaged within its bin. */
export function dominantColour(image: Rgba, inside: (x: number, y: number) => boolean): Dominant | null {
  const bins = new Map<number, [number, number, number, number]>();
  let total = 0;
  for (let y = 0; y < image.height; y += 2) for (let x = 0; x < image.width; x += 2) {
    const p = (y * image.width + x) * 4;
    if (image.data[p + 3] < 128 || !inside(x, y)) continue;
    const [r, g, b] = [image.data[p], image.data[p + 1], image.data[p + 2]];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? [0, 0, 0, 0];
    bin[0] += r; bin[1] += g; bin[2] += b; bin[3]++;
    bins.set(key, bin);
    total++;
  }
  if (total < 20) return null;
  const [r, g, b, n] = [...bins.values()].reduce((best, bin) => (bin[3] > best[3] ? bin : best));
  const rgb = [r / n, g / n, b / n];
  return { hex: hex(rgb), lab: lab(rgb[0], rgb[1], rgb[2]), share: r2(n / total), pixels: total };
}

const inMask = (mask: Mask | null) => (x: number, y: number) => !mask || mask.data[y * mask.width + x] === 1;

function inQuad(q: readonly Vec[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if ((q[i][1] > y) !== (q[j][1] > y) && x < ((q[j][0] - q[i][0]) * (y - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) inside = !inside;
  }
  return inside;
}

/** Above the eyebrows, a face width either side of the face, at most two face heights up: the hair. */
function hairRegion(b: Body | null, figure: Figure) {
  const face = faceBox(b);
  if (!face) return null;
  const [w, h] = [face.maxX - face.minX, face.maxY - face.minY];
  const top = face.browY ?? face.minY;
  const masked = inMask(figure.mask);
  return (x: number, y: number) => y < top - 0.04 * h && y > top - 2 * h && x > face.minX - 0.6 * w && x < face.maxX + 0.6 * w && masked(x, y);
}

function torsoRegion(b: Body | null, figure: Figure) {
  if (!b) return null;
  const corners = (["leftShoulder", "rightShoulder", "rightHip", "leftHip"] as const).map((name) => at(b, name));
  if (corners.some((c) => !c)) return null;
  const centre: Vec = [corners.reduce((s, c) => s + c![0], 0) / 4, corners.reduce((s, c) => s + c![1], 0) / 4];
  // Shrunk toward its centre: the arms beside the torso stay out.
  const quad = corners.map((c) => lerp(centre, c!, 0.8));
  const masked = inMask(figure.mask);
  return (x: number, y: number) => inQuad(quad, x, y) && masked(x, y);
}

function faceRegion(b: Body | null, figure: Figure) {
  const face = faceBox(b);
  if (!face) return null;
  const [cx, cy, w, h] = [(face.minX + face.maxX) / 2, (face.minY + face.maxY) / 2, face.maxX - face.minX, face.maxY - face.minY];
  const masked = inMask(figure.mask);
  return (x: number, y: number) => Math.abs(x - cx) < 0.3 * w && Math.abs(y - cy) < 0.3 * h && masked(x, y);
}

function compareColour(character: Figure, out: Figure, cb: Body | null, ob: Body | null, region: typeof hairRegion) {
  const [rb, ro] = [region(cb, character), region(ob, out)];
  if (!rb || !ro) return null;
  const [db, dout] = [dominantColour(character.image, rb), dominantColour(out.image, ro)];
  return db && dout ? { b: db, out: dout, deltaE: Math.round(deltaE(db.lab, dout.lab)) } : null;
}

function faceFidelity(character: Figure, out: Figure, cb: Body | null, ob: Body | null): DebugCheck {
  const skin = compareColour(character, out, cb, ob, faceRegion);
  const points = (b: Body | null) => (b ? count(b.pose, 23, 68) : 0);
  return {
    id: "face_fidelity",
    label: "Face fidelity",
    status: "manual",
    method: "No robust automatic face-identity measure exists for anime drawings here, so none is scored. Inspect the head row of crops.png (B vs output). Weak signals only: face keypoints found (68 possible) and the dominant colour at the centre of the face (skin), ΔE.",
    summary: `judge by eye in crops.png; face keypoints ${points(cb)}/68 in B, ${points(ob)}/68 in output${skin ? `; face-centre colour ${skin.b.hex} vs ${skin.out.hex} (ΔE ${skin.deltaE})` : ""}`,
    values: { faceKeypointsB: points(cb), faceKeypointsOutput: points(ob), skin: skin ? { b: skin.b.hex, output: skin.out.hex, deltaE: skin.deltaE } : null },
  };
}

function hairFidelity(character: Figure, out: Figure, cb: Body | null, ob: Body | null): DebugCheck {
  const id = "hair_fidelity";
  const label = "Hair fidelity";
  const method = `Colour only: dominant colour of the figure above the eyebrows (a face width either side, up to two face heights), B vs output, CIE76 ΔE: ok ≤ ${LIMITS.colour.ok}, fail > ${LIMITS.colour.warn}. Hair SHAPE is not scored: compare the head row of crops.png.`;
  const colour = compareColour(character, out, cb, ob, hairRegion);
  if (!colour) return unmeasured(id, label, method, "face keypoints not found in B or the output, so the hair can't be located");
  return {
    id, label, status: grade(colour.deltaE, LIMITS.colour), method,
    summary: `hair colour ${colour.b.hex} in B vs ${colour.out.hex} in output (ΔE ${colour.deltaE}); shape: judge by eye in crops.png`,
    values: { b: colour.b, output: colour.out, deltaE: colour.deltaE },
  };
}

function outfitFidelity(character: Figure, out: Figure, cb: Body | null, ob: Body | null): DebugCheck {
  const id = "outfit_fidelity";
  const label = "Outfit fidelity";
  const method = `Dominant colour inside the torso (shoulders–hips quad shrunk 20 %), B vs output, ΔE: ok ≤ ${LIMITS.colour.ok}, fail > ${LIMITS.colour.warn}; and the whole figure's colour histogram (64 bins, masks), intersection: ok ≥ ${LIMITS.palette.ok}, fail < ${LIMITS.palette.warn}. A changed pose changes how much of each colour shows, so the histogram is a loose bound; garment SHAPES are not scored.`;
  const torso = compareColour(character, out, cb, ob, torsoRegion);
  const similarity = character.mask && out.mask ? paletteSimilarity(palette(character.image, character.mask), palette(out.image, out.mask)) : null;
  const statuses: Status[] = [...(torso ? [grade(torso.deltaE, LIMITS.colour)] : []), ...(similarity !== null ? [gradeHigh(similarity, LIMITS.palette)] : [])];
  if (!statuses.length) return unmeasured(id, label, method, "no torso in B or the output and no masks");
  return {
    id, label, status: worst(...statuses), method,
    summary: [...(torso ? [`torso colour ${torso.b.hex} in B vs ${torso.out.hex} in output (ΔE ${torso.deltaE})`] : []), ...(similarity !== null ? [`figure palette overlap ${similarity}`] : [])].join("; "),
    values: { torso: torso ? { b: torso.b, output: torso.out, deltaE: torso.deltaE } : null, paletteSimilarity: similarity },
  };
}

/** Share of background pixels along the middle 70 % of a→b. */
export function gapShare(mask: Mask, a: Vec, b: Vec): number | null {
  let [seen, empty] = [0, 0];
  for (let i = 0; i <= 40; i++) {
    const [x, y] = lerp(a, b, 0.15 + (0.7 * i) / 40).map(Math.round);
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) continue;
    seen++;
    if (!mask.data[y * mask.width + x]) empty++;
  }
  return seen >= 10 ? empty / seen : null;
}

type Probe = { readonly name: string; readonly ends: (b: Body) => readonly [Vec, Vec] | null };

const PROBES: readonly Probe[] = [
  { name: "shins", ends: (b) => { const [lk, la, rk, ra] = [at(b, "leftKnee"), at(b, "leftAnkle"), at(b, "rightKnee"), at(b, "rightAnkle")]; return lk && la && rk && ra ? [mid(lk, la), mid(rk, ra)] : null; } },
  { name: "thighs (near the knees)", ends: (b) => { const [lh, lk, rh, rk] = [at(b, "leftHip"), at(b, "leftKnee"), at(b, "rightHip"), at(b, "rightKnee")]; return lh && lk && rh && rk ? [lerp(lh, lk, 0.7), lerp(rh, rk, 0.7)] : null; } },
  ...(["left", "right"] as const).map((side): Probe => ({
    name: `${side} forearm and torso`,
    ends: (b) => {
      const [e, w, s, h] = [at(b, `${side}Elbow`), at(b, `${side}Wrist`), at(b, `${side}Shoulder`), at(b, `${side}Hip`)];
      if (!e || !w || !s || !h) return null;
      const m = mid(e, w);
      return [m, lerp(s, h, segmentDistance(m, s, h).t)];
    },
  })),
];

function limbFusion(a: Body | null, out: Body | null, poseMask: Mask | null, outMask: Mask | null): DebugCheck {
  const id = "limb_fusion";
  const label = "Limb fusion";
  const method = `Background sampled on the segment between two limbs (the middle 70 %): between the shins, between the thighs near the knees, and from each forearm's middle to its own side of the torso. A gap is ≥ ${GAP * 100} % background; the output FUSES two limbs when A has a gap there and the output has < ${CLOSED * 100} %. Limbs that overlap in A are not judged (no gap to lose).`;
  if (!a || !out) return unmeasured(id, label, method, "no torso in Image A or the output");
  if (!poseMask || !outMask) return unmeasured(id, label, method, "no figure mask for Image A or the output");
  const results = PROBES.flatMap((probe) => {
    const [ea, eo] = [probe.ends(a), probe.ends(out)];
    if (!ea || !eo || dist(ea[0], ea[1]) < 0.12 * a.torso) return [];
    const [ga, go] = [gapShare(poseMask, ea[0], ea[1]), gapShare(outMask, eo[0], eo[1])];
    if (ga === null || go === null) return [];
    return [{ name: probe.name, gapA: r2(ga), gapOutput: r2(go), fused: ga >= GAP && go < CLOSED }];
  });
  if (!results.length) return unmeasured(id, label, method, "no limb pair separated enough in A to test");
  const fused = results.filter((result) => result.fused);
  return {
    id, label, status: fused.length ? "fail" : "ok", method,
    summary: fused.length ? `FUSED: ${fused.map((result) => `${result.name} (gap ${result.gapA} in A, ${result.gapOutput} in output)`).join("; ")}` : `${results.length} limb gaps kept: ${results.map((result) => result.name).join(", ")}`,
    values: { probes: results },
  };
}

/** Foreground pieces of a drawing on a plain backdrop or a transparent one, largest first; null when the backdrop isn't plain. */
export function foregroundPieces(image: Rgba): number[] | null {
  const { width, height, data } = image;
  const border: number[] = [];
  for (let x = 0; x < width; x += 3) border.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 3) border.push(y * width, y * width + width - 1);
  // A cut-out: the alpha alone says what is figure (a transparent pixel's colour means nothing).
  if (border.filter((p) => data[p * 4 + 3] < 128).length >= border.length * 0.9) {
    const opaque: Mask = { width, height, data: new Uint8Array(width * height) };
    for (let p = 0; p < opaque.data.length; p++) opaque.data[p] = data[p * 4 + 3] >= 128 ? 1 : 0;
    return components(opaque).sizes.sort((x, y) => y - x);
  }
  const median = (c: number) => { const v = border.map((p) => data[p * 4 + c]).sort((x, y) => x - y); return v[v.length >> 1]; };
  const backdrop = [median(0), median(1), median(2)];
  const off = (p: number) => Math.max(Math.abs(data[p * 4] - backdrop[0]), Math.abs(data[p * 4 + 1] - backdrop[1]), Math.abs(data[p * 4 + 2] - backdrop[2]));
  if (border.filter((p) => off(p) <= 30).length < border.length * 0.9) return null;
  const mask: Mask = { width, height, data: new Uint8Array(width * height) };
  for (let p = 0; p < mask.data.length; p++) mask.data[p] = data[p * 4 + 3] >= 128 && off(p) > 40 ? 1 : 0;
  return components(mask).sizes.sort((x, y) => y - x);
}

const PAIRS = [["UpperArm", "Shoulder", "Elbow"], ["Forearm", "Elbow", "Wrist"], ["Thigh", "Hip", "Knee"], ["Shin", "Knee", "Ankle"]] as const;

function deformations(a: Body | null, out: Body | null, outFigure: Figure): DebugCheck {
  const id = "deformations";
  const label = "Obvious deformations";
  const method = "Flags, each measured: (1) detached foreground pieces on the plain backdrop, ≥ 2 % of the figure fails, 0.5–2 % warns (loose hair strands and effects also count); (2) left/right length mismatch: a limb pair within 0.8–1.25 of each other in A but outside 0.7–1.43 in the output; (3) joints A shows that the output lacks; (4) the figure touching an image edge (cropped); (5) a hand with under half of A's hand keypoints (warn). Extra limbs or fingers are NOT detectable this way: check crops.png.";
  if (!out) return { id, label, status: "fail", summary: "no torso in the output: the figure is unreadable", method, values: {} };
  const flags: { flag: string; status: Status }[] = [];
  const pieces = foregroundPieces(outFigure.image);
  if (pieces && pieces.length > 1) {
    const big = pieces[0];
    for (const size of pieces.slice(1)) {
      const share = size / big;
      if (share >= 0.02) flags.push({ flag: `detached piece ${(share * 100).toFixed(1)} % of the figure`, status: "fail" });
      else if (share >= 0.005) flags.push({ flag: `small detached piece ${(share * 100).toFixed(1)} % of the figure`, status: "warn" });
    }
  }
  if (a) {
    for (const [bone, from, to] of PAIRS) {
      const length = (b: Body, side: "left" | "right") => { const v = vec(b, `${side}${from}`, `${side}${to}`); return v ? norm(v) : null; };
      const [al, ar, ol, or] = [length(a, "left"), length(a, "right"), length(out, "left"), length(out, "right")];
      if (!al || !ar || !ol || !or) continue;
      const [ra, ro] = [al / ar, ol / or];
      if (ra >= 0.8 && ra <= 1.25 && (ro < 0.7 || ro > 1 / 0.7)) flags.push({ flag: `${bone.toLowerCase()}: left is ${r2(ro)}× the right in output (${r2(ra)}× in A)`, status: "fail" });
    }
    const lost = JOINT_NAMES.filter((name) => a.sk[name] && !out.sk[name]);
    if (lost.length) flags.push({ flag: `joints missing in output: ${lost.join(", ")}`, status: "fail" });
    for (const side of ["left", "right"] as const) {
      const [pa, po] = [count(a.pose, HAND_BASE[side], 21), count(out.pose, HAND_BASE[side], 21)];
      if (pa >= 10 && po < pa * 0.5) flags.push({ flag: `${side} hand barely readable (${po}/21 keypoints vs ${pa} in A)`, status: "warn" });
    }
  }
  const edges = edgesTouched(outFigure.mask);
  if (edges.length) flags.push({ flag: `figure touches the ${edges.join(", ")} edge${edges.length > 1 ? "s" : ""} (cropped?)`, status: "fail" });
  return {
    id, label, status: worst("ok", ...flags.map((f) => f.status)), method,
    summary: flags.length ? flags.map((f) => f.flag).join("; ") : `none of the measured flags${pieces === null ? " (backdrop not plain: detached pieces not checked)" : ""}`,
    values: { flags, pieces: pieces ? pieces.slice(0, 6) : null },
  };
}

/** Every check, in the report's order. */
export function evaluate(input: { readonly pose: Figure; readonly character: Figure; readonly output: Figure }): DebugCheck[] {
  const [a, b, out] = [body(input.pose.pose), body(input.character.pose), body(input.output.pose)];
  return [
    poseGlobal(a, out),
    headPosition(a, out),
    arm(a, out, "left"),
    arm(a, out, "right"),
    hand(a, out, "left"),
    hand(a, out, "right"),
    headContact(a, out),
    legSeparation(a, out),
    footAlignment(a, out, input.output.mask),
    torsoProportions(b, out),
    faceFidelity(input.character, input.output, b, out),
    hairFidelity(input.character, input.output, b, out),
    outfitFidelity(input.character, input.output, b, out),
    limbFusion(a, out, input.pose.mask, input.output.mask),
    deformations(a, out, input.output),
  ];
}

/** Mean confidence of the 17 body keypoints: how far the pose estimator itself can be trusted on this image. */
export function bodyConfidence(pose: Pose | null): number | null {
  if (!pose) return null;
  const scores = pose.scores.slice(0, 17);
  return scores.length ? r2(scores.reduce((s, v) => s + (v ?? 0), 0) / scores.length) : null;
}
