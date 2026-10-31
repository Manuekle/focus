import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { Rgba } from "../rotoscope/alpha";
import type { Pose } from "../rotoscope/pose-match";
import { angleDiff, angleOf, dist, percentile, sub, type Vec } from "./geometry";
import { maskFromPng, maskToPng, type Mask } from "./mask";
import { estimatePose, type PoseEstimator } from "./pose-estimator";
import type { FullLengths } from "./retarget";
import { buildRig, type Rig, type RigOptions } from "./rig";
import { applyRegions, type Segmenter } from "./segmenter";
import { BONES, BONE_NAMES, cocoPoint, facingCamera, JOINT_NAMES, normalizeSkeleton, skeletonFromPose, type BoneName, type JointName } from "./skeleton";

// Character analysis: one drawing of the character (the uploaded sheet, or
// an approved frame) → silhouette mask, whole-body landmarks, articulated
// rig and a reusable mapping profile, cached by the image's SHA-256. The
// second run on the same picture reads the cache: no model call, no pose
// estimation. A profile records how each part was obtained (SAM 3.1 or the
// local fallback, which estimator) so the inspector can show it.

export type HeadOrientation = {
  /** Enough face points (eyes, nose, jaw) to judge the head. */
  readonly reliable: boolean;
  /** Tilt of the eye line from horizontal, degrees (positive: clockwise on screen). */
  readonly roll: number | null;
  /** Nose offset between the eyes, −1 (turned to image left) to 1 (image right); 0 = facing the camera. */
  readonly yaw: number | null;
};

export type MappingProfile = {
  readonly version: 1;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly segmentation: { readonly method: "sam-3.1" | "alpha" | "backdrop"; readonly confidence: number | null; readonly area: number };
  readonly estimator: { readonly name: string; readonly fallback: boolean };
  readonly pose: Pose;
  /** Joints in the image's pixels, with their confidence. */
  readonly joints: Readonly<Record<JointName, readonly [number, number, number] | null>>;
  /** Joints in the normalized character coordinate system (pelvis origin, torso = 1, y up the spine). */
  readonly normalized: Readonly<Record<JointName, Vec | null>>;
  /** Bone length over torso length. */
  readonly proportions: FullLengths;
  readonly bones: readonly { readonly name: BoneName; readonly length: number; readonly radius: number; readonly z: number; readonly confidence: number }[];
  readonly landmarks: { readonly face: number; readonly leftHand: number; readonly rightHand: number; readonly feet: number };
  readonly head: HeadOrientation;
  readonly facing: "camera" | "away";
  /** How body regions were assigned: from the skeleton and the line art, refined by SAM region prompts where they agreed. */
  readonly regions: { readonly method: "geometric" | "sam-3.1"; readonly applied: readonly BoneName[] };
  /** 64-bin colour histogram of the figure (4 levels per channel), for the consistency score. */
  readonly palette: readonly number[];
};

export type Analysis = { readonly profile: MappingProfile; readonly rig: Rig; readonly image: Rgba; readonly mask: Mask; readonly dir: string };

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function palette(image: Rgba, mask: Mask): number[] {
  const bins = new Array<number>(64).fill(0);
  let n = 0;
  for (let p = 0; p < mask.data.length; p++) {
    if (!mask.data[p]) continue;
    bins[(image.data[p * 4] >> 6) * 16 + (image.data[p * 4 + 1] >> 6) * 4 + (image.data[p * 4 + 2] >> 6)]++;
    n++;
  }
  return bins.map((count) => (n ? Math.round((count / n) * 10000) / 10000 : 0));
}

/** Histogram intersection of two palettes: 1 = the same colours in the same amounts. */
export function paletteSimilarity(a: readonly number[], b: readonly number[]): number {
  return Math.round(a.reduce((sum, value, i) => sum + Math.min(value, b[i] ?? 0), 0) * 1000) / 1000;
}

