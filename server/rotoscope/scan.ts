import sharp from "sharp";
import { segmentDistance, type Vec } from "../mapping/geometry";
import { BONES, MIRROR_JOINT, torsoLength, type BoneName, type JointName, type Skeleton } from "../mapping/skeleton";
import type { Rgba } from "./alpha";
import { GRID } from "./grid";
import type { Check } from "./run-state";

// The overlay scan: the firewall's pose check as a scan of the picture, not
// only a list of bone angles. The drawing's skeleton (DWPose) is laid over the
// target skeleton (the video frame's pose on the character, on the canvas):
//   1. alignment — a 2D similarity (scale, rotation, translation) fitted by
//      least squares on the torso (Procrustes, closed form), so a figure drawn
//      a little off-centre isn't counted against every limb;
//   2. residuals — each joint's distance from its target after alignment, in
//      torso lengths, and the same with left and right exchanged (mirror);
//   3. the grid — both skeletons rasterized as body-part volumes on the
//      measuring grid (columns A–H, rows 1–12) and compared cell by cell: a
//      cell is bad where a limb should be and isn't, or is where it shouldn't
//      be, or where the drawing has no pixels for a limb the target puts there.
// Every finding is said in grid cells ("left hand: should be in F2, drawn in
// D3"), the same cells the generator sees on its references.

const COLUMNS = "ABCDEFGH";
export const cellName = (p: Vec) => `${COLUMNS[Math.max(0, Math.min(GRID.columns - 1, Math.floor(p[0] / GRID.cell)))]}${Math.max(1, Math.min(GRID.rows, Math.floor(p[1] / GRID.cell) + 1))}`;

/** Limb half-widths in torso lengths, for rasterizing a skeleton as volumes. */
const WIDTH: Readonly<Record<BoneName, number>> = {
  torso: 0.3, head: 0.22, leftUpperArm: 0.09, rightUpperArm: 0.09, leftForearm: 0.08, rightForearm: 0.08, leftHand: 0.1, rightHand: 0.1,
  leftThigh: 0.16, rightThigh: 0.16, leftShin: 0.11, rightShin: 0.11, leftFoot: 0.09, rightFoot: 0.09,
};
const LIMBS: readonly BoneName[] = ["leftUpperArm", "leftForearm", "leftHand", "rightUpperArm", "rightForearm", "rightHand", "leftThigh", "leftShin", "leftFoot", "rightThigh", "rightShin", "rightFoot"];
const ALIGN: readonly JointName[] = ["leftShoulder", "rightShoulder", "leftHip", "rightHip", "neck", "pelvis"];
/** Limbs whose pixels must be there: arms. Hands and feet are too small to judge, legs differ in shape (shorts, socks). */
const COVERED: readonly BoneName[] = ["leftUpperArm", "leftForearm", "rightUpperArm", "rightForearm"];
const REPORTED: readonly JointName[] = ["head", "leftElbow", "leftWrist", "leftHand", "rightElbow", "rightWrist", "rightHand", "leftKnee", "leftAnkle", "rightKnee", "rightAnkle"];

export type Similarity = { readonly scale: number; readonly angle: number; readonly tx: number; readonly ty: number };

export const applySimilarity = (m: Similarity, p: Vec): Vec => {
  const [c, s] = [Math.cos(m.angle) * m.scale, Math.sin(m.angle) * m.scale];
  return [c * p[0] - s * p[1] + m.tx, s * p[0] + c * p[1] + m.ty];
};

/**
 * Least-squares similarity carrying `from` onto `to` (Umeyama/Procrustes in 2D, closed form):
 * centre both sets, a = Σ x·x′ + y·y′, b = Σ x·y′ − y·x′, angle = atan2(b, a), scale = √(a²+b²) / Σ|x|².
 */
export function procrustes(from: readonly Vec[], to: readonly Vec[]): Similarity | null {
  const n = Math.min(from.length, to.length);
  if (n < 2) return null;
  const mean = (points: readonly Vec[]): Vec => [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  const [mf, mt] = [mean(from.slice(0, n)), mean(to.slice(0, n))];
  let [a, b, norm] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [x, y] = [from[i][0] - mf[0], from[i][1] - mf[1]];
    const [u, v] = [to[i][0] - mt[0], to[i][1] - mt[1]];
    a += x * u + y * v;
    b += x * v - y * u;
    norm += x * x + y * y;
  }
  if (norm < 1e-9) return null;
  const angle = Math.atan2(b, a);
  const scale = Math.hypot(a, b) / norm;
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  return { scale, angle, tx: mt[0] - (c * mf[0] - s * mf[1]), ty: mt[1] - (s * mf[0] + c * mf[1]) };
}

