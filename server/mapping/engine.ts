import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { fromRgba, type Rgba } from "../rotoscope/alpha";
import type { Marks } from "../rotoscope/grid";
import type { Pose } from "../rotoscope/pose-match";
import type { Manifest } from "../rotoscope/run-state";
import { policyRegistry, type PolicyRegistry } from "../policies/registry";
import type { BaseCandidate, PlanDecision, PolicyOutcome } from "../policies/rules";
import { deform, type DeformResult } from "./deform";
import { readDiagnostics } from "./diagnostics";
import { area, bounds, fromAlpha, maskFromPng, maskToPng, type Mask } from "./mask";
import { analyzeDrawing, characterFullLengths, type Analysis } from "./profile";
import type { PoseEstimator, PoseFile } from "./pose-estimator";
import { retarget, sourceFullLengths, type FullLengths, type Target } from "./retarget";
import { buildRig, type Rig } from "./rig";
import { samSegmenter, type Segmenter } from "./segmenter";
import { mapSkeleton, skeletonFromPose, type BoneName, type JointName } from "./skeleton";
import { stabilizeTrack, type TrackedFrame } from "./source-track";

// The Character Mapping Engine for a rotoscope run. Opened once per
// generate: it analyses the character sheet (cached), stabilizes the source
// pose track (cached), and for each frame plans which drawing to deform
// (runtime policy: straight ahead or pose to pose), retargets the source
// pose onto the character, deforms the drawing and reports every policy
// outcome. It never calls a paid model except through the segmenter the
// caller chose and, separately, the repair step the pipeline decides on.

export type Overrides = {
  /** Per frame: target joints a person moved in the inspector, canvas pixels. */
  readonly frames?: Readonly<Record<string, { readonly joints: Partial<Record<JointName, readonly [number, number]>> }>>;
  /** Draw order corrections for every drawing of the run. */
  readonly layers?: Partial<Record<BoneName, number>>;
};

export const OVERRIDES_FILE = "mapping/overrides.json";

export async function readOverrides(dir: string): Promise<Overrides> {
  return readFile(path.join(dir, OVERRIDES_FILE), "utf8").then((raw) => JSON.parse(raw) as Overrides, () => ({}));
}

