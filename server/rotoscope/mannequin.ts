import { segmentDistance, type Vec } from "../mapping/geometry";
import type { Rig } from "../mapping/rig";
import { BONE_NAMES, BONES, torsoLength, type BoneName, type JointName, type Skeleton } from "../mapping/skeleton";
import type { Rgba } from "./alpha";

// A posing mannequin of the target skeleton, the pose reference Muse Image
// follows best (lab.ts: 9 of 9 frames passed the firewall's pose check on the
// first try with the mannequin and the greyscale video frame, against the
// skeleton guide's misses): coloured volumes per body part, shaded by depth so
// the nearer limb is lighter and overlaps read.

/** Nearer is lighter: hands over forearms over upper arms over the head over the torso and legs. */
const DEPTH: Readonly<Record<BoneName, number>> = {
  torso: 0.35, head: 0.55, leftThigh: 0.25, rightThigh: 0.25, leftShin: 0.2, rightShin: 0.2, leftFoot: 0.25, rightFoot: 0.25,
  leftUpperArm: 0.7, rightUpperArm: 0.7, leftForearm: 0.8, rightForearm: 0.8, leftHand: 0.9, rightHand: 0.9,
};
/** Limb half-widths in torso lengths: an anime figure's build, used where the character's own isn't measured. */
const WIDTH: Readonly<Record<BoneName, number>> = {
  torso: 0.3, head: 0.3, leftUpperArm: 0.09, rightUpperArm: 0.09, leftForearm: 0.08, rightForearm: 0.08, leftHand: 0.1, rightHand: 0.1,
  leftThigh: 0.16, rightThigh: 0.16, leftShin: 0.11, rightShin: 0.11, leftFoot: 0.09, rightFoot: 0.09,
};
/** The subject's right side red, left side blue (as on the skeleton guide), torso green, head yellow. */
const HUE: Readonly<Record<BoneName, readonly [number, number, number]>> = {
  torso: [70, 170, 90], head: [235, 200, 60],
  rightUpperArm: [215, 50, 50], rightForearm: [235, 95, 75], rightHand: [250, 150, 120], rightThigh: [190, 40, 60], rightShin: [215, 70, 90], rightFoot: [240, 120, 130],
  leftUpperArm: [45, 90, 215], leftForearm: [70, 135, 235], leftHand: [120, 180, 250], leftThigh: [40, 70, 180], leftShin: [70, 105, 205], leftFoot: [120, 150, 230],
};

/**
 * The character's own build, measured on its sheet's rig (in torso lengths), where a single sheet
 * shows it reliably: the legs — each leg's half-width is its region's area (seen plus the surface hidden
 * behind a front limb) over twice its length, the wider side of each pair because a three-quarter sheet
 * turns one leg away — and the hips — how far the body reaches past the hip joints and the thighs across
 * the band just above them, counting only torso and thigh pixels so a hand resting there doesn't widen it. Arms
 * and the bust are covered by the arms on many sheets and keep the generic build.
 * The mannequin is the reference Muse Image follows most closely: with generic widths it drew every
 * character with the same straight, slim body (docs/focus-pipeline-repair/PHASE_07.md).
 */
export type MannequinBuild = { readonly widths: Partial<Record<BoneName, number>>; readonly torsoMargin: number | null };

/** A measured width this far from the default is a measuring failure (a limb merged with another), not a build. */
const BUILD_RANGE = [0.5, 2.5] as const;
const TORSO_MARGIN = 0.08;
const LEG_PAIRS = [["leftThigh", "rightThigh"], ["leftShin", "rightShin"]] as const;