export function headOrientation(pose: Pose): HeadOrientation {
  const p = (i: number) => cocoPoint(pose, i)?.p ?? null;
  const [nose, leftEye, rightEye] = [p(0), p(1), p(2)];
  const face = Array.from({ length: 68 }, (_, i) => cocoPoint(pose, 23 + i)).filter(Boolean).length;
  if (!nose || !leftEye || !rightEye || face < 20) return { reliable: false, roll: null, yaw: null };
  const eyes = sub(leftEye, rightEye);
  const span = dist(leftEye, rightEye);
  if (span < 1) return { reliable: false, roll: null, yaw: null };
  const roll = Math.round((angleOf(eyes) * 180) / Math.PI);
  // Where the nose falls between the eyes, projected on the eye line: −1 at the right eye, 1 at the left.
  const t = ((nose[0] - rightEye[0]) * eyes[0] + (nose[1] - rightEye[1]) * eyes[1]) / (span * span);
  return { reliable: angleDiff(angleOf(eyes), 0) < 60, roll, yaw: Math.round(Math.max(-1, Math.min(1, t * 2 - 1)) * 100) / 100 };
}

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}

const LABEL_COLOURS: readonly (readonly [number, number, number])[] = [
  [236, 236, 236], [46, 46, 130], [230, 70, 70], [240, 150, 60], [240, 210, 120], [70, 90, 230], [70, 160, 240], [150, 210, 240],
  [70, 180, 80], [40, 120, 50], [130, 95, 45], [190, 80, 190], [130, 55, 130], [85, 45, 105],
];

/** The rig's regions as a colour image (hidden surface at half opacity), for the inspector. */
export async function labelsPng(rig: Rig): Promise<Buffer> {
  const data = Buffer.alloc(rig.width * rig.height * 4);
  for (let p = 0; p < rig.labels.length; p++) {
    const label = rig.labels[p];
    if (!label) continue;
    const [r, g, b] = LABEL_COLOURS[(label - 1) % LABEL_COLOURS.length];
    data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = b; data[p * 4 + 3] = rig.hidden[p] ? 150 : 255;
  }
  return sharp(data, { raw: { width: rig.width, height: rig.height, channels: 4 } }).png().toBuffer();
}

export class MappingUnavailable extends Error {}

/**
 * Analyses (or reads back) one drawing. `png` is the picture as stored; the
 * pose is estimated on the cut-out (alpha = the mask), so the backdrop can't
 * lend the estimator a second figure.
 */
