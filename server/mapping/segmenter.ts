import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { readMetaConfig } from "../ai/meta";
import { segmentImage, segmentImageObjects, segmentVideo } from "../ai/sam";
import { ffmpeg } from "../ffmpeg";
import { rasterizeSelection } from "../video/masks";
import type { Rgba } from "../rotoscope/alpha";
import { segmentDistance, type Vec } from "./geometry";
import { area, fromAlpha, fromBackdrop, hasTransparency, intersectionOverUnion, largestComponent, type Mask } from "./mask";
import type { Rig } from "./rig";
import { BONE_NAMES, type BoneName } from "./skeleton";

// Segmentation for the mapping engine. SAM 3.1 (Meta Model API, sam.ts)
// gives the character's pixel-accurate silhouette, can isolate body regions
// from box and point prompts, and tracks the source subject through the
// video in one call. A local fallback cuts a figure from a flat backdrop or
// its own transparency. Masks say which pixels belong to the figure (or to a
// region); joints always come from the pose estimator.
//
// FOCUS_MAPPING_SAM picks how much SAM does: "character" (default: the
// character sheet, one call per character, cached), "all" (also region
// prompts and source-video tracking, one call each per run) or "off".

export type SamUse = "off" | "character" | "all";

export function samUse(env: Readonly<Record<string, string | undefined>> = process.env): SamUse {
  const value = env.FOCUS_MAPPING_SAM?.trim();
  if (value === "off" || value === "all") return value;
  return readMetaConfig(env) ? "character" : "off";
}

export type CharacterMask = { readonly mask: Mask; readonly method: "sam-3.1" | "alpha" | "backdrop"; readonly confidence: number | null };

export type Segmenter = {
  readonly character: (png: Buffer, signal?: AbortSignal) => Promise<CharacterMask>;
  /** One mask per prompted region, by bone; null when region prompts are off. */
  readonly regions: ((png: Buffer, rig: Rig, signal?: AbortSignal) => Promise<Map<BoneName, Mask>>) | null;
  /** The tracked subject's mask per frame (0-based), from SAM 3.1 video tracking; null when off. */
  readonly subject: ((frames: readonly string[], fps: number, workDir: string, signal?: AbortSignal) => Promise<Map<number, Mask>>) | null;
};

