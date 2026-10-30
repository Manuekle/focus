import type { Check } from "./run-state";
import type { Pose } from "./pose-match";
import { CHIN, GRID, toLine, type Marks } from "./grid";

// The pose guide in words and numbers, for the generator: every joint as a
// grid coordinate, every limb's length in grid cells, the head size and how
// many heads tall the figure is, and the face read from the video frame.
// Image models draw limbs too long when they only see a skeleton and two
// target lines; told the lengths, they keep them, and the proportions check
// below measures the drawing against the same numbers.

type Point = readonly [number, number];
type Transform = { readonly scale: number; readonly x: number; readonly y: number };

const MIN_CONFIDENCE = 0.3;
/** A guide bone shorter than this share of its own full length is pointing at the camera: its length can't be judged. */
const CLEAR_BONE_SHARE = 0.7;

function point(pose: Pose, index: number): Point | null {
  const [x, y] = pose.keypoints[index] ?? [null, null];
  return x === null || y === null || (pose.scores[index] ?? 0) < MIN_CONFIDENCE ? null : [x, y];
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const cells = (px: number) => (px / GRID.cell).toFixed(2);
const xy = (p: Point) => `(${(p[0] / GRID.cell).toFixed(2)}, ${(p[1] / GRID.cell).toFixed(2)})`;

/** A pose in source-frame pixels, placed on the canvas by the clip layout. */
export function onCanvas(pose: Pose, fit: Transform): Pose {
  return {
    keypoints: pose.keypoints.map(([x, y]) => (x === null || y === null ? [null, null] as const : [x * fit.scale + fit.x, y * fit.scale + fit.y] as const)),
    scores: pose.scores,
  };
}

export type BoneSpec = {
  readonly name: string;
  /** Where the limb is as the viewer sees it. */
  readonly screen: "LEFT" | "RIGHT";
  /** Its colour in the pose skeleton image: red for the subject's right side, blue for the left. */
  readonly colour: "red" | "blue";
  readonly from: number;
  readonly to: number;
  readonly a: Point;
  readonly b: Point;
  /** Canvas pixels. */
  readonly length: number;
  /** Long enough on screen to measure (not pointing at the camera). */
  readonly clear: boolean;
};

export type BodySpec = {
  readonly text: string;
  readonly bones: readonly BoneSpec[];
  /** Hair top to chin, canvas pixels. */
  readonly headHeight: number;
};

const LIMBS = [
  { limb: "arm", side: "right", bones: [["upper arm", 6, 8], ["forearm", 8, 10]] },
  { limb: "arm", side: "left", bones: [["upper arm", 5, 7], ["forearm", 7, 9]] },
  { limb: "leg", side: "right", bones: [["thigh", 12, 14], ["shin", 14, 16]] },
  { limb: "leg", side: "left", bones: [["thigh", 11, 13], ["shin", 13, 15]] },
] as const;
/** The guide bones' full lengths: how long each looks at its most extended in the clip (90th percentile). */
export type FullLengths = ReadonlyMap<string, number>;
const boneKey = (from: number, to: number) => `${from}-${to}`;

export function fullLengths(poses: readonly Pose[]): FullLengths {
  const out = new Map<string, number>();
  for (const { bones } of LIMBS) {
    for (const [, from, to] of bones) {
      const seen = poses.flatMap((pose) => {
        const [a, b] = [point(pose, from), point(pose, to)];
        return a && b ? [distance(a, b)] : [];
      }).sort((x, y) => x - y);
      if (seen.length) out.set(boneKey(from, to), seen[Math.min(seen.length - 1, Math.floor(seen.length * 0.9))]);
    }
  }
  return out;
}

/** COCO-WholeBody hands: 21 points from the subject's left hand, then the right. */
const HANDS = { left: 91, right: 112 } as const;

function handCentre(pose: Pose, base: number): Point | null {
  const points = Array.from({ length: 21 }, (_, i) => point(pose, base + i)).filter((p): p is Point => p !== null);
  if (points.length < 5) return null;
  return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
}

/**
 * The guide pose (canvas pixels, on the character's proportions) as exact
 * measurements. `headHeight` is the character's hair-top-to-chin at this
 * frame's size; `full` (fullLengths over the clip's guides) tells which bones
 * the camera sees shortened.
 */
export function bodySpec(guide: Pose, marks: Marks, headHeight: number, full: FullLengths = new Map()): BodySpec | null {
  const [ls, rs, lh, rh, nose] = [point(guide, 5), point(guide, 6), point(guide, 11), point(guide, 12), point(guide, 0)];
  if (!ls || !rs || !lh || !rh) return null;
  const torso = distance(mid(ls, rs), mid(lh, rh));
  // The subject's right shoulder on the viewer's left: facing the camera.
  const screenOf = (side: "left" | "right"): "LEFT" | "RIGHT" => ((side === "right") === (rs[0] < ls[0]) ? "LEFT" : "RIGHT");
  const figure = marks.feet - marks.head;
  const bones: BoneSpec[] = [];
  const lines: string[] = [
    `EXACT MEASUREMENTS. The canvas is ${GRID.columns * GRID.cell}×${GRID.rows * GRID.cell} px = ${GRID.columns} columns × ${GRID.rows} lines of ${GRID.cell} px. A point (c, l) is column c from the left edge and line l from the top edge, in cells: (4.00, 6.00) is the exact centre. Every number below is measured on the skeleton of Image 2 and must be matched within a quarter of a cell.`,
    `Whole figure: top of the hair on line ${toLine(marks.head)}, soles on line ${toLine(marks.feet)}: ${cells(figure)} cells tall. Head from the top of the hair to the chin: ${cells(headHeight)} cells, so the character is ${(figure / headHeight).toFixed(1)} heads tall — keep that head-to-body ratio exactly; do not shrink the head or stretch the body.`,
    `Torso: shoulders at ${xy(ls)} and ${xy(rs)} (${cells(distance(ls, rs))} cells apart), hips at ${xy(lh)} and ${xy(rh)} (${cells(distance(lh, rh))} cells apart), shoulders to hips ${cells(torso)} cells.${nose ? ` Nose at ${xy(nose)}; chin on line ${toLine(marks.head + headHeight)}.` : ""}`,
  ];
  for (const { limb, side, bones: parts } of LIMBS) {
    const screen = screenOf(side);
    const colour = side === "right" ? "red" : "blue";
    const joints: Point[] = [];
    const lengths: string[] = [];
    for (const [name, from, to] of parts) {
      const [a, b] = [point(guide, from), point(guide, to)];
      if (!a || !b) continue;
      const length = distance(a, b);
      // Without the clip's lengths, a bone is judged against the torso (an anime forearm is about 0.4 of it).
      const clear = length >= CLEAR_BONE_SHARE * (full.get(boneKey(from, to)) ?? torso * 0.6);
      bones.push({ name, screen, colour, from, to, a, b, length, clear });
      if (!joints.length) joints.push(a);
      joints.push(b);
      lengths.push(`${name} ${cells(length)} cells${clear ? "" : " (seen shortened: it points toward the viewer)"}`);
    }
    if (joints.length < 2) {
      lines.push(`The ${limb} on the ${screen} of the image (${colour} in Image 2) is hidden in the pose: keep it hidden behind the body as in the pose photo.`);
      continue;
    }
    const names = limb === "arm" ? ["shoulder", "elbow", "wrist"] : ["hip", "knee", "ankle"];
    const path = joints.map((joint, i) => `${names[i] ?? "joint"} ${xy(joint)}`).join(" → ");
    const hand = limb === "arm" ? handCentre(guide, HANDS[side]) : null;
    lines.push(`The ${limb} on the ${screen} of the image (${colour} in Image 2): ${path}; ${lengths.join(", ")}.${hand ? ` The hand is centred at ${xy(hand)}.` : ""}`);
  }
  lines.push("Limb lengths are fixed by the character: never draw an arm or a leg longer than its numbers above. Over-long arms, forearms, thighs and shins are the most common mistake — check them before finishing.");
  return { text: lines.join("\n"), bones, headHeight };
}

/**
 * The face in the video frame (source pixels, DWPose's 68 face points), in
 * screen terms: eyes, mouth, smile, head tilt and turn. Empty when the face
 * isn't detected clearly; the character keeps its own default expression then.
 */
export function describeFace(source: Pose): string {
  const f = (i: number) => point(source, 23 + i);
  const need = (...indices: number[]) => indices.map(f);
  const notes: string[] = [];
  const [e36, e37, e38, e39, e40, e41, e42, e43, e44, e45, e46, e47] = need(36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47);
  if (e36 && e37 && e38 && e39 && e40 && e41 && e42 && e43 && e44 && e45 && e46 && e47) {
    const open = (distance(e37, e41) + distance(e38, e40)) / (2 * distance(e36, e39)) / 2 + (distance(e43, e47) + distance(e44, e46)) / (2 * distance(e42, e45)) / 2;
    notes.push(open < 0.13 ? "eyes closed" : open < 0.21 ? "eyes half-closed" : "eyes open");
    const [left, right] = [mid(e36, e39), mid(e42, e45)];
    const tilt = (Math.atan2(right[1] - left[1], right[0] - left[0]) * 180) / Math.PI;
    if (Math.abs(tilt) >= 6) notes.push(`head tilted about ${Math.round(Math.abs(tilt))}° toward the ${tilt > 0 ? "RIGHT" : "LEFT"} side of the image (that ear closer to its shoulder)`);
  }
  const [m48, m51, m54, m57, m60, m62, m64, m66] = need(48, 51, 54, 57, 60, 62, 64, 66);
  if (m48 && m51 && m54 && m57 && m60 && m62 && m64 && m66) {
    const open = distance(m62, m66) / Math.max(1, distance(m60, m64));
    const corners = (m48[1] + m54[1]) / 2;
    const centre = (m51[1] + m57[1]) / 2;
    const smile = corners < centre - distance(m48, m54) * 0.06;
    notes.push(open > 0.35 ? "mouth wide open" : open > 0.12 ? "mouth slightly open" : "mouth closed");
    if (smile) notes.push("a slight smile (mouth corners raised)");
  }
  const [jawLeft, jawRight, nose] = [f(0), f(16), point(source, 0)];
  if (jawLeft && jawRight && nose) {
    const turn = (nose[0] - (jawLeft[0] + jawRight[0]) / 2) / Math.max(1, distance(jawLeft, jawRight));
    if (Math.abs(turn) >= 0.1) notes.push(`face turned ${Math.abs(turn) >= 0.25 ? "" : "slightly "}toward the ${turn > 0 ? "RIGHT" : "LEFT"} of the image`);
  }
  return notes.length ? `Face and expression in this frame: ${notes.join(", ")}. Keep the character's own face design; change only these.` : "";
}

export const DEFAULT_PROPORTION_LIMITS = { longest: 1.18, shortest: 0.78, head: 0.16 } as const;

/**
 * Check: the drawing's limbs and head against the guide's lengths, both as
 * shares of the figure's height (hair top to soles), so the check holds
 * whatever size the drawing came out before registration.
 */
export function checkProportions(spec: BodySpec | null, drawn: Pose, drawnMarks: Marks | null, target: Marks, limits = DEFAULT_PROPORTION_LIMITS): Check {
  if (!spec || !drawnMarks) return { name: "proportions", passed: true, detail: "not measurable (body not found); left to the review" };
  const scale = (drawnMarks.feet - drawnMarks.head) / Math.max(1, target.feet - target.head);
  const found: { bone: BoneSpec; ratio: number }[] = [];
  for (const bone of spec.bones) {
    if (!bone.clear) continue;
    const [a, b] = [point(drawn, bone.from), point(drawn, bone.to)];
    if (a && b) found.push({ bone, ratio: distance(a, b) / (bone.length * scale) });
  }
  const chin = point(drawn, CHIN);
  const head = chin ? (chin[1] - drawnMarks.head) / (spec.headHeight * scale) : null;
  const percent = (ratio: number) => `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)} %`;
  const fixes: string[] = [];
  for (const { bone, ratio } of found) {
    if (ratio > limits.longest) fixes.push(`The ${bone.name} on the ${bone.screen} of the image is ${Math.round((ratio - 1) * 100)} % too long: it must measure ${cells(bone.length)} cells, from ${xy(bone.a)} to ${xy(bone.b)} (${bone.colour} in Image 2).`);
    else if (ratio < limits.shortest) fixes.push(`The ${bone.name} on the ${bone.screen} of the image is ${Math.round((1 - ratio) * 100)} % too short: it must measure ${cells(bone.length)} cells, from ${xy(bone.a)} to ${xy(bone.b)}.`);
  }
  if (head !== null && Math.abs(head - 1) > limits.head) fixes.push(`The head is ${head > 1 ? "too big" : "too small"} (${percent(head)}): from the top of the hair to the chin it must measure ${cells(spec.headHeight)} cells.`);
  const worst = [...found].sort((x, y) => Math.abs(y.ratio - 1) - Math.abs(x.ratio - 1))[0];
  const detail = `${found.length} limbs measured${worst ? `, worst ${worst.bone.screen.toLowerCase()}-of-image ${worst.bone.name} ${percent(worst.ratio)}` : ""}${head !== null ? `, head ${percent(head)}` : ", head not measured"}`;
  const score = Math.round(Math.max(worst ? Math.abs(worst.ratio - 1) : 0, head !== null ? Math.abs(head - 1) : 0) * 1000) / 1000;
  return { name: "proportions", passed: fixes.length === 0, detail, score, ...(fixes.length ? { feedback: fixes.join(" ") } : {}) };
}