export async function analyzeDrawing(png: Buffer, options: {
  readonly cacheDir: string;
  readonly segmenter: Segmenter;
  readonly estimator?: PoseEstimator;
  readonly rig?: RigOptions;
  readonly signal?: AbortSignal;
}): Promise<Analysis> {
  const sha = sha256(png);
  const dir = path.join(options.cacheDir, sha);
  const profileFile = path.join(dir, "profile.json");
  const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source: Rgba = { data: raw.data, width: raw.info.width, height: raw.info.height };
  if (existsSync(profileFile) && existsSync(path.join(dir, "mask.png"))) {
    const profile = JSON.parse(await readFile(profileFile, "utf8")) as MappingProfile;
    const mask = await maskFromPng(await readFile(path.join(dir, "mask.png")));
    const image = cutOut(source, mask);
    const built = buildRig(image, mask, skeletonFromPose(profile.pose), options.rig);
    const labels = existsSync(path.join(dir, "labels.bin")) ? new Uint8Array(await readFile(path.join(dir, "labels.bin"))) : null;
    const rig = labels && labels.length === built.labels.length ? { ...built, labels } : built;
    return { profile, rig, image, mask, dir };
  }
  await mkdir(dir, { recursive: true });
  const segmented = await options.segmenter.character(png, options.signal);
  const mask = segmented.mask;
  const image = cutOut(source, mask);
  const cutFile = path.join(dir, "cutout.png");
  await writeAtomic(cutFile, await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).png().toBuffer());
  const estimate = await estimatePose(cutFile, path.join(dir, "pose.json"), options.estimator);
  if (!estimate) throw new MappingUnavailable("no full body (shoulders and hips) found by either pose estimator");
  const skeleton = skeletonFromPose(estimate.pose);
  let rig = buildRig(image, mask, skeleton, options.rig);
  let regions: MappingProfile["regions"] = { method: "geometric", applied: [] };
  if (options.segmenter.regions) {
    const found = await options.segmenter.regions(await sharp(png).png().toBuffer(), rig, options.signal).catch(() => null);
    if (found?.size) {
      const { labels, applied } = applyRegions(rig, found);
      if (applied.length) {
        rig = { ...rig, labels };
        regions = { method: "sam-3.1", applied };
        await writeAtomic(path.join(dir, "labels.bin"), Buffer.from(labels));
      }
    }
  }
  const count = (from: number, n: number) => Array.from({ length: n }, (_, i) => cocoPoint(estimate.pose, from + i)).filter(Boolean).length;
  const profile: MappingProfile = {
    version: 1,
    sha256: sha,
    width: image.width,
    height: image.height,
    createdAt: new Date().toISOString(),
    segmentation: { method: segmented.method, confidence: segmented.confidence, area: mask.data.reduce((sum, v) => sum + v, 0) },
    estimator: { name: estimate.estimator, fallback: estimate.fallback },
    pose: estimate.pose,
    joints: Object.fromEntries(JOINT_NAMES.map((name) => [name, skeleton[name] ? [Math.round(skeleton[name]!.p[0] * 10) / 10, Math.round(skeleton[name]!.p[1] * 10) / 10, Math.round(skeleton[name]!.score * 100) / 100] : null])) as MappingProfile["joints"],
    normalized: normalizeSkeleton(skeleton)!,
    proportions: rig.proportions,
    bones: rig.bones.map(({ name, length, radius, z, confidence }) => ({ name, length: Math.round(length), radius: Math.round(radius), z, confidence: Math.round(confidence * 100) / 100 })),
    landmarks: { face: count(23, 68), leftHand: count(91, 21), rightHand: count(112, 21), feet: count(17, 6) },
    head: headOrientation(estimate.pose),
    facing: facingCamera(skeleton) ? "camera" : "away",
    regions,
    palette: palette(image, mask),
  };
  await writeAtomic(path.join(dir, "mask.png"), await maskToPng(mask));
  await writeAtomic(path.join(dir, "labels.png"), await labelsPng(rig));
  await writeAtomic(profileFile, `${JSON.stringify(profile, null, 2)}\n`);
  return { profile, rig, image, mask, dir };
}

/** The picture with everything outside the mask transparent. */
export function cutOut(image: Rgba, mask: Mask): Rgba {
  const data = Buffer.from(image.data);
  for (let p = 0; p < mask.data.length; p++) if (!mask.data[p]) data[p * 4 + 3] = 0;
  return { data, width: image.width, height: image.height };
}

/**
 * The character's full bone lengths in torso lengths, from every analysed
 * drawing: a limb drawn foreshortened in one picture is long in another. Left
 * and right take the longer of the two (the character is symmetric).
 */
export function characterFullLengths(profiles: readonly MappingProfile[]): FullLengths {
  const out: FullLengths = {};
  for (const def of BONES) {
    const seen = profiles.flatMap((profile) => (profile.proportions[def.name] ? [profile.proportions[def.name]!] : []));
    if (seen.length) out[def.name] = seen.length >= 5 ? percentile(seen, 0.9) : Math.max(...seen);
  }
  for (const name of BONE_NAMES) {
    if (!name.startsWith("left")) continue;
    const other = `right${name.slice(4)}` as BoneName;
    const longest = Math.max(out[name] ?? 0, out[other] ?? 0);
    if (longest > 0) { out[name] = longest; out[other] = longest; }
  }
  return out;
}