export function sheetBuild(rig: Rig): MannequinBuild {
  const torso = torsoLength(rig.skeleton);
  const { neck, pelvis, leftHip, rightHip } = rig.skeleton;
  if (!torso || !neck || !pelvis) return { widths: {}, torsoMargin: null };
  const label = (name: BoneName) => BONE_NAMES.indexOf(name) + 1;
  const area = new Map<number, number>();
  for (let p = 0; p < rig.labels.length; p++) {
    if (rig.labels[p]) area.set(rig.labels[p], (area.get(rig.labels[p]) ?? 0) + 1);
    if (rig.hidden[p]) area.set(rig.hidden[p], (area.get(rig.hidden[p]) ?? 0) + 1);
  }
  const widths: Partial<Record<BoneName, number>> = {};
  for (const pair of LEG_PAIRS) {
    const measured = pair.flatMap((name) => {
      const bone = rig.bones.find((entry) => entry.name === name);
      return bone && bone.length > 0 ? [(area.get(label(name)) ?? 0) / (2 * bone.length) / torso] : [];
    });
    const half = Math.max(0, ...measured);
    const ratio = half / WIDTH[pair[0]];
    if (measured.length && ratio >= BUILD_RANGE[0] && ratio <= BUILD_RANGE[1]) for (const name of pair) widths[name] = Math.round(half * 1000) / 1000;
  }
  // The hips: rows from 85 % to 100 % of the way from the neck to the pelvis, torso and thigh pixels only.
  let torsoMargin: number | null = null;
  if (leftHip && rightHip) {
    const body = new Set([label("torso"), label("leftThigh"), label("rightThigh")]);
    const spans: number[] = [];
    for (let t = 0.85; t <= 1.0001; t += 0.03) {
      const y = Math.round(neck.p[1] + (pelvis.p[1] - neck.p[1]) * t);
      if (y < 0 || y >= rig.height) continue;
      let count = 0;
      for (let x = 0; x < rig.width; x++) if (body.has(rig.labels[y * rig.width + x]) || body.has(rig.hidden[y * rig.width + x])) count++;
      spans.push(count);
    }
    if (spans.length) {
      const span = spans.sort((x, y) => x - y)[Math.floor(spans.length / 2)];
      // The thighs already reach past the hip joints by their own half-width: only what goes beyond them is the torso's.
      const measured = (span - Math.abs(leftHip.p[0] - rightHip.p[0])) / 2 / torso - (widths.leftThigh ?? WIDTH.leftThigh);
      if (measured / TORSO_MARGIN >= BUILD_RANGE[0] && measured / TORSO_MARGIN <= BUILD_RANGE[1]) torsoMargin = Math.round(measured * 1000) / 1000;
    }
  }
  return { widths, torsoMargin };
}

/**
 * A posing mannequin of the target skeleton: per pixel the front-most body part, rounded like a
 * capsule, with a dark edge where one part passes over another. Limb thickness and the torso's
 * margin are the character's (`build`, sheetBuild) where measured, else a generic anime build.
 */