export async function writeOverrides(dir: string, overrides: Overrides): Promise<void> {
  const file = path.join(dir, OVERRIDES_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(overrides, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

export type RunMapping = {
  readonly dir: string;
  readonly segmenter: Segmenter;
  readonly estimator?: PoseEstimator;
  readonly registry: PolicyRegistry;
  readonly sheet: Analysis;
  readonly raw: readonly Pose[];
  readonly track: readonly TrackedFrame[];
  readonly sourceFull: FullLengths;
  readonly subjectTracked: boolean;
  readonly overrides: Overrides;
  /** Run-wide planning outcomes (timing, stabilizer lag). */
  readonly outcomes: readonly PolicyOutcome[];
  /** Analyses of approved drawings, by file SHA (filled as frames are used). */
  readonly drawings: Map<string, Analysis>;
};

const cacheDir = (dir: string) => path.join(dir, "mapping", "cache");

async function subjectMasks(dir: string, manifest: Manifest, segmenter: Segmenter, signal?: AbortSignal): Promise<Map<number, Mask> | null> {
  const folder = path.join(dir, "mapping", "subject");
  if (existsSync(path.join(folder, "done"))) {
    const out = new Map<number, Mask>();
    for (const name of await readdir(folder)) {
      const match = /^frame_(\d{4})\.png$/.exec(name);
      if (match) out.set(Number(match[1]) - 1, await maskFromPng(await readFile(path.join(folder, name))));
    }
    return out;
  }
  if (!segmenter.subject) return null;
  const frames = manifest.frames.map((frame) => path.join(dir, frame.source));
  const masks = await segmenter.subject(frames, manifest.fps, path.join(dir, "mapping", "sam-video"), signal);
  await mkdir(folder, { recursive: true });
  for (const [t, mask] of masks) await writeFile(path.join(folder, `frame_${String(t + 1).padStart(4, "0")}.png`), await maskToPng(mask));
  await writeFile(path.join(folder, "done"), `${new Date().toISOString()}\n`);
  return masks;
}

export async function openMapping(dir: string, options: {
  readonly manifest: Manifest;
  readonly segmenter?: Segmenter;
  readonly estimator?: PoseEstimator;
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
}): Promise<RunMapping> {
  const segmenter = options.segmenter ?? samSegmenter();
  const registry = policyRegistry();
  const overrides = await readOverrides(dir);
  const sheet = await analyzeDrawing(await readFile(path.join(dir, options.manifest.character.file)), { cacheDir: cacheDir(dir), segmenter, estimator: options.estimator, rig: { z: overrides.layers }, signal: options.signal });
  const raw = (JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile).frames;
  const masks = await subjectMasks(dir, options.manifest, segmenter, options.signal).catch((error: unknown) => {
    options.log?.(`  SAM 3.1 subject tracking unavailable (${error instanceof Error ? error.message.slice(0, 100) : String(error)}); following the pose track alone`);
    return null;
  });
  let track = stabilizeTrack(raw, { fps: options.manifest.fps, masks: masks ?? undefined });
  const times = { expected: options.manifest.frames.map((_, i) => options.manifest.start + i / options.manifest.fps), actual: raw.map((_, i) => options.manifest.start + i / options.manifest.fps) };
  const planning = registry.run("pose-planning", { stage: "pose-planning", index: 0, target: skeletonFromPose(raw[0] ?? { keypoints: [], scores: [] }), candidates: [], times, track: { raw, stabilized: track, fps: options.manifest.fps } });
  const lag = planning.outcomes.find((outcome) => outcome.id === "follow-through/keep-overlap");
  // The smoothing would flatten the follow-through: keep the swap fixes and bridges, drop the filter.
  if (lag && !lag.passed) track = stabilizeTrack(raw, { fps: options.manifest.fps, masks: masks ?? undefined, minCutoff: 1e6 });
  await mkdir(path.join(dir, "mapping"), { recursive: true });
  await writeFile(path.join(dir, "mapping", "source-track.json"), JSON.stringify({ fps: options.manifest.fps, smoothed: !lag || lag.passed, frames: track }));
  return {
    dir, segmenter, estimator: options.estimator, registry, sheet, raw, track,
    sourceFull: sourceFullLengths(track), subjectTracked: Boolean(masks?.size), overrides,
    outcomes: planning.outcomes.filter((outcome) => outcome.id !== "straight-ahead-pose/base-selection"),
    drawings: new Map(),
  };
}

/** How many deformations deep an approved frame is: 0 for a drawing made by a generator or approved by hand. */
async function depthOf(dir: string, manifest: Manifest, index: number, seen = new Set<number>()): Promise<number> {
  const frame = manifest.frames.find((entry) => entry.index === index);
  if (!frame?.approved || frame.approved.manual || seen.has(index)) return 0;
  const record = await readDiagnostics(dir, index, frame.approved.attempt);
  if (!record?.method.startsWith("rig") || record.base?.index == null) return 0;
  seen.add(index);
  return 1 + await depthOf(dir, manifest, record.base.index, seen);
}

/** The character sheet placed on the canvas: hair top on the frame's hair line, soles on its sole line, hips on its centre. */
function sheetPlacement(sheet: Analysis, marks: Marks): { scale: number; x: number; y: number } | null {
  const box = bounds(sheet.mask);
  const pelvis = sheet.rig.skeleton.pelvis;
  if (!box || !pelvis) return null;
  const scale = (marks.feet - marks.head) / Math.max(1, box.bottom - box.top);
  return { scale, x: marks.center - pelvis.p[0] * scale, y: marks.head - box.top * scale };
}

async function placedSheet(sheet: Analysis, at: { scale: number; x: number; y: number }, canvas: { width: number; height: number }, layers?: Overrides["layers"]): Promise<{ image: Rgba; rig: Rig; mask: Mask }> {
  const png = await sharp(sheet.image.data, { raw: { width: sheet.image.width, height: sheet.image.height, channels: 4 } }).png().toBuffer();
  const [w, h] = [Math.round(sheet.image.width * at.scale), Math.round(sheet.image.height * at.scale)];
  const scaled = await sharp(png).resize(w, h).png().toBuffer();
  const [left, top] = [Math.round(at.x), Math.round(at.y)];
  const padded = await sharp(scaled).extend({ left: Math.max(0, left), top: Math.max(0, top), right: canvas.width, bottom: canvas.height, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const { data, info } = await sharp(padded).extract({ left: Math.max(0, -left), top: Math.max(0, -top), width: canvas.width, height: canvas.height }).raw().toBuffer({ resolveWithObject: true });
  const image: Rgba = { data, width: info.width, height: info.height };
  const mask = fromAlpha(image);
  const skeleton = mapSkeleton(sheet.rig.skeleton, (p) => [p[0] * at.scale + left, p[1] * at.scale + top]);
  return { image, rig: buildRig(image, mask, skeleton, { z: layers }), mask };
}

export type MappedFrame = {
  readonly target: Target;
  readonly decision: PlanDecision;
  readonly base: { readonly candidate: BaseCandidate; readonly rig: Rig; readonly mask: Mask; readonly analysis: Analysis | null };
  readonly result: DeformResult;
  readonly png: Buffer;
  /** Exposed and over-stretched pixels: what a repair may repaint. */
  readonly regions: Mask;
  readonly outcomes: readonly PolicyOutcome[];
  readonly hints: readonly string[];
};

const NEAREST_DRAWINGS = 12;

/**
 * Maps one frame. `guide` is the frame's pose guide on the canvas, `marks`
 * its grid lines; `exclude` skips bases already tried. Throws when no drawing
 * can be deformed; the caller then draws the frame another way.
 */
export async function mapFrame(mapping: RunMapping, input: {
  readonly index: number;
  readonly manifest: Manifest;
  readonly guide: Pose;
  readonly marks: Marks;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly exclude?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
}): Promise<MappedFrame> {
  const { dir, registry } = mapping;
  const approved = input.manifest.frames.filter((frame) => frame.status === "approved" && frame.approved && frame.index !== input.index)
    .sort((a, b) => Math.abs(a.index - input.index) - Math.abs(b.index - input.index)).slice(0, NEAREST_DRAWINGS);
  const candidates: BaseCandidate[] = [];
  const analyses = new Map<string, Analysis>();
  for (const frame of approved) {
    const png = await readFile(path.join(dir, frame.approved!.file));
    const key = frame.approved!.sha256;
    let analysis = mapping.drawings.get(key);
    if (!analysis) {
      analysis = await analyzeDrawing(png, { cacheDir: cacheDir(dir), segmenter: { ...mapping.segmenter, regions: null }, estimator: mapping.estimator, rig: { z: mapping.overrides.layers }, signal: input.signal }).catch(() => undefined);
      if (analysis) mapping.drawings.set(key, analysis);
    }
    if (!analysis) continue;
    const id = `frame ${frame.index}`;
    analyses.set(id, analysis);
    candidates.push({ id, index: frame.index, skeleton: analysis.rig.skeleton, depth: await depthOf(dir, input.manifest, frame.index) });
  }
  const placement = sheetPlacement(mapping.sheet, input.marks);
  if (placement) candidates.push({ id: "character sheet", index: null, skeleton: mapSkeleton(mapping.sheet.rig.skeleton, (p) => [p[0] * placement.scale + Math.round(placement.x), p[1] * placement.scale + Math.round(placement.y)]), depth: 0 });

  const override = mapping.overrides.frames?.[String(input.index)]?.joints;
  const target = retarget({
    source: mapping.track[input.index - 1],
    guide: input.guide,
    character: characterFullLengths([mapping.sheet.profile, ...[...analyses.values()].map((analysis) => analysis.profile)]),
    sourceFull: mapping.sourceFull,
    overrides: override as Partial<Record<JointName, readonly [number, number]>> | undefined,
  });
  const planning = registry.run("pose-planning", { stage: "pose-planning", index: input.index, target: target.skeleton, candidates: candidates.filter((candidate) => !input.exclude?.has(candidate.id)) });
  const decision = planning.decision;
  if (!decision?.base) throw new Error(planning.outcomes[0]?.detail ?? "no drawing to deform from");
  const analysis = analyses.get(decision.base.id) ?? null;
  const base = analysis
    ? { rig: analysis.rig, image: analysis.image, mask: analysis.mask }
    : await placedSheet(mapping.sheet, placement!, input.canvas, mapping.overrides.layers);
  const result = deform(base.image, base.rig, target.skeleton);
  const preparation = registry.run("frame-preparation", { stage: "frame-preparation", plan: result.plan });
  const rendering = registry.run("rendering", { stage: "rendering", result, baseArea: area(base.mask) });
  const regions: Mask = { width: result.exposed.width, height: result.exposed.height, data: result.exposed.data.map((v, p) => (v || result.distorted.data[p] ? 1 : 0)) };
  return {
    target,
    decision,
    base: { candidate: decision.base, rig: base.rig, mask: base.mask, analysis },
    result,
    png: await fromRgba(result.image),
    regions,
    outcomes: [...mapping.outcomes, ...planning.outcomes, ...preparation.outcomes, ...rendering.outcomes],
    hints: registry.hints("rendering"),
  };
}