async function rgbaOf(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Transparency when the image has it, else the figure against its flat backdrop. */
export async function localMask(png: Buffer): Promise<CharacterMask> {
  const image = await rgbaOf(png);
  return hasTransparency(image)
    ? { mask: largestComponent(fromAlpha(image)), method: "alpha", confidence: null }
    : { mask: fromBackdrop(image), method: "backdrop", confidence: null };
}

/** SAM's character mask is trusted only when it agrees with the drawing (a box-shaped or tiny mask is a miss). */
const SAM_AGREEMENT = 0.6;

export function samSegmenter(use: SamUse = samUse()): Segmenter {
  const character = async (png: Buffer, signal?: AbortSignal): Promise<CharacterMask> => {
    const local = await localMask(png);
    if (use === "off") return local;
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const masks = await segmentImage({ png: await sharp(png).png().toBuffer(), width, height, concept: "anime character", signal }).catch(() => []);
    const best = masks[0];
    if (!best) return local;
    const mask = largestComponent({ width, height, data: best.alpha.map((v) => (v ? 1 : 0)) });
    // On a transparent cut-out the alpha is already exact; SAM refines an opaque sheet.
    if (local.method === "alpha") return local;
    return intersectionOverUnion(mask, local.mask) >= SAM_AGREEMENT ? { mask, method: "sam-3.1", confidence: best.confidence } : local;
  };
  return {
    character,
    regions: use === "all" ? (png, rig, signal) => samRegions(png, rig, signal) : null,
    subject: use === "all" ? (frames, fps, workDir, signal) => samSubject(frames, fps, workDir, signal) : null,
  };
}

export const localSegmenter: Segmenter = { character: (png) => localMask(png), regions: null, subject: null };

// ── Region prompts ─────────────────────────────────────────────────────────

export type RegionPrompt = {
  readonly id: number;
  readonly bone: BoneName;
  readonly box: { left: number; top: number; right: number; bottom: number };
  readonly points: readonly { x: number; y: number; label?: "positive" | "negative" }[];
};

/**
 * One object prompt per limb: its capsule's box, three positive points along
 * the bone and negative points on the other bones inside that box, so SAM
 * separates an arm from the torso it lies over.
 */
export function regionPrompts(rig: Rig): RegionPrompt[] {
  const clampX = (x: number) => Math.max(0, Math.min(rig.width - 1, Math.floor(x)));
  const clampY = (y: number) => Math.max(0, Math.min(rig.height - 1, Math.floor(y)));
  return rig.bones.filter((bone) => bone.name !== "torso").map((bone) => {
    const r = bone.radius * 1.2;
    const box = {
      left: clampX(Math.min(bone.from[0], bone.to[0]) - r), top: clampY(Math.min(bone.from[1], bone.to[1]) - r),
      right: clampX(Math.max(bone.from[0], bone.to[0]) + r) + 1, bottom: clampY(Math.max(bone.from[1], bone.to[1]) + r) + 1,
    };
    const along = [0.3, 0.55, 0.8].map((t): Vec => [bone.from[0] + (bone.to[0] - bone.from[0]) * t, bone.from[1] + (bone.to[1] - bone.from[1]) * t]);
    const others = rig.bones.filter((other) => other !== bone).map((other): Vec => [(other.from[0] + other.to[0]) / 2, (other.from[1] + other.to[1]) / 2])
      .filter((p) => p[0] >= box.left && p[0] < box.right && p[1] >= box.top && p[1] < box.bottom && segmentDistance(p, bone.from, bone.to).distance > bone.radius * 1.5)
      .slice(0, 3);
    return {
      id: bone.index,
      bone: bone.name,
      box,
      points: [
        ...along.filter((p) => rig.mask.data[clampY(p[1]) * rig.width + clampX(p[0])]).map((p) => ({ x: clampX(p[0]), y: clampY(p[1]) })),
        ...others.map((p) => ({ x: clampX(p[0]), y: clampY(p[1]), label: "negative" as const })),
      ],
    };
  });
}

/**
 * A SAM region is used only where it agrees with the rig's own estimate of
 * that region and stays inside the silhouette: SAM doesn't reliably isolate
 * every limb, and a disagreeing mask is dropped, not trusted.
 */
export function acceptRegion(region: Mask, rig: Rig, bone: BoneName): boolean {
  const index = BONE_NAMES.indexOf(bone) + 1;
  const prior: Mask = { width: rig.width, height: rig.height, data: rig.labels.map((label) => (label === index ? 1 : 0)) };
  const [a, b] = [area(region), area(prior)];
  if (!a || !b || a / b < 0.4 || a / b > 2.5) return false;
  let outside = 0;
  for (let p = 0; p < region.data.length; p++) if (region.data[p] && !rig.mask.data[p]) outside++;
  return outside / a < 0.15 && intersectionOverUnion(region, prior) >= 0.3;
}

/** Relabels the pixels of accepted SAM regions inside the silhouette; front-most region wins where they overlap. */
export function applyRegions(rig: Rig, regions: ReadonlyMap<BoneName, Mask>): { labels: Uint8Array; applied: BoneName[] } {
  const labels = Uint8Array.from(rig.labels);
  const applied = [...regions.entries()].filter(([bone, mask]) => acceptRegion(mask, rig, bone))
    .map(([bone, mask]) => ({ bone, mask, z: rig.bones.find((b) => b.name === bone)?.z ?? 0 }))
    .sort((a, b) => a.z - b.z);
  for (const { bone, mask } of applied) {
    const index = BONE_NAMES.indexOf(bone) + 1;
    for (let p = 0; p < labels.length; p++) if (mask.data[p] && rig.mask.data[p]) labels[p] = index;
  }
  return { labels, applied: applied.map((entry) => entry.bone) };
}

async function samRegions(png: Buffer, rig: Rig, signal?: AbortSignal): Promise<Map<BoneName, Mask>> {
  const prompts = regionPrompts(rig).filter((prompt) => prompt.points.some((point) => point.label !== "negative"));
  const masks = await segmentImageObjects({
    png, width: rig.width, height: rig.height, signal,
    objects: prompts.map((prompt) => ({ id: prompt.id, prompts: [{ box: prompt.box, points: prompt.points }] })),
  });
  const out = new Map<BoneName, Mask>();
  for (const mask of masks) {
    const bone = BONE_NAMES[Number(mask.objectId)];
    if (bone) out.set(bone, { width: rig.width, height: rig.height, data: mask.alpha.map((v) => (v ? 1 : 0)) });
  }
  return out;
}

// ── Source subject tracking ────────────────────────────────────────────────

/**
 * The source frames as one H.264 clip, tracked by SAM 3.1 with the concept
 * "person" in a single request; the object present in most frames with the
 * largest area is the subject. Frames are 0-based clip frames.
 */
async function samSubject(frames: readonly string[], fps: number, workDir: string, signal?: AbortSignal): Promise<Map<number, Mask>> {
  await mkdir(workDir, { recursive: true });
  const { width = 0, height = 0 } = await sharp(frames[0]).metadata();
  const clip = path.join(workDir, "source.mp4");
  const list = path.join(path.dirname(frames[0]), "frame_%04d.png");
  await ffmpeg(["-y", "-framerate", String(fps), "-i", list, "-frames:v", String(frames.length), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip], 300_000);
  const [w, h] = [width + (width % 2), height + (height % 2)];
  const tracking = await segmentVideo({
    id: "mapping-subject", videoId: path.basename(path.dirname(workDir)), videoDir: workDir, normalizedPath: clip,
    media: { width: w, height: h, fps, frameCount: frames.length, durationSeconds: frames.length / fps, codec: "h264", hasAudio: false },
    prompt: { kind: "concept", concept: "person" }, signal,
  });
  const subject = [...tracking.objects].sort((a, b) => b.framesPresent - a.framesPresent || b.meanArea - a.meanArea)[0];
  const out = new Map<number, Mask>();
  if (!subject) return out;
  for (const frame of tracking.frames) {
    const { data } = rasterizeSelection(frame, new Set([subject.id]), w, h);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = data[y * w + x] ? 1 : 0;
    out.set(frame.frameIndex, { width, height, data: mask });
  }
  return out;
}