/** Each pixel's body part (index in BONES) for a skeleton drawn as volumes; -1 where none. Sampled every `step` px. */
function partMap(s: Skeleton, width: number, height: number, step: number): Int8Array {
  const torso = torsoLength(s) ?? 300;
  const parts = BONES.flatMap((def, i) => {
    const [a, b] = [s[def.from as JointName]?.p, s[def.to as JointName]?.p];
    return a && b ? [{ a, b, r: WIDTH[def.name] * torso, i, front: LIMBS.includes(def.name) ? 2 : def.name === "head" ? 1 : 0 }] : [];
  });
  const [w, h] = [Math.ceil(width / step), Math.ceil(height / step)];
  const map = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q: Vec = [x * step + step / 2, y * step + step / 2];
    let [best, front] = [-1, -1];
    for (const part of parts) if (part.front > front && segmentDistance(q, part.a, part.b).distance <= part.r) { best = part.i; front = part.front; }
    map[y * w + x] = best;
  }
  return map;
}

export function invertSimilarity(m: Similarity): Similarity {
  const [scale, angle] = [1 / m.scale, -m.angle];
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  return { scale, angle, tx: -(c * m.tx - s * m.ty), ty: -(s * m.tx + c * m.ty) };
}

/** The drawn skeleton with each limb chain re-laid from the target's root joint: drawn directions, target lengths. */
function rebuild(drawn: Skeleton, target: Skeleton): Skeleton {
  const out: Record<string, { p: Vec; score: number } | null> = { ...drawn };
  for (const name of ["pelvis", "neck", "leftShoulder", "rightShoulder", "leftHip", "rightHip"] as const) out[name] = target[name] ?? drawn[name];
  for (const def of BONES) {
    if (def.name === "torso") continue;
    const [from, to] = [def.from as JointName, def.to as JointName];
    const [da, db, ta, tb] = [drawn[from]?.p, drawn[to]?.p, target[from]?.p, target[to]?.p];
    const start = out[from]?.p;
    if (!da || !db || !start) continue;
    const length = ta && tb ? Math.hypot(tb[0] - ta[0], tb[1] - ta[1]) : Math.hypot(db[0] - da[0], db[1] - da[1]);
    const d = Math.hypot(db[0] - da[0], db[1] - da[1]) || 1;
    out[to] = { p: [start[0] + ((db[0] - da[0]) / d) * length, start[1] + ((db[1] - da[1]) / d) * length], score: drawn[to]!.score };
  }
  return out as unknown as Skeleton;
}

export type ScanCell = { readonly cell: string; readonly problems: readonly string[] };

export type ScanReport = Check & {
  readonly alignment: Similarity | null;
  /** Per joint, distance from its target after alignment, torso lengths. */
  readonly residuals: Partial<Record<JointName, number>>;
  readonly mean: number | null;
  readonly mirrored: boolean;
  readonly cells: readonly ScanCell[];
  /** Per limb, the share of its target volume the drawing actually covers with pixels. */
  readonly coverage: Partial<Record<BoneName, number>>;
  /** The drawing's pose rebuilt on the target's proportions (what is compared). */
  readonly posed?: Skeleton;
};

export type ScanLimits = { readonly mean: number; readonly joint: number; readonly cells: number; readonly coverage: number };
// Set on run 558b (frames 1–21): approved drawings average 0.070 torso, rejected ones 0.245.
export const DEFAULT_SCAN_LIMITS: ScanLimits = { mean: 0.12, joint: 0.3, cells: 3, coverage: 0.3 };

const nice = (name: string) => name.replace(/([A-Z])/g, " $1").toLowerCase();

/**
 * Scans a drawing against its target. `drawn` is the skeleton measured on the drawing, `image`
 * the drawing (its alpha says where it has pixels), both on the canvas of the target.
 */