export function mannequin(target: Skeleton, size: { width: number; height: number }, build: MannequinBuild | null = null): { shaded: Rgba; depth: Rgba } {
  const torso = torsoLength(target) ?? 300;
  const margin = (build?.torsoMargin ?? TORSO_MARGIN) * torso;
  const { width, height } = size;
  const quad = [target.leftShoulder?.p, target.rightShoulder?.p, target.rightHip?.p, target.leftHip?.p];
  const parts = BONES.flatMap((def, i) => {
    let [a, b] = [target[def.from as JointName]?.p, target[def.to as JointName]?.p];
    if (!a || !b) return [];
    let r = (build?.widths[def.name] ?? WIDTH[def.name]) * torso;
    // The head is a skull above the nose, as wide as a quarter of the torso; the neck a thin stalk under it.
    if (def.name === "head") {
      const up: Vec = [b[0] - a[0], b[1] - a[1]];
      const n = Math.hypot(...up) || 1;
      a = [b[0] + (up[0] / n) * torso * 0.04, b[1] + (up[1] / n) * torso * 0.04];
      b = [b[0] + (up[0] / n) * torso * 0.14, b[1] + (up[1] / n) * torso * 0.14];
      r = torso * 0.21;
    }
    return [{ a, b, r, base: DEPTH[def.name], hue: HUE[def.name], id: i, torso: def.name === "torso" }];
  });
  const neck = target.neck && target.head ? { a: target.neck.p, b: target.head.p, r: torso * 0.07 } : null;
  /** Distance outside the shoulder–hip trapezoid (0 inside), for the torso volume. */
  const torsoDistance = (q: Vec, part: { a: Vec; b: Vec }) => {
    if (quad.some((v) => !v)) return segmentDistance(q, part.a, part.b).distance;
    const poly = quad as Vec[];
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      if ((poly[i][1] > q[1]) !== (poly[j][1] > q[1]) && q[0] < ((poly[j][0] - poly[i][0]) * (q[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
    }
    return inside ? 0 : Math.min(...poly.map((v, i) => segmentDistance(q, v, poly[(i + 1) % 4]).distance));
  };
  const ids = new Int16Array(width * height).fill(-1);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    const q: Vec = [x + 0.5, y + 0.5];
    if (neck && segmentDistance(q, neck.a, neck.b).distance <= neck.r && values[p] < 0.3) { values[p] = 0.3; ids[p] = 0; }
    for (const part of parts) {
      // The torso: the trapezoid grown by a little, rounded toward its edge.
      const d = part.torso ? torsoDistance(q, part) + margin : segmentDistance(q, part.a, part.b).distance;
      if (part.torso) { if (d > margin * 2) continue; }
      else if (d > part.r) continue;
      if (part.torso) {
        const v = part.base + 0.1 * Math.sqrt(Math.max(0, 1 - (d / (margin * 2)) ** 2)) * 0.5 + 0.05;
        if (v > values[p]) { values[p] = v; ids[p] = part.id; }
        continue;
      }
      const v = part.base + 0.1 * Math.sqrt(1 - (d / part.r) ** 2);
      if (v > values[p]) { values[p] = v; ids[p] = part.id; }
    }
  }
  const shaded = Buffer.alloc(width * height * 4);
  const depth = Buffer.alloc(width * height * 4);
  const byId = new Map(parts.map((part) => [part.id, part]));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    const id = ids[p];
    const g = Math.round(values[p] * 255);
    depth[p * 4] = depth[p * 4 + 1] = depth[p * 4 + 2] = g; depth[p * 4 + 3] = 255;
    if (id < 0) { shaded[p * 4] = shaded[p * 4 + 1] = shaded[p * 4 + 2] = 255; shaded[p * 4 + 3] = 255; continue; }
    const edge = [p - 1, p + 1, p - width, p + width, p - 2, p + 2, p - 2 * width, p + 2 * width].some((q) => q >= 0 && q < ids.length && ids[q] !== id);
    const part = byId.get(id)!;
    const light = 0.6 + 0.4 * ((values[p] - part.base) / 0.1);
    const c = edge ? [30, 30, 35] : part.hue.map((v) => Math.round(Math.min(255, v * light)));
    shaded[p * 4] = c[0]; shaded[p * 4 + 1] = c[1]; shaded[p * 4 + 2] = c[2]; shaded[p * 4 + 3] = 255;
  }
  return { shaded: { data: shaded, width, height }, depth: { data: depth, width, height } };
}

/** What Muse Image is told the mannequin is. */
export const MANNEQUIN_ROLE = "THE POSE MANNEQUIN on the measuring grid, at the exact size and place to draw: coloured volumes, one per body part. RED volumes are the character's RIGHT arm and leg (on the LEFT of the picture, the character faces the viewer), BLUE volumes the LEFT arm and leg, GREEN the torso, YELLOW the head. Lighter volumes are nearer the viewer: a lighter limb passes IN FRONT of a darker one. A short volume is a limb pointing at the viewer. The volumes give joint positions and limb angles only: their thickness is a generic dummy, NOT the character's body.";