export function scanPose(target: Skeleton, drawn: Skeleton | null, image: Rgba, limits: ScanLimits = DEFAULT_SCAN_LIMITS): ScanReport {
  const empty = { alignment: null, residuals: {}, mean: null, mirrored: false, cells: [], coverage: {} };
  const unit = torsoLength(target);
  if (!unit) return { name: "scan", passed: true, detail: "target has no torso; not scanned", ...empty };
  if (!drawn || !torsoLength(drawn)) return { name: "scan", passed: false, detail: "no body found in the drawing", feedback: "Draw the whole character, head to feet, facing the viewer.", ...empty };

  // 1. Alignment on the torso, and the same with the drawing's sides exchanged.
  const fit = (s: Skeleton) => {
    const pairs = ALIGN.filter((name) => s[name] && target[name]);
    const m = procrustes(pairs.map((name) => s[name]!.p), pairs.map((name) => target[name]!.p));
    if (!m) return null;
    const residuals: Partial<Record<JointName, number>> = {};
    for (const name of REPORTED) {
      const [a, b] = [s[name], target[name]];
      if (a && b) residuals[name] = Math.round((Math.hypot(...(applySimilarity(m, a.p).map((v, i) => v - b.p[i]) as [number, number])) / unit) * 1000) / 1000;
    }
    const values = Object.values(residuals);
    return { m, residuals, mean: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : Infinity };
  };
  const swapped = Object.fromEntries(Object.entries(drawn).map(([name, joint]) => [MIRROR_JOINT[name as JointName], joint])) as unknown as Skeleton;
  const straight = fit(drawn);
  const mirror = fit(swapped);
  if (!straight) return { name: "scan", passed: false, detail: "the drawing's torso can't be aligned", ...empty };
  const mirrored = Boolean(mirror && mirror.mean < straight.mean * 0.6 && straight.mean > limits.mean);
  const aligned = Object.fromEntries(Object.entries(drawn).map(([name, joint]) => [name, joint ? { p: applySimilarity(straight.m, joint.p), score: joint.score } : null])) as unknown as Skeleton;
  // Pose, not proportions: each limb chain rebuilt from the target's shoulder or hip with the
  // drawing's bone directions and the target's bone lengths. A character with longer legs than
  // the target lands its ankles elsewhere without being in another pose.
  const posed = rebuild(aligned, target);

  const residuals: Partial<Record<JointName, number>> = {};
  for (const name of REPORTED) {
    const [a, b] = [posed[name], target[name]];
    if (a && b) residuals[name] = Math.round((Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) / unit) * 1000) / 1000;
  }
  const residualValues = Object.values(residuals);
  const mean = residualValues.length ? residualValues.reduce((sum, v) => sum + v, 0) / residualValues.length : Infinity;

  // 2. The grid: target and drawing as body-part volumes, compared cell by cell; and the drawing's pixels under each target limb.
  const step = 8;
  const [w, h] = [Math.ceil(image.width / step), Math.ceil(image.height / step)];
  const want = partMap(target, image.width, image.height, step);
  const got = partMap(posed, image.width, image.height, step);
  const perCell = GRID.cell / step;
  const inverse: Similarity = invertSimilarity(straight.m);
  const cells: ScanCell[] = [];
  const coverageCount = new Map<number, [number, number]>();
  for (let cy = 0; cy < GRID.rows; cy++) for (let cx = 0; cx < GRID.columns; cx++) {
    const expected = new Map<number, number>();
    const present = new Map<number, number>();
    for (let y = cy * perCell; y < Math.min(h, (cy + 1) * perCell); y++) for (let x = cx * perCell; x < Math.min(w, (cx + 1) * perCell); x++) {
      const [t, d] = [want[y * w + x], got[y * w + x]];
      if (t >= 0) expected.set(t, (expected.get(t) ?? 0) + 1);
      if (d >= 0) present.set(d, (present.get(d) ?? 0) + 1);
      if (t >= 0 && COVERED.includes(BONES[t].name)) {
        // The drawing's own pixel under this target point: back through the alignment.
        const [sx, sy] = applySimilarity(inverse, [x * step + step / 2, y * step + step / 2]).map(Math.round);
        const c = coverageCount.get(t) ?? [0, 0];
        c[0]++;
        if (sx >= 0 && sy >= 0 && sx < image.width && sy < image.height && image.data[(sy * image.width + sx) * 4 + 3] >= 128) c[1]++;
        coverageCount.set(t, c);
      }
    }
    const problems: string[] = [];
    const area = perCell * perCell;
    for (const limb of LIMBS) {
      const i = BONES.findIndex((def) => def.name === limb);
      const [e, p] = [(expected.get(i) ?? 0) / area, (present.get(i) ?? 0) / area];
      if (e - p > 0.2) problems.push(`${nice(limb)} missing`);
      else if (p - e > 0.2) problems.push(`${nice(limb)} not here`);
    }
    if (problems.length) cells.push({ cell: `${COLUMNS[cx]}${cy + 1}`, problems });
  }
  const coverage: Partial<Record<BoneName, number>> = {};
  for (const [i, [all, drawnPixels]] of coverageCount) if (all >= 6) coverage[BONES[i].name] = Math.round((drawnPixels / all) * 100) / 100;
  const uncovered = Object.entries(coverage).filter(([, share]) => share < limits.coverage).map(([name]) => name);

  // 3. Verdict and feedback in grid cells.
  const off = REPORTED.filter((name) => (residuals[name] ?? 0) > limits.joint);
  const passed = !mirrored && mean <= limits.mean && !off.length && cells.length <= limits.cells && !uncovered.length;
  const where = (name: JointName) => `${nice(name)}: should be in ${cellName(target[name]!.p)}, drawn in ${cellName(posed[name]!.p)}`;
  const fixes = mirrored
    ? ["The drawing is a mirror image of the pose: left and right are swapped. Keep each arm and leg on the same side of the picture as the mannequin."]
    : [...off.filter((name) => posed[name] && target[name]).map((name) => `${where(name)}.`), ...uncovered.map((name) => `Nothing is drawn where the ${nice(name)} goes.`)];
  const detail = `${mirrored ? "MIRRORED, " : ""}joints off by ${mean.toFixed(3)} torso (worst ${Object.entries(residuals).sort((a, b) => b[1] - a[1])[0]?.join(" ") ?? "—"}), ${cells.length} bad cells${cells.length ? ` (${cells.slice(0, 4).map((c) => c.cell).join(" ")})` : ""}${uncovered.length ? `, empty: ${uncovered.join(", ")}` : ""}`;
  return {
    name: "scan", passed, detail, score: Math.round(mean * 1000) / 1000, ...(fixes.length ? { feedback: fixes.join(" ") } : {}),
    alignment: straight.m, residuals, mean, mirrored, cells, coverage, posed,
  };
}

/**
 * The scan as a picture: the video frame (already on the canvas, gridded) under the drawing,
 * the target skeleton in green and the drawing's aligned skeleton in pink, bad cells outlined
 * in red with what's wrong.
 */
export async function scanOverlay(video: Buffer, drawing: Buffer, target: Skeleton, drawn: Skeleton | null, report: ScanReport): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(video).metadata();
  const faded = await sharp(drawing).ensureAlpha().resize(width, height, { fit: "fill" }).composite([{ input: Buffer.from([255, 255, 255, 90]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }]).png().toBuffer();
  const line = (s: Skeleton, colour: string, map: (p: Vec) => Vec, dash = "") => BONES.flatMap((def) => {
    const [a, b] = [s[def.from as JointName]?.p, s[def.to as JointName]?.p];
    if (!a || !b) return [];
    const [p, q] = [map(a), map(b)];
    return [`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${colour}" stroke-width="7" stroke-linecap="round" ${dash}/>`];
  }).join("");
  const align = report.alignment;
  const cells = report.cells.map(({ cell, problems }) => {
    const [x, y] = [COLUMNS.indexOf(cell[0]) * GRID.cell, (Number(cell.slice(1)) - 1) * GRID.cell];
    return `<rect x="${x + 3}" y="${y + 3}" width="${GRID.cell - 6}" height="${GRID.cell - 6}" fill="rgba(230,0,0,0.12)" stroke="#e00" stroke-width="5"/><text x="${x + 8}" y="${y + 24}" font-size="17" font-family="Helvetica" font-weight="700" fill="#b00">${problems[0].replace(/&/g, "")}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells}${line(target, "#00a651", (p) => p, 'stroke-dasharray="16 10"')}${report.posed ? line(report.posed, "#d6338a", (p) => p) : drawn && align ? line(drawn, "#d6338a", (p) => applySimilarity(align, p)) : ""}</svg>`;
  return sharp(video).composite([{ input: faded }, { input: Buffer.from(svg) }]).png().toBuffer();
}
