import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { readMetaConfig } from "../ai/meta";
import { constraintFailures } from "../policies/registry";
import type { PolicyOutcome } from "../policies/rules";
import { diagnosticsFile, exposedFile, jointMap, readDiagnostics, skeletonFromMap, writeDiagnostics, type FrameDiagnostics, type RenderMethod } from "../mapping/diagnostics";
import { mapFrame, openMapping, readOverrides, writeOverrides, type MappedFrame, type Overrides, type RunMapping } from "../mapping/engine";
import { area, fromAlpha, intersectionOverUnion, maskToPng, type Mask } from "../mapping/mask";
import { palette, paletteSimilarity } from "../mapping/profile";
import { estimatePose, poseToolAvailable as estimatorAvailable, runPoseTool } from "../mapping/pose-estimator";
import { repairRegions } from "../mapping/refine";
import { boneAngleErrors, jointErrors } from "../mapping/retarget";
import { JOINT_NAMES, skeletonFromPose, type Skeleton } from "../mapping/skeleton";
import { ffmpeg } from "../ffmpeg";
import { dataRoot } from "../storage";
import { decodeImage } from "../animation/image-input";
import { checkAlpha, closeCuts, fromRgba, KEY_COLOR, keyBackground, toRgba } from "./alpha";
import { checkStyle, outlineDensity } from "./style";
import { bodySpec, checkProportions, describeFace, fullLengths, onCanvas, sheetEstimates, sheetLengths, type BodySpec } from "./body-map";
import { analyzePrompt, CANVAS, describeCharacter, describeStyle, writeFramePrompt, describeFrame, describeMotion, drawPoseSheet, drawSwap, swapFramePrompt, type PromptAnalysis, buildPair, buildText, ghostOverlay, profileCharacter, validBuild, reconcileBuild, type BuildProfile, fitCanvas, framePrompt, healFrame, isFrameSpec, isIdentityLine, namePalette, onColour, reviewCheck, reviewFrame, sideBySide, toCanvas, type Correction, type FrameInput } from "./draw";
import { holdColours, PALETTE_VERSION, paletteImage, paletteShares, paletteText, profiledPalette, sheetColours, type Palette } from "./colour";
import { mannequin, sheetBuild } from "./mannequin";
import { generateHiggsfield, higgsfieldConfigured } from "./higgsfield";
import { lessonLines } from "./lessons";
import { keepMemory, noteKitOrigin, recallMemory } from "./prompt-memory";
import { detectCrop, extractFrames, frameName } from "./extract";
import { armLengths, comparePoses, describeLegs, describePose, measureArms, type Pose } from "./pose-match";
import { checkScale, figureBox, GRID, hairTop, REGISTER_SCALE, proportions, sheetHairTop, targets, toLine, withGrid, type Marks } from "./grid";
import { acquireLock, copyInto, readManifest, runFrames, writeManifest, type Check, type Manifest, type RunOutcome } from "./run-state";
import { canonicalJoints, unconfirmed } from "./joints";
import { decide } from "./decision";
import { scanOverlay, scanPose } from "./scan";
import type { TrackedFrame } from "../mapping/source-track";
import { assertIsolation, ProvenanceError, recordReferences, sha256, type CharacterIdentity, type GeneratedFrame, type GenerationTarget } from "./provenance";
import { heightRatio, personFigure, personMarks, type PersonFigure } from "./stature";
import { CharacterMeasuresSchema, measuresText, type CharacterMeasures } from "../../shared/rotoscope";

// The rotoscope pipeline, shared by the console (cli.ts) and the app
// (service.ts): video → frames at N fps → DWPose guides on the character's
// proportions → one drawing per frame, gridded, keyed to alpha, registered
// and validated behind the firewall.

export const runsRoot = () => path.join(dataRoot(), "rotoscope");

/** DWPose runs in the worker's Python environment; a server without it can't prepare runs. */
export const poseToolAvailable = estimatorAvailable;

type PoseFile = { width: number; height: number; files?: string[]; frames: Pose[] };

const pose = runPoseTool;

/** Source-frame pixels → canvas pixels: canvas = source × scale + offset. One layout for the whole clip. */
type Layout = { readonly scale: number; readonly x: number; readonly y: number };

/** Scales an image by `scale` and puts its origin at (ox, oy) on the canvas; the rest is `background`. */
async function place(png: Buffer, scale: number, ox: number, oy: number, background: string | { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const [left, top] = [Math.round(ox), Math.round(oy)];
  const scaled = await sharp(png).ensureAlpha().resize(Math.round(width * scale), Math.round(height * scale)).png().toBuffer();
  const padded = await sharp(scaled).extend({ left: Math.max(0, left), top: Math.max(0, top), right: CANVAS.width, bottom: CANVAS.height, background }).png().toBuffer();
  return sharp(padded).extract({ left: Math.max(0, -left), top: Math.max(0, -top), width: CANVAS.width, height: CANVAS.height }).png().toBuffer();
}

/** The clip's highest reach on line 1 (a free cell above for fingertips), its lowest soles on line 11.5: as large as the clip allows. */
const LAYOUT_TOP = 1 * GRID.cell;
const LAYOUT_BOTTOM = 11.5 * GRID.cell;
const IDENTITY: Layout = { scale: 1, x: 0, y: 0 };

/**
 * The clip's layout, from every guide pose and its marks (in video-frame pixels): the figure drawn as
 * large as the canvas allows without the highest hand or the hair leaving it. Muse Image draws figures
 * filling the height on its own; target lines this close to that are ones it can hit, and they stay
 * the same for every frame.
 */
function clipLayout(guides: PoseFile, marksOf: (index: number) => Marks | null): Layout {
  let [top, bottom, left, right] = [Infinity, -Infinity, Infinity, -Infinity];
  const centers: number[] = [];
  for (const [i, frame] of guides.frames.entries()) {
    const marks = marksOf(i + 1);
    if (!marks) continue;
    const xs = frame.keypoints.flatMap(([x]) => (x === null ? [] : [x]));
    const ys = frame.keypoints.flatMap(([, y]) => (y === null ? [] : [y]));
    top = Math.min(top, marks.head, ...ys);
    bottom = Math.max(bottom, marks.feet);
    left = Math.min(left, ...xs);
    right = Math.max(right, ...xs);
    centers.push(marks.center);
  }
  if (!centers.length) throw new Error("no guide pose with a face, ankles and hips: cannot lay out the clip");
  const scale = Math.min((LAYOUT_BOTTOM - LAYOUT_TOP) / (bottom - top), (CANVAS.width * 0.92) / Math.max(1, right - left));
  const center = centers.reduce((sum, value) => sum + value, 0) / centers.length;
  return { scale, x: CANVAS.width / 2 - center * scale, y: LAYOUT_TOP - top * scale };
}

const at = (p: Pose, i: number) => (p.keypoints[i]?.[0] == null || (p.scores[i] ?? 0) < 0.3 ? null : p.keypoints[i] as [number, number]);

const SIZE_BONES = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [11, 13], [13, 15], [12, 14], [14, 16], [5, 11], [6, 12]] as const;

/**
 * How large the figure is drawn, relative to the character sheet. Bones only
 * shorten when they turn toward the camera, so the upper quartile of the
 * per-bone ratios stays steady whatever the pose.
 */
function drawnSize(p: Pose, reference: Pose): number | null {
  const ratios = SIZE_BONES.flatMap(([a, b]) => {
    const [pa, pb, ra, rb] = [at(p, a), at(p, b), at(reference, a), at(reference, b)];
    const ref = ra && rb ? Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) : 0;
    return pa && pb && ref > 0 ? [Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / ref] : [];
  }).sort((x, y) => x - y);
  return ratios.length >= 4 ? ratios[Math.floor(ratios.length * 0.75)] : null;
}

/**
 * Puts the drawing's measured hair top and soles exactly on the frame's grid
 * lines and its hips on the centre line: every final frame has the same size
 * by construction, whatever size Muse Image drew it at.
 */
async function register(png: Buffer, drawn: Marks | null, target: Marks): Promise<{ png: Buffer; note: string; transform: Layout }> {
  if (!drawn || drawn.feet <= drawn.head) return { png, note: "not registered (body not found)", transform: { scale: 1, x: 0, y: 0 } };
  const scale = Math.min(REGISTER_SCALE.max, Math.max(REGISTER_SCALE.min, (target.feet - target.head) / (drawn.feet - drawn.head)));
  const ox = Math.round(target.center - drawn.center * scale);
  const oy = Math.round(target.feet - drawn.feet * scale);
  return { png: await place(png, scale, ox, oy, { r: 0, g: 0, b: 0, alpha: 0 }), note: `moved ${ox}, ${oy} px, scaled ${scale.toFixed(2)}`, transform: { scale, x: ox, y: oy } };
}

/**
 * The drawing's own hair top, soles and hip centre, measured on its pixels before registration.
 * Hair top: from the nose straight up each column of the head until the figure ends (a raised
 * hand beside the head is a different column; the median ignores one that touches the hair).
 * Soles: the lowest opaque row. A hand resting on or over the head joins the hair in every
 * column: when one is there and the scan lands well above where the sheet puts the hair top
 * for a figure this size, the sheet's hair top is used instead.
 */
async function drawnMarks(keyed: Buffer, drawn: Pose, reference: Pose, sheet: ReturnType<typeof proportions>): Promise<Marks | null> {
  const [nose, ls, rs, lh, rh] = [at(drawn, 0), at(drawn, 5), at(drawn, 6), at(drawn, 11), at(drawn, 12)];
  if (!nose || !ls || !rs || !lh || !rh) return null;
  const { data, info } = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const solid = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] >= 128;

  let soles = -1;
  for (let y = info.height - 1; y >= 0 && soles < 0; y--) {
    for (let x = 0; x < info.width; x++) if (solid(x, y)) { soles = y; break; }
  }
  if (soles < 0) return null;
  let head = hairTop(solid, info.width, info.height, nose, Math.abs(ls[0] - rs[0]));
  const size = drawnSize(drawn, reference);
  // A hand resting on the side of the head counts too: anywhere above the nose within the shoulders' span and a bit.
  const reach = Math.abs(ls[0] - rs[0]) * 1.25;
  const handOverHead = [9, 10, ...Array.from({ length: 42 }, (_, i) => 91 + i)].some((i) => {
    const p = at(drawn, i);
    return p !== null && p[1] < nose[1] && Math.abs(p[0] - nose[0]) < reach;
  });
  let headHidden = false;
  if (size && handOverHead) {
    const expected = nose[1] - sheet.headAboveNose * size;
    // A hand resting on the crown hides it: any height above the expected one is the hand, however thin.
    if (head < expected) { head = expected; headHidden = true; }
  }
  return { head, feet: soles, center: (lh[0] + rh[0]) / 2, ...(headHidden ? { headHidden } : {}) };
}

export type InitInput = {
  readonly video: string;
  readonly character: string;
  readonly fps: number;
  readonly start: number;
  /** null: to the end of the video. */
  readonly seconds: number | null;
  readonly maxAttempts: number;
  readonly ownerId?: string;
  readonly name?: string;
  /** The character's height and weight: its description states them. */
  readonly measures?: CharacterMeasures | null;
  /** Draw the character in other poses (drawPoseSheet) once it is described. */
  readonly poseSheet?: boolean;
  /**
   * A kit prepared for this very sheet (prepareKit): its files are copied in instead of made again. `body`: it was
   * prepared with the run's height and weight, so its description and pose sheet are used too.
   */
  readonly kit?: { readonly dir: string; readonly body: boolean } | null;
};

/** A character image as runs and kits keep it: decoded and on white, since figureBox measures it on a light background. */
export async function characterSheet(bytes: Buffer): Promise<Buffer> {
  const decoded = await decodeImage(bytes, { minDimension: 256 });
  return sharp(decoded.flat).flatten({ background: "#ffffff" }).png().toBuffer();
}

/** What a character sheet alone decides: made once in a kit (prepareKit) and copied into each run drawn from it. */
export const KIT_FILES = ["character-pose.json", "character.txt", "pose-sheet.png", "palette.json", "palette.png", "build.json", "style.txt"] as const;
/** The kit files that state the character's height and weight. */
const KIT_BODY_FILES: readonly string[] = ["character.txt", "pose-sheet.png"];

/**
 * A character's kit in `dir`: DWPose on the sheet, Muse Spark's description, the pose sheet (one Muse Image drawing),
 * the named palette and the body measured on the grid, the same files a run makes for itself. `character` is the
 * sheet as characterSheet keeps it.
 */
export async function prepareKit(dir: string, character: Buffer, measures: Pick<CharacterMeasures, "heightCm" | "weightKg"> | null, log: (line: string) => void = () => undefined, signal?: AbortSignal): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "character.png"), character);
  const body = measuresText(measures);
  log("DWPose on the character, Muse Spark describing it…");
  const [, description] = await Promise.all([
    pose(["detect", "--image", path.join(dir, "character.png"), "--out", path.join(dir, "character-pose.json")]),
    describeCharacter(character, body).then(async (text) => { await writeFile(path.join(dir, "character.txt"), `${text}\n`); return text; }),
  ]);
  signal?.throwIfAborted();
  await Promise.all([runPoseSheet(dir, character, description, body, log, signal), finishKit(dir, log, signal)]);
}

/**
 * The palette and the body measured on the grid in a folder that has the sheet and its pose (a kit, or a prepared
 * run, whose first generate then reads them back); what is already there is kept.
 */
export async function finishKit(dir: string, log: (line: string) => void = () => undefined, signal?: AbortSignal): Promise<void> {
  const character = await readFile(path.join(dir, "character.png"));
  const reference = (JSON.parse(await readFile(path.join(dir, "character-pose.json"), "utf8")) as PoseFile).frames[0];
  if (!reference) throw new Error("DWPose found no body on the character");
  // The sheet's proportions by the rule a new run's layout uses (layoutRun).
  const box = await figureBox(character);
  const column = await sheetHairTop(character, reference);
  const sheet = proportions(reference, column !== null ? { ...box, top: column } : box);
  await Promise.all([runPalette(dir, character, log), runBuild(dir, character, reference, sheet, log, signal), runStyle(dir, character, log, signal)]);
}

/** Copies a kit's files into a run; the ones that state a body only with `body`, the pose sheet only when wanted. Returns what it copied. */
async function copyKit(kit: string, dir: string, options: { readonly body: boolean; readonly poseSheet: boolean }): Promise<Set<string>> {
  const copied = new Set<string>();
  for (const name of KIT_FILES) {
    if (!options.body && KIT_BODY_FILES.includes(name)) continue;
    if (!options.poseSheet && name === POSE_SHEET) continue;
    if (!existsSync(path.join(kit, name))) continue;
    await cp(path.join(kit, name), path.join(dir, name));
    copied.add(name);
  }
  return copied;
}

/** Frames, poses, guides and the character description: everything generate needs, no drawing yet. */
export async function initRun(dir: string, input: InitInput, log: (line: string) => void = () => undefined): Promise<Manifest> {
  const { video, character, fps, start, seconds } = input;
  if (existsSync(path.join(dir, "manifest.json"))) throw new Error(`run already exists: ${dir}`);
  await mkdir(dir, { recursive: true });
  const crop = await detectCrop(video, start, seconds ?? 5);
  const count = await extractFrames({ video, out: path.join(dir, "source"), fps, start, seconds: seconds ?? undefined, crop });
  if (count === 0) throw new Error("no frames in that part of the video");
  log(`extracted ${count} frames at ${fps} fps${crop ? `, cropped to ${crop.width}×${crop.height}+${crop.x}+${crop.y}` : ""}`);
  const characterFile = await copyInto(dir, character, "character.png");
  if (input.measures) await writeFile(path.join(dir, MEASURES_FILE), `${JSON.stringify(input.measures, null, 2)}\n`);
  // Only a kit of this very sheet: its pose and measurements are of these pixels.
  const kit = input.kit && sha256(await readFile(path.join(input.kit.dir, "character.png")).catch(() => Buffer.alloc(0))) === characterFile.sha256 ? input.kit : null;
  const kept = kit ? await copyKit(kit.dir, dir, { body: kit.body, poseSheet: Boolean(input.poseSheet) }) : new Set<string>();
  if (kept.size) log(`from My characters: ${[...kept].join(", ")}${kit?.body ? "" : " (the description and pose sheet are made again for this run's height and weight)"}`);
  // The prompt memory of the kit's character: this run reads it and adds to it (prompt-memory.ts).
  if (kit) await noteKitOrigin(dir, kit.dir);
  log(kept.has("character-pose.json") ? "DWPose on the source frames…" : "DWPose on the source frames and the character, Muse Spark describing the character…");
  // Independent work at once: both DWPose passes (local CPU) and the character description (remote).
  await Promise.all([
    Promise.all([
      pose(["detect", "--images", path.join(dir, "source"), "--out", path.join(dir, "source-poses.json")]),
      kept.has("character-pose.json") ? null : pose(["detect", "--image", path.join(dir, "character.png"), "--out", path.join(dir, "character-pose.json")]),
    ]).then(() => drawGuides(dir)),
    readFile(path.join(dir, "character.png")).then(async (png) => {
      const text = kept.has("character.txt") ? (await readFile(path.join(dir, "character.txt"), "utf8")).trim() : await describeCharacter(png, measuresText(input.measures ?? null));
      if (!kept.has("character.txt")) await writeFile(path.join(dir, "character.txt"), `${text}\n`);
      // The model sheet is drawn from the description just written (or read back from the kit); without it the run still draws.
      if (input.poseSheet) await runPoseSheet(dir, png, text, measuresText(input.measures ?? null), log);
    }),
  ]);
  const names = (await readdir(path.join(dir, "source"))).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort();
  const manifest: Manifest = {
    version: 1, createdAt: new Date().toISOString(), ...(input.ownerId ? { ownerId: input.ownerId } : {}), ...(input.name ? { name: input.name } : {}),
    video: path.resolve(video), fps, start, seconds, crop,
    character: characterFile, maxAttempts: input.maxAttempts,
    frames: names.map((name, i) => ({ index: i + 1, source: `source/${name}`, status: "pending", attempts: [] })),
  };
  await writeManifest(dir, manifest);
  log(`run ready: ${names.length} frames`);
  return manifest;
}

/**
 * The next `seconds` of the video after the run's last frame, added as open frames: cut at the
 * same rate and crop, DWPose on the new frames only, and the pose guides redrawn over the whole
 * clip. Approved frames, their poses and the clip layout stay as they are. The manifest is
 * written last, so an interrupted extension leaves the run as it was. Returns how many frames
 * were added (0 when the video has no more frames).
 */
export async function extendRun(dir: string, seconds: number, duration: number, log: (line: string) => void = () => undefined): Promise<number> {
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    const count = manifest.frames.length;
    // The new frames carry on the same cadence: frame n+1 is n frame lengths after the start.
    const start = manifest.start + count / manifest.fps;
    const length = Math.min(seconds, duration - start);
    if (length < 0.5 / manifest.fps) return 0;
    const next = path.join(dir, "source-next");
    await rm(next, { recursive: true, force: true });
    const added = await extractFrames({ video: manifest.video, out: next, fps: manifest.fps, start, seconds: length, crop: manifest.crop });
    if (added === 0) return 0;
    log(`extracted ${added} more frames from ${start.toFixed(2)} s`);
    log("DWPose on the new frames…");
    await pose(["detect", "--images", next, "--out", path.join(next, "poses.json")]);
    const fresh = JSON.parse(await readFile(path.join(next, "poses.json"), "utf8")) as PoseFile;
    const names = Array.from({ length: added }, (_, i) => frameName(count + i + 1));
    for (const [i, name] of names.entries()) await rename(path.join(next, frameName(i + 1)), path.join(dir, "source", name));
    // Poses past the manifest's frames are leftovers of an interrupted extension.
    const poses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
    const files = poses.files ?? manifest.frames.map((frame) => path.basename(frame.source));
    await writeFile(path.join(dir, "source-poses.json"), JSON.stringify({ ...poses, files: [...files.slice(0, count), ...names], frames: [...poses.frames.slice(0, count), ...fresh.frames] }));
    log("redrawing the pose guides…");
    await drawGuides(dir);
    await rm(next, { recursive: true, force: true });
    manifest.frames.push(...names.map((name, i) => ({ index: count + i + 1, source: `source/${name}`, status: "pending" as const, attempts: [] })));
    await writeManifest(dir, { ...manifest, seconds: start + length - manifest.start, halted: null });
    log(`run extended: ${count + added} frames`);
    return added;
  } finally {
    await release();
  }
}

/** The pose guides: every source pose on the character's proportions (rotoscope_pose.py guides). */
async function drawGuides(dir: string): Promise<void> {
  // The sheet's hair top sizes the guide's skull: the head the generator sees is the character's own.
  const { top } = await figureBox(await readFile(path.join(dir, "character.png")));
  await pose(["guides", "--source", path.join(dir, "source-poses.json"), "--character", path.join(dir, "character-pose.json"), "--out", path.join(dir, "guides"), "--head-top", String(top)]);
}

/**
 * Redraws a run's pose guides with the current guide code; the old ones are
 * kept in guides-<time>/. Approved frames and the clip layout stay as they
 * are, so only frames drawn from now on use the new guides.
 */
export async function reguideRun(dir: string): Promise<string> {
  const kept = `guides-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await rename(path.join(dir, "guides"), path.join(dir, kept));
  try {
    await drawGuides(dir);
  } catch (error) {
    await rm(path.join(dir, "guides"), { recursive: true, force: true });
    await rename(path.join(dir, kept), path.join(dir, "guides"));
    throw error;
  }
  return kept;
}

/** A run's layout follows the person's own figure (layoutRun): runs laid out before keep their old target lines until refitted. */
export async function fitsPerson(dir: string): Promise<boolean> {
  const kept = await readFile(path.join(dir, "layout.json"), "utf8").then((text) => JSON.parse(text) as KeptLayout, () => null);
  return !kept || kept.size === "person";
}

type Similarity = { readonly scale: number; readonly x: number; readonly y: number };
const moved = (p: readonly number[], t: Similarity) => [Math.round((p[0] * t.scale + t.x) * 10) / 10, Math.round((p[1] * t.scale + t.y) * 10) / 10, ...p.slice(2)];

/**
 * Lays a run out again by the current rule (the character over the video person's own figure, times the heights'
 * ratio of measures.json) and moves everything already drawn onto it, with no model call: each frame's attempts,
 * its approved drawing, the joints its diagnostics and corrections hold. A drawing was registered with its hair top
 * and soles on its frame's old lines, so one similarity per frame puts it on the new ones exactly. The old layout,
 * attempts and frames are kept in *-<time>/ beside them. Returns how many frames were moved.
 */
export async function refitRun(dir: string, log: (line: string) => void = () => undefined): Promise<number> {
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    const before = await layoutRun(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(path.join(dir, "layout.json"), path.join(dir, `layout-${stamp}.json`));
    let after: Awaited<ReturnType<typeof layoutRun>>;
    try {
      after = await layoutRun(dir);
    } catch (error) {
      await rename(path.join(dir, `layout-${stamp}.json`), path.join(dir, "layout.json"));
      throw error;
    }
    log(`laid out on the video person's figure (hair top by ${after.person?.method ?? "the guide"}, height ratio ${after.ratio.toFixed(3)}); canvas scale ${before.fit.scale.toFixed(3)} → ${after.fit.scale.toFixed(3)}`);
    for (const folder of ["attempts", "frames"]) {
      if (existsSync(path.join(dir, folder))) await cp(path.join(dir, folder), path.join(dir, `${folder}-${stamp}`), { recursive: true });
    }
    const overrides = await readOverrides(dir);
    const corrected: Record<string, { joints: Partial<Record<string, readonly [number, number]>> }> = {};
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
    let count = 0;
    for (const frame of manifest.frames) {
      const joints = overrides.frames?.[String(frame.index)]?.joints;
      if (!frame.attempts.length && !joints) continue;
      const [from, to] = [before.marksOf(frame.index), after.marksOf(frame.index)];
      const scale = (to.feet - to.head) / Math.max(1, from.feet - from.head);
      const t: Similarity = { scale, x: to.center - from.center * scale, y: to.feet - from.feet * scale };
      const shift = <T extends Record<string, readonly number[]>>(map: T) => Object.fromEntries(Object.entries(map).map(([name, p]) => [name, moved(p, t)])) as unknown as T;
      for (const attempt of frame.attempts) {
        const file = path.join(dir, attempt.file);
        if (existsSync(file)) await writeFile(file, await place(await readFile(file), t.scale, t.x, t.y, transparent));
        const record = await readDiagnostics(dir, frame.index, attempt.attempt);
        if (record) await writeDiagnostics(dir, { ...record, target: { ...record.target, joints: shift(record.target.joints) }, generated: record.generated ? { ...record.generated, joints: shift(record.generated.joints) } : null });
      }
      if (frame.approved) {
        const file = path.join(dir, frame.approved.file);
        const png = await place(await readFile(file), t.scale, t.x, t.y, transparent);
        await writeFile(file, png);
        frame.approved = { ...frame.approved, sha256: sha256(png) };
      }
      if (joints) corrected[String(frame.index)] = { joints: Object.fromEntries(Object.entries(joints).map(([name, p]) => [name, moved(p!, t).slice(0, 2) as [number, number]])) };
      count++;
    }
    if (overrides.frames) await writeOverrides(dir, { ...overrides, frames: corrected } as Overrides);
    await writeManifest(dir, manifest);
    // The sheet over the video at the new scale: the next drawing's Image 2.
    await after.characterAtVideoScale();
    return count;
  } finally {
    await release();
  }
}

/** Where the character sheet goes over the video: sheet pixels to video pixels, and the person's median soles and hips. */
type SheetPlacement = { readonly scale: number; readonly soles: number; readonly hips: number };

/**
 * The character sheet drawn on the canvas over the video person in sourcePlaced: at the run's character scale
 * (layoutRun), its soles on the person's soles and its hips over theirs, as the median over the clip. Muse Image
 * sees the person and the character at one scale; what doesn't fit the canvas is cut. The same for every frame of
 * the run. Written to the run folder (SCALED_CHARACTER) so the run page can show what the generator is given.
 */
async function scaleToVideo(dir: string, character: Buffer, reference: Pose, placement: SheetPlacement): Promise<{ readonly png: Buffer; readonly scale: number }> {
  const first = await sharp(path.join(dir, "source", frameName(1))).metadata();
  const [w, h] = [first.width ?? CANVAS.width, first.height ?? CANVAS.height];
  const s = Math.min(CANVAS.width / w, CANVAS.height / h);
  const [ox, oy] = [(CANVAS.width - w * s) / 2, (CANVAS.height - h * s) / 2];
  const corner = await sharp(path.join(dir, "source", frameName(1))).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const background = `rgb(${corner[0]},${corner[1]},${corner[2]})`;
  const [lh, rh] = [at(reference, 11), at(reference, 12)];
  if (!lh || !rh) return { png: await fitCanvas(character, background), scale: 1 };
  const { bottom } = await figureBox(character);
  const scale = placement.scale * s;
  const left = placement.hips * s + ox - ((lh[0] + rh[0]) / 2) * scale;
  const top = placement.soles * s + oy - bottom * scale;
  return { png: await onColour(await place(character, scale, left, top, background), background), scale };
}

/** The scaled sheet of a prepared run, before anything is drawn: guides and layout are not touched. */
export async function scaledCharacter(dir: string): Promise<Buffer> {
  const { characterAtVideoScale } = await layoutRun(dir, { keep: false });
  return (await characterAtVideoScale()).png;
}

/** The run's measures (measures.json): the character's height and weight, and the video person's height. */
export async function readMeasures(dir: string): Promise<CharacterMeasures | null> {
  return readFile(path.join(dir, MEASURES_FILE), "utf8").then((text) => CharacterMeasuresSchema.parse(JSON.parse(text)), () => null);
}

/** How a run's layout was fixed (layout.json): the transform, and the rule its target lines follow. */
type KeptLayout = Layout & {
  readonly hairTop?: "column";
  /** "person": the character spans the video person's own hair top to soles (stature.ts). Absent: the guide's skeleton with the sheet's head and feet. */
  readonly size?: "person";
  readonly person?: PersonFigure;
  /** The character's height over the person's when the layout was fixed. */
  readonly ratio?: number;
};

/** The video person's hair top, measured on up to this many frames' silhouettes. */
const FIGURE_SAMPLES = 24;

async function measurePerson(dir: string, clip: readonly Pose[], reference: Pose, sheet: ReturnType<typeof proportions>): Promise<PersonFigure> {
  const step = Math.max(1, clip.length / FIGURE_SAMPLES);
  const picks = [...new Set(Array.from({ length: Math.min(clip.length, FIGURE_SAMPLES) }, (_, i) => Math.floor(i * step)))];
  const samples = await Promise.all(picks.map(async (i) => ({ frame: await toRgba(await readFile(path.join(dir, "source", frameName(i + 1)))), pose: clip[i] })));
  return personFigure({ samples, poses: clip, reference, sheet });
}

/**
 * Everything a frame's drawing is placed by: the clip layout, the grid's target lines and the gridded pose images.
 * The layout is fixed on the first generate (layout.json); `keep: false` works it out without writing it.
 */
export async function layoutRun(dir: string, options: { readonly keep?: boolean } = {}) {
  const guides = JSON.parse(await readFile(path.join(dir, "guides/guides.json"), "utf8")) as PoseFile;
  const character = await readFile(path.join(dir, "character.png"));
  const reference = (JSON.parse(await readFile(path.join(dir, "character-pose.json"), "utf8")) as PoseFile).frames[0];
  const clip = (JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile).frames;
  // Fixed on the first generate: a resume must place new frames exactly like the approved ones.
  const layoutFile = path.join(dir, "layout.json");
  const kept = existsSync(layoutFile) ? JSON.parse(await readFile(layoutFile, "utf8")) as KeptLayout : null;
  // The sheet's hair top by the rule drawings are measured with (grid.ts hairTop). A run laid out before
  // that rule keeps the sheet's topmost pixel, so its later frames are placed like its approved ones.
  const box = await figureBox(character);
  const column = !kept || kept.hairTop === "column" ? await sheetHairTop(character, reference) : null;
  const sheet = proportions(reference, column !== null ? { ...box, top: column } : box);
  // The character over the video person's own figure, times the heights' ratio. A run laid out before that rule
  // keeps its target lines (the guide's skeleton with the sheet's head and feet), so its frames stay one size.
  const byPerson = !kept || kept.size === "person";
  const person = byPerson ? kept?.person ?? await measurePerson(dir, clip, reference, sheet) : null;
  const ratio = byPerson ? kept?.ratio ?? heightRatio(await readMeasures(dir)) : 1;
  /** A frame's hair top, soles and hips under `transform`: the person's when it can be placed, else the guide's. */
  const marksAt = (index: number, transform: Layout): Marks | null => {
    const guide = guides.frames[index - 1];
    const own = person ? personMarks(clip[index - 1] ?? guide, person, ratio) ?? personMarks(guide, person, ratio) : null;
    if (!own) return targets(guide, drawnSize(guide, reference) ?? 1, sheet, transform);
    return { head: own.head * transform.scale + transform.y, feet: own.feet * transform.scale + transform.y, center: own.center * transform.scale + transform.x };
  };
  const fit: Layout = kept ?? clipLayout(guides, (index) => marksAt(index, IDENTITY));
  if (!kept && options.keep !== false) {
    await writeFile(layoutFile, `${JSON.stringify({ ...fit, ...(column !== null ? { hairTop: "column" } : {}), size: "person", ...(person ? { person } : {}), ratio } satisfies KeptLayout)}\n`);
  }
  // The character's scale, sheet pixels to video pixels: its figure as tall as the clip's most upright frame.
  const frames = guides.frames.flatMap((_, i) => marksAt(i + 1, IDENTITY) ?? []);
  const median = (values: number[]) => values.sort((x, y) => x - y)[Math.floor(values.length / 2)];
  const spans = frames.map((marks) => marks.feet - marks.head).sort((x, y) => x - y);
  const placement: SheetPlacement = {
    scale: spans.length ? spans[Math.min(spans.length - 1, Math.floor(spans.length * 0.9))] / sheet.figureHeight : 1,
    soles: median(frames.map((marks) => marks.feet)),
    hips: median(frames.map((marks) => marks.center)),
  };
  // How long each guide bone is at its most extended, never shorter than the character's own limb:
  // shorter means the camera sees it foreshortened.
  const onFit = guides.frames.map((frame) => onCanvas(frame, fit));
  const full = fullLengths(onFit, sheetLengths(reference, onFit));
  // Sheet limbs seen foreshortened (hands clasped in front): their full length estimated from the clip's own limb ratio.
  const estimates = sheetEstimates(reference, clip, onFit);
  const marksOf = (index: number): Marks => {
    const marks = marksAt(index, fit);
    if (!marks) throw new Error(`frame ${index}: the pose guide has no face, ankles or hips to place the grid lines`);
    return marks;
  };
  const poseImages = async (index: number) => {
    const guide = guides.frames[index - 1];
    const size = drawnSize(guide, reference) ?? 1;
    const marks = marksOf(index);
    const placeOnCanvas = async (png: Buffer) => onColour(await place(png, fit.scale, fit.x, fit.y, "#ffffff"), "#ffffff");
    return {
      marks,
      // Every joint and limb length in grid cells, at this frame's size of the character.
      spec: bodySpec(onCanvas(guide, fit), marks, sheet.headHeight * size * fit.scale, full, estimates),
      guide: await withGrid(await placeOnCanvas(await readFile(path.join(dir, "guides", frameName(index)))), marks),
      sourceGrey: await withGrid(await placeOnCanvas(await sharp(path.join(dir, "source", frameName(index))).greyscale().png().toBuffer())),
    };
  };
  /** The video frame in colour, placed and gridded like the generator's references: what the reading names cells on. */
  const sourceOnGrid = async (index: number) => withGrid(await onColour(await place(await readFile(path.join(dir, "source", frameName(index))), fit.scale, fit.x, fit.y, "#ffffff"), "#ffffff"));
  /**
   * The video frame in colour, whole on the canvas without grid or marks: what an edit starts from. Letterboxed, not
   * placed at the drawing's size: the lab drew the right side of the body far more often from the whole frame than from
   * the enlarged crop the guides use, and register() puts the drawing on its marks afterwards.
   */
  const sourcePlaced = async (index: number) => {
    const frame = await readFile(path.join(dir, "source", frameName(index)));
    const corner = await sharp(frame).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    return fitCanvas(frame, `rgb(${corner[0]},${corner[1]},${corner[2]})`);
  };
  let atVideoScale: Promise<{ readonly png: Buffer; readonly scale: number }> | null = null;
  /**
   * The video frame in colour at the drawing's own placement (the guides' layout), no grid: every drawing is registered
   * onto its marks, which stand on the person's own figure, so this is what it is ghosted over.
   */
  const sourceFitted = async (index: number) => {
    const frame = await readFile(path.join(dir, "source", frameName(index)));
    const corner = await sharp(frame).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const background = `rgb(${corner[0]},${corner[1]},${corner[2]})`;
    return onColour(await place(frame, fit.scale, fit.x, fit.y, background), background);
  };
  const characterAtVideoScale = () => atVideoScale ??= scaleToVideo(dir, character, reference, placement).then(async (scaled) => {
    await writeFile(path.join(dir, SCALED_CHARACTER), scaled.png);
    return scaled;
  });
  /**
   * The character sheet standing on a frame's soles line, hips on its centre line, at the scale the drawings are
   * placed at on the canvas: beside a drawing it shows height and build at one scale (the Build review picture).
   */
  const sheetOnCanvas = async (index: number) => {
    const marks = marksOf(index);
    const [lh, rh] = [at(reference, 11), at(reference, 12)];
    const scale = placement.scale * fit.scale;
    const hip = lh && rh ? (lh[0] + rh[0]) / 2 : box.bottom / 2;
    return place(character, scale, marks.center - hip * scale, marks.feet - box.bottom * scale, { r: 0, g: 0, b: 0, alpha: 0 });
  };
  return { guides, character, reference, sheet, fit, person, ratio, marksOf, poseImages, sourceOnGrid, sourcePlaced, sourceFitted, characterAtVideoScale, sheetOnCanvas };
}

/**
 * What Muse Image gets for a frame's next drawing, built as generateRun builds it but with no model call: the kept
 * pose note (none when the frame was never drawn), the identity line, the measures and the pose sheet when kept.
 */
async function nextSwap(dir: string, index: number) {
  const { character, characterAtVideoScale, sourcePlaced } = await layoutRun(dir);
  const note = await readFile(path.join(dir, "notes", `frame_${String(index).padStart(4, "0")}.txt`), "utf8").then((text) => text.trim(), () => "");
  return swapFramePrompt({
    frame: await sourcePlaced(index), character: (await characterAtVideoScale()).png, characterSheet: character,
    description: (await readFile(path.join(dir, "character.txt"), "utf8")).trim(), style: (await readFile(path.join(dir, STYLE_FILE), "utf8").catch(() => "")).trim() || null, note, correction: null, feedback: [],
    body: measuresText(await readMeasures(dir)), poseSheet: await readFile(path.join(dir, POSE_SHEET)).catch(() => null),
  });
}

/** The prompt file an attempt kept (work/frame_NNNN_aK_prompt.txt): the images' roles, a blank line, the prompt. */
const promptFile = (dir: string, index: number, attempt: number) => path.join(dir, "work", `${frameName(index).replace(".png", "")}_a${attempt}_prompt.txt`);

/**
 * A frame's Muse Image prompt: the exact words an attempt was drawn with when it kept them (`sent`), else the
 * prompt its next drawing would get. The images' roles come with it, in order.
 */
export async function framePromptOf(dir: string, index: number, attempt: number | null): Promise<{ readonly prompt: string; readonly images: readonly string[]; readonly sent: boolean }> {
  const kept = attempt ? await readFile(promptFile(dir, index, attempt), "utf8").catch(() => null) : null;
  if (kept) {
    const split = kept.indexOf("\n\n");
    const head = split < 0 ? "" : kept.slice(0, split);
    return { prompt: (split < 0 ? kept : kept.slice(split + 2)).trim(), images: head.split("\n").map((line) => line.replace(/^Image \d+: /, "")).filter(Boolean), sent: true };
  }
  const swap = await nextSwap(dir, index);
  return { prompt: swap.prompt, images: swap.references.map((reference) => reference.role), sent: false };
}

/**
 * Muse Spark on a prompt under test (draw.ts analyzePrompt): the frame's images as its next drawing gets them, the
 * attempt's drawing and checks when one is given, and the prompt as a person edited it. No drawing is made.
 */
export async function analyzeFramePrompt(dir: string, index: number, attempt: number | null, prompt: string, signal?: AbortSignal): Promise<PromptAnalysis> {
  const swap = await nextSwap(dir, index);
  const record = attempt ? (await readManifest(dir)).frames.find((frame) => frame.index === index)?.attempts.find((entry) => entry.attempt === attempt) : undefined;
  const drawing = record ? await readFile(path.join(dir, record.file)).then((png) => onColour(png, "#d8d8d8"), () => null) : null;
  return analyzePrompt({
    prompt,
    references: swap.references,
    drawing,
    checks: record?.checks.map((check) => `${check.name}: ${check.passed ? "ok" : "FAILED"} — ${check.detail}`) ?? [],
    signal,
  });
}

/** Writes what the generator would see for each frame, without calling any model. */
export async function previewRun(dir: string, log: (line: string) => void = () => undefined): Promise<void> {
  const { guides, fit, poseImages } = await layoutRun(dir);
  const out = path.join(dir, "preview");
  await mkdir(out, { recursive: true });
  for (let index = 1; index <= guides.frames.length; index++) {
    const { guide, sourceGrey, marks, spec } = await poseImages(index);
    await sharp({ create: { width: CANVAS.width * 2 + 16, height: CANVAS.height, channels: 3, background: "#ffffff" } })
      .composite([{ input: guide, left: 0, top: 0 }, { input: sourceGrey, left: CANVAS.width + 16, top: 0 }])
      .png().toFile(path.join(out, frameName(index)));
    await writeFile(path.join(out, frameName(index).replace(".png", ".txt")), `${spec?.text ?? "no body map (torso not found)"}\n`);
    log(`frame ${index}: hair line ${toLine(marks.head)}, soles line ${toLine(marks.feet)}`);
  }
  log(`layout scale ${fit.scale.toFixed(3)}; images in ${out}`);
}

/** Where a frame's reading (describeFrame) is kept, relative to the run folder. */
export const readingFile = (index: number) => `readings/${frameName(index).replace(".png", ".txt")}`;

/**
 * Bumped when how frames are read changes (draw.ts READING_PARTS): readings kept under an older revision
 * are read again, so an instruction that was wrong (the video's flat shoes, its stockings read as shading)
 * doesn't keep reaching the generator. The revision is kept in readings/REVISION.
 */
export const READING_REVISION = 2;
export async function keptReading(dir: string, index: number): Promise<string | null> {
  const revision = Number(await readFile(path.join(dir, "readings", "REVISION"), "utf8").catch(() => "1"));
  if (revision !== READING_REVISION) return null;
  const kept = await readFile(path.join(dir, readingFile(index)), "utf8").catch(() => null);
  return kept !== null && isFrameSpec(kept) ? kept.trim() : null;
}

/** Draws and validates every open frame in order, behind the firewall (run-state.ts). */
export type LiveStage = "drawing" | "measuring" | "checking" | "reviewing" | "approved" | "rejected";
export type LiveEvent = { readonly frame: number; readonly attempt: number; readonly tries: number; readonly stage: LiveStage };

export type Generator = "muse" | "higgsfield" | "rig";
const GENERATOR_NAME: Record<Generator, string> = { muse: "Muse Image", higgsfield: "Higgsfield", rig: "Character rig" };

/**
 * How frames are drawn. "auto": each frame's first try deforms an approved drawing of the
 * character onto the source pose (the Character Mapping Engine, local and deterministic),
 * and the other tries use the generators. "rig": every try deforms (from the next-best
 * drawing). "muse": generators only, as before the mapping engine.
 */
export type Renderer = "auto" | "rig" | "muse";

/** Where a run keeps its colour palette (colour.ts), as data and as named swatches people can look at. */
export const PALETTE_FILE = "palette.json";
export const PALETTE_IMAGE = "palette.png";
/** The character sheet drawn as tall as the video person (characterAtVideoScale), in the run folder. */
export const SCALED_CHARACTER = "character-scaled.png";
/** The character's height and weight and the video person's height, given when the run was made (readMeasures). */
export const MEASURES_FILE = "measures.json";
/** The character in other poses (draw.ts drawPoseSheet), drawn once per run. */
export const POSE_SHEET = "pose-sheet.png";

/** The run's pose sheet: read back when kept, else drawn once (one Muse Image drawing); null when it can't be drawn. */
async function runPoseSheet(dir: string, character: Buffer, description: string, body: string | null, log: (line: string) => void, signal?: AbortSignal): Promise<Buffer | null> {
  const file = path.join(dir, POSE_SHEET);
  const kept = await readFile(file).catch(() => null);
  if (kept) return kept;
  if (readMetaConfig() === null) return null;
  try {
    log("drawing the character in four other poses (one Muse Image drawing)…");
    const png = await drawPoseSheet({ character, description, body, signal });
    await writeFile(file, png);
    log("pose sheet drawn: every drawing and review sees how the character's joints bend");
    return png;
  } catch (error) {
    signal?.throwIfAborted();
    log(`  pose sheet not drawn (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing without it`);
    return null;
  }
}

/** The run's palette: measured on the character sheet and named by Muse Spark once, then read back. */
async function runPalette(dir: string, character: Buffer, log: (line: string) => void, options: { readonly offline?: boolean } = {}): Promise<Palette> {
  const file = path.join(dir, PALETTE_FILE);
  const kept = existsSync(file) && existsSync(path.join(dir, PALETTE_IMAGE)) ? JSON.parse(await readFile(file, "utf8")) as Palette : null;
  if (kept?.version === PALETTE_VERSION) return kept;
  const colours = await sheetColours(character);
  if (options.offline) return profiledPalette(character, { version: PALETTE_VERSION, colours: colours.map((colour) => ({ ...colour, name: `colour ${colour.hex}` })) });
  // Without names the palette still holds the colours; the names only help the generator and people.
  const names = await namePalette(character, colours).catch((error: unknown) => {
    log(`  palette names unavailable: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    return colours.map((colour) => `colour ${colour.hex}`);
  });
  const palette = await profiledPalette(character, { version: PALETTE_VERSION, colours: colours.map((colour, i) => ({ ...colour, name: names[i] })) });
  await writeFile(file, `${JSON.stringify(palette, null, 2)}\n`);
  await writeFile(path.join(dir, PALETTE_IMAGE), await paletteImage(palette));
  log(`palette: ${paletteText(palette)}`);
  return palette;
}

/**
 * The run's identity line (character.txt): what Muse Image is told to keep, written from the character sheet.
 * A run prepared before it was written in that form (a short design paragraph that called a full figure
 * "slender" and left details out) has it written again once, the old text kept as character.previous.txt.
 */
/**
 * Muse Spark's measurements of the character's body on the grid (draw.ts profileCharacter), made once before
 * anything is drawn and kept in build.json; null without a key or when the measurements don't read.
 */
async function runBuild(dir: string, character: Buffer, reference: Pose, sheet: ReturnType<typeof proportions>, log: (line: string) => void, signal?: AbortSignal): Promise<BuildProfile | null> {
  const file = path.join(dir, "build.json");
  const kept = await readFile(file, "utf8").then((text) => JSON.parse(text) as BuildProfile, () => null);
  if (kept && validBuild(kept)) return kept;
  if (readMetaConfig() === null) return null;
  try {
    const spark = await profileCharacter(await withGrid(await fitCanvas(character, "#ffffff")), signal);
    // The landmarks as DWPose and the silhouette measured them on the sheet, in grid lines of the same fitted canvas.
    const { width = CANVAS.width, height = CANVAS.height } = await sharp(character).metadata();
    const [scale, offset] = [Math.min(CANVAS.width / width, CANVAS.height / height), (CANVAS.height - height * Math.min(CANVAS.width / width, CANVAS.height / height)) / 2];
    const line = (y: number) => Math.round(((y * scale + offset) / GRID.cell) * 100) / 100;
    const mean = (a: number, b: number) => ((at(reference, a)?.[1] ?? NaN) + (at(reference, b)?.[1] ?? NaN)) / 2;
    const top = (at(reference, 0)?.[1] ?? NaN) - sheet.headAboveNose;
    const profile = reconcileBuild(spark, { headTop: line(top), chin: line(top + sheet.headHeight), shoulders: line(mean(5, 6)), hips: line(mean(11, 12)), knees: line(mean(13, 14)), soles: line(top + sheet.figureHeight) });
    if (!validBuild(profile)) throw new Error("the measured landmarks don't run top to bottom");
    await writeFile(file, `${JSON.stringify(profile, null, 2)}\n`);
    log(`character build measured on the grid: ${buildText(profile)}`);
    return profile;
  } catch (error) {
    signal?.throwIfAborted();
    log(`  character build not measured (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); the reviews go without it`);
    return null;
  }
}

async function runDescription(dir: string, character: Buffer, log: (line: string) => void): Promise<string> {
  const file = path.join(dir, "character.txt");
  const kept = (await readFile(file, "utf8")).trim();
  if (isIdentityLine(kept) || readMetaConfig() === null) return kept;
  try {
    const written = await describeCharacter(character);
    await writeFile(path.join(dir, "character.previous.txt"), `${kept}\n`);
    await writeFile(file, `${written}\n`);
    log(`character description rewritten as an identity line:\n    ${written}`);
    return written;
  } catch (error) {
    log(`  character description not rewritten (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); keeping the old one`);
    return kept;
  }
}

/** How many of the run's most frequent rejections Muse Spark is shown when it writes a frame's prompt. */
const SPARK_LESSONS = 5;

/** Where a run (or a kit) keeps the character sheet's art style sheet (draw.ts describeStyle). */
export const STYLE_FILE = "style.txt";

/** The run's art style sheet: read back when kept, else written once by Muse Spark; null without a key or when it can't be read. */
async function runStyle(dir: string, character: Buffer, log: (line: string) => void, signal?: AbortSignal): Promise<string | null> {
  const file = path.join(dir, STYLE_FILE);
  const kept = (await readFile(file, "utf8").catch(() => "")).trim();
  if (kept) return kept;
  if (readMetaConfig() === null) return null;
  try {
    const style = await describeStyle(character, signal);
    await writeFile(file, `${style}\n`);
    log(`art style sheet written:\n    ${style.split("\n").join("\n    ")}`);
    return style;
  } catch (error) {
    signal?.throwIfAborted();
    log(`  art style sheet not written (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing from the sheet alone`);
    return null;
  }
}

/** The joints match the video this closely (mean and worst bone, degrees): the reviewer's eye doesn't overrule it on the limbs. */
const CLOSE_POSE = { mean: 3, worst: 8 };
function closePose(source: Pose, drawn: Pose, clip: readonly Pose[]): boolean {
  const check = comparePoses(source, drawn, undefined, clip);
  return check.passed && (check.score ?? Infinity) <= CLOSE_POSE.mean && Math.max(0, ...check.bones.map((bone) => bone.degrees)) <= CLOSE_POSE.worst;
}

/** A repair may change a limb this much (degrees) before it is thrown away. */
const REPAIR_POSE_TOLERANCE = 8;

/** One generator's drawing of a frame, cut out, registered and measured. */
type Candidate = {
  readonly generator: Generator;
  readonly png: Buffer;
  readonly drawn: Pose;
  /** The drawn pose on the canvas, after registration. */
  readonly placed: Pose;
  /** pose, scale, proportions and background: everything measurable without a model. */
  readonly checks: readonly Check[];
  readonly note: string;
};

/** Fewer failed checks first, then the smaller pose, size and proportion errors. */
function rank(candidate: Candidate): [number, number] {
  const score = (name: string) => candidate.checks.find((check) => check.name === name)?.score ?? 0;
  return [candidate.checks.filter((check) => !check.passed).length, score("pose") / 12 + score("scale") / 0.08 + score("proportions") / 0.18];
}
const better = (a: Candidate, b: Candidate) => {
  const [x, y] = [rank(a), rank(b)];
  return x[0] !== y[0] ? x[0] < y[0] : x[1] <= y[1];
};

/**
 * Each source frame's keypoints not confirmed as seen, from the mapping's source track when the run has one
 * (occluded, bridged or off the subject: joints.ts). Without a track nothing is excluded.
 */
async function sourceHidden(dir: string, poses: PoseFile): Promise<(index: number) => ReadonlySet<number>> {
  const track = await readFile(path.join(dir, "mapping", "source-track.json"), "utf8").then((text) => JSON.parse(text) as { frames: TrackedFrame[] }, () => null);
  return (index) => {
    const flags = track?.frames[index - 1]?.flags;
    return flags ? unconfirmed(canonicalJoints(poses.frames[index - 1], { space: "frame", source: "rtmw", width: poses.width, height: poses.height, flags })) : new Set();
  };
}

/** What a drawing is measured against: the character sheet's pose, the video frame's pose and the frame's targets. */
type Scoring = {
  readonly reference: Pose;
  readonly sheet: ReturnType<typeof proportions>;
  readonly source: Pose;
  /** Every source pose of the clip: which bones move in it (pose-match.ts movingBones). */
  readonly clip: readonly Pose[];
  /** Source keypoints the track doesn't confirm as seen (joints.ts): never measured. */
  readonly hidden?: ReadonlySet<number>;
  readonly marks: Marks;
  readonly spec: BodySpec | null;
  readonly anchorDensity: number | null;
};

/**
 * Every measurable check on a cut-out drawing whose colours are already held (`colour`) and whose
 * pose was found (`drawn`): registration, pose, scale, proportions, alpha and line work. No model call.
 */
async function scoreDrawing(keyed: Buffer, drawn: Pose, colour: Check, scoring: Scoring): Promise<{ png: Buffer; placed: Pose; checks: Check[]; note: string }> {
  const { reference, sheet, source, clip, hidden, marks, spec, anchorDensity } = scoring;
  const measured = await drawnMarks(keyed, drawn, reference, sheet);
  const placed = await register(keyed, measured, marks);
  const poseCheck = comparePoses(source, drawn, undefined, clip, hidden);
  const checks: Check[] = [
    { name: poseCheck.name, passed: poseCheck.passed, detail: poseCheck.detail, ...(poseCheck.status ? { status: poseCheck.status } : {}), ...(poseCheck.feedback ? { feedback: poseCheck.feedback } : {}), ...(poseCheck.score !== undefined ? { score: poseCheck.score } : {}) },
    checkScale(measured, marks),
    colour,
    checkProportions(spec, drawn, measured, marks),
    checkAlpha(await toRgba(placed.png)),
    // Line work held to the run's first drawing: the model reviewer lets a prettier, softer render through.
    ...(anchorDensity ? [checkStyle(await toRgba(placed.png), anchorDensity)] : []),
  ];
  return { png: placed.png, placed: onCanvas(drawn, placed.transform), checks, note: placed.note };
}

/**
 * A generator's drawing of a frame (on the canvas, before any cut-out) measured exactly as generateRun
 * measures it: keyed out, colours held to the run's palette, DWPose on the cut-out (local; skipped when
 * `drawn` is given), then every measured check. No model call; files go to `work` as `<name>_*`.
 */
export async function measureDrawing(dir: string, index: number, raw: Buffer, options: { readonly work: string; readonly name: string; readonly drawn?: Pose }): Promise<{ checks: Check[]; drawn: Pose; keyed: Buffer; placed: Buffer }> {
  const sourcePoses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
  const { character, reference, sheet, poseImages } = await layoutRun(dir);
  const { marks, spec } = await poseImages(index);
  const colours = await runPalette(dir, character, () => undefined, { offline: true });
  const previous = (await readManifest(dir)).frames.find((entry) => entry.index === index - 1);
  const previousShares = previous?.approved ? paletteShares(await toRgba(await readFile(path.join(dir, previous.approved.file))), colours) : null;
  const held = holdColours(keyBackground(await toRgba(raw)).image, colours, previousShares);
  const keyed = await fromRgba(held.image);
  let drawn = options.drawn;
  if (!drawn) {
    await mkdir(options.work, { recursive: true });
    const file = path.join(options.work, `${options.name}_keyed.png`);
    await writeFile(file, keyed);
    await pose(["detect", "--image", file, "--out", file.replace(".png", "_pose.json")]);
    drawn = (JSON.parse(await readFile(file.replace(".png", "_pose.json"), "utf8")) as PoseFile).frames[0];
  }
  const scored = await scoreDrawing(keyed, drawn, held.check, { reference, sheet, source: sourcePoses.frames[index - 1], clip: sourcePoses.frames, hidden: (await sourceHidden(dir, sourcePoses))(index), marks, spec, anchorDensity: null });
  return { checks: scored.checks, drawn, keyed, placed: scored.png };
}

/**
 * A kept attempt measured again from its artifacts (work/frame_NNNN_aK_<generator>_raw.png), with
 * the current checks and no model call: the offline baseline that checker changes are compared on.
 * The pose is found again on the re-keyed drawing when `redetect` (local DWPose), else the pose kept
 * from the original run is used. The palette is read back; one measured differently since is
 * recomputed in memory and left unnamed, never named by Muse Spark here.
 */
export async function remeasureAttempt(dir: string, index: number, attempt: number, options: { readonly redetect?: boolean; readonly out?: string } = {}): Promise<{ generator: Generator; checks: Check[]; drawn: Pose }> {
  const stem = path.join(dir, "work", `${frameName(index).replace(".png", "")}_a${attempt}`);
  const generator = (["muse", "higgsfield"] as const).find((name) => existsSync(`${stem}_${name}_raw.png`));
  if (!generator) throw new Error(`frame ${index} attempt ${attempt}: no kept generator drawing in work/`);
  const kept = (JSON.parse(await readFile(`${stem}_${generator}_pose.json`, "utf8")) as PoseFile).frames[0];
  const { checks, drawn } = await measureDrawing(dir, index, await readFile(`${stem}_${generator}_raw.png`), {
    work: options.out ?? path.join(dir, "work", "remeasure"), name: `${path.basename(stem)}_${generator}`, ...(options.redetect ? {} : { drawn: kept }),
  });
  return { generator, checks, drawn };
}

export async function generateRun(dir: string, options: {
  limit?: number; only?: number; signal?: AbortSignal; log?: (line: string) => void; onLive?: (event: LiveEvent) => void; dual?: boolean; renderer?: Renderer; repair?: boolean; review?: "gated" | "always";
  /** Muse Image's prompt for this run's drawings, word for word, instead of the one written for each frame (a test from the debug panel). */
  prompt?: string;
  /** Tries per frame in this run, when fewer than the manifest's. */
  attempts?: number;
  /** Draw the character in other poses first when the run has no pose sheet yet; false leaves it out. */
  poseSheet?: boolean;
  /** Who writes Muse Image's prompt: Muse Spark from the template and the prompt memory (writeFramePrompt, the default), or the template itself (swapFramePrompt). */
  writer?: "template" | "spark";
} = {}): Promise<RunOutcome> {
  const log = options.log ?? (() => undefined);
  const live = (frame: number, attempt: number, tries: number, stage: LiveStage) => options.onLive?.({ frame, attempt, tries, stage });
  if (options.dual && !higgsfieldConfigured()) throw new Error("two drawings per attempt need Higgsfield: set HF_CREDENTIALS");
  const generators: Generator[] = options.dual ? ["muse", "higgsfield"] : ["muse"];
  const writer = options.writer ?? "spark";
  const sourcePoses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
  /** Each arm bone's full length in the clip: a frame's shorter one is foreshortened (measureArms). */
  const fullArms = armLengths(sourcePoses.frames);
  // Read when a drawing is measured: the mapping writes the source track on its first frame.
  const hiddenIn = async (index: number) => (await sourceHidden(dir, sourcePoses))(index);
  const { character, reference, sheet, poseImages, guides, fit, sourceOnGrid, sourcePlaced, sourceFitted, characterAtVideoScale, sheetOnCanvas } = await layoutRun(dir);
  // B is the sheet the run was created with, byte for byte: a replaced character.png would draw someone else under the same run.
  const started = await readManifest(dir);
  const identity: CharacterIdentity = { kind: "character-identity", file: started.character.file, sha256: sha256(character) };
  if (identity.sha256 !== started.character.sha256) throw new ProvenanceError(`character.png changed since the run was created (${identity.sha256.slice(0, 12)} ≠ ${started.character.sha256.slice(0, 12)})`);
  const manifestCrop = started.crop;
  await characterAtVideoScale();
  /** Hashes of every drawing this run made: none of them may be sent as the video or the character. */
  const outputHashes = async () => new Set((await readManifest(dir)).frames.flatMap((entry) => entry.approved ? [entry.approved.sha256] : []));
  const renderer = options.renderer ?? "auto";
  // Repairs call Muse Image: only with a key, and never when generators are switched off.
  const repairs = (options.repair ?? true) && renderer !== "muse" && readMetaConfig() !== null;
  const description = await runDescription(dir, character, log);
  const build = await runBuild(dir, character, reference, sheet, log, options.signal);
  /** How the sheet is drawn, as rules (line work, eyes, shading, finish): every drawing gets it beside the sheet. */
  const style = await runStyle(dir, character, log, options.signal);
  /** The character's height and weight in words, from measures.json: every prompt says them. */
  const body = measuresText(await readMeasures(dir));
  /** How the character's joints bend, drawn once per run: shown with every drawing and to the reviewer. */
  const poseSheet = options.poseSheet === false ? null : await runPoseSheet(dir, character, description, body, log, options.signal);
  /** The run's colour palette: every drawing's tones are held to it (colour.ts), and the generators are shown it. */
  const colours = await runPalette(dir, character, log);
  const paletteRef = { image: await readFile(path.join(dir, PALETTE_IMAGE)), text: paletteText(colours) };
  /** Each approved drawing's outline density (style.ts), by content: their mean is what a new drawing's line work is held to. */
  const densities = new Map<string, number>();
  const approvedDensity = async (): Promise<number | null> => {
    const approved = (await readManifest(dir)).frames.flatMap((entry) => (entry.approved ? [entry.approved] : []));
    for (const { file, sha256 } of approved) if (!densities.has(sha256)) densities.set(sha256, outlineDensity(await toRgba(await readFile(path.join(dir, file)))));
    return approved.length ? approved.reduce((sum, { sha256 }) => sum + densities.get(sha256)!, 0) / approved.length : null;
  };
  /** How much of the figure each palette colour covers in an approved frame: the next frame is held to it. */
  const sharesOf = new Map<number, number[]>();
  const previousShares = async (index: number): Promise<number[] | null> => {
    if (sharesOf.has(index - 1)) return sharesOf.get(index - 1)!;
    const previous = (await readManifest(dir)).frames.find((entry) => entry.index === index - 1);
    if (!previous?.approved) return null;
    const shares = paletteShares(await toRgba(await readFile(path.join(dir, previous.approved.file))), colours);
    sharesOf.set(index - 1, shares);
    return shares;
  };
  const chosen = new Map<string, Candidate>();
  const key = (index: number, attempt: number) => `${index}:${attempt}`;
  const corrections = new Map<string, Correction>();
  const correctionFor = async (frame: { readonly index: number; readonly correction?: { readonly comment: string; readonly marked: string } }) => {
    if (!frame.correction) return null;
    const cached = corrections.get(frame.correction.marked);
    if (cached) return cached;
    const correction = { comment: frame.correction.comment, marked: await withGrid(await readFile(path.join(dir, frame.correction.marked))) };
    corrections.set(frame.correction.marked, correction);
    return correction;
  };
  await mkdir(path.join(dir, "work"), { recursive: true });

  /**
   * Muse Spark's reading of a video frame into its specification, asked once and kept in readings/
   * for every attempt, resume and redraw; a reading kept in the older one-paragraph format is read
   * again. Without one (the call failed) the frame is drawn from the measurements alone.
   */
  const readings = new Map<number, Promise<string>>();
  const readingFor = (index: number): Promise<string> => {
    let pending = readings.get(index);
    if (!pending) {
      // Only a kept reading is shared; a failed one is asked again on the next attempt, as before.
      pending = readFrame(index).then((reading) => {
        if (!reading) readings.delete(index);
        return reading;
      }, (error: unknown) => {
        readings.delete(index);
        throw error;
      });
      readings.set(index, pending);
    }
    return pending;
  };
  /** Starts the next open frame's reading while this one is drawn: it never depends on the drawing. */
  const openFrames = (await readManifest(dir)).frames.filter((frame) => frame.status !== "approved" || options.only === frame.index);
  const readAhead = (index: number) => {
    const next = openFrames.find((frame) => frame.index > index);
    if (next && options.only === undefined) void readingFor(next.index).catch(() => undefined);
  };
  const readFrame = async (index: number): Promise<string> => {
    const file = path.join(dir, readingFile(index));
    const kept = await keptReading(dir, index);
    if (kept !== null) return kept;
    try {
      const reading = await describeFrame({
        frame: await sourceOnGrid(index),
        before: index > 1 ? await sourceOnGrid(index - 1) : null,
        character,
        description,
        measured: measureArms(sourcePoses.frames[index - 1], fullArms),
        signal: options.signal,
      });
      await mkdir(path.dirname(file), { recursive: true });
      // A new revision starts over: readings of the old one in this folder are no longer trusted.
      const revisionFile = path.join(path.dirname(file), "REVISION");
      if (Number(await readFile(revisionFile, "utf8").catch(() => "1")) !== READING_REVISION) {
        for (const name of (await readdir(path.dirname(file))).filter((entry) => /^frame_\d{4}\.txt$/.test(entry) && entry !== path.basename(file))) await rm(path.join(path.dirname(file), name), { force: true });
        await writeFile(revisionFile, `${READING_REVISION}\n`);
      }
      await writeFile(file, `${reading}\n`);
      log(`  frame ${index} read:\n${reading.split("\n").map((line) => `    ${line}`).join("\n")}`);
      return reading;
    } catch (error) {
      options.signal?.throwIfAborted();
      log(`  frame ${index}: couldn't read the video frame (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing from the measurements`);
      return "";
    }
  };

  /**
   * Muse Spark's short note of one video frame's pose (describeMotion), asked once and kept in notes/
   * for every attempt and resume of that frame. It reads that frame alone; without one (the call failed)
   * the frame is drawn from the picture alone.
   */
  const noteFor = async (index: number): Promise<string> => {
    const file = path.join(dir, "notes", `frame_${String(index).padStart(4, "0")}.txt`);
    const kept = await readFile(file, "utf8").then((text) => text.trim(), () => "");
    if (kept) return kept;
    try {
      const note = await describeMotion({ frame: await sourcePlaced(index), signal: options.signal });
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${note}\n`);
      log(`  frame ${index} pose note: ${note}`);
      return note;
    } catch (error) {
      options.signal?.throwIfAborted();
      log(`  frame ${index}: couldn't write the pose note (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing from the picture alone`);
      return "";
    }
  };

  /** The mapping engine, opened on the first frame that uses it; null when it can't run on this run. */
  let mapping: Promise<RunMapping | null> | null = null;
  const openMappingNow = async () => {
    if (mapping) return mapping;
    mapping = readManifest(dir).then((manifest) => openMapping(dir, { manifest, signal: options.signal, log })).catch((error: unknown) => {
      log(`  character mapping unavailable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      return null;
    });
    return mapping;
  };
  /**
   * Approved frames the rig itself drew ("frame N", the mapping's base ids): never a base, so its cuts and
   * smudges can't be deformed into the next frame and pile up. The rig deforms drawings made whole.
   */
  const rigMade = async (): Promise<string[]> => (await readManifest(dir)).frames.flatMap((entry) => {
    const made = entry.approved && entry.attempts.find((attempt) => attempt.attempt === entry.approved!.attempt)?.checks.find((check) => check.name === "alpha")?.detail;
    return made && !/Muse Image|Higgsfield/.test(made) || made && /healed/.test(made) ? [`frame ${entry.index}`] : [];
  });
  /** Bases already deformed per frame in this run: the next rig try uses the next-best drawing. */
  const triedBases = new Map<number, Set<string>>();
  const mapped = new Map<string, MappedFrame & { readonly repair: FrameDiagnostics["repair"] }>();
  /** The target skeleton per frame: the mapping's when it ran, else the pose guide on the canvas. */
  const targets = new Map<number, MappedFrame["target"]>();
  /**
   * The rig's drawing per frame when it passed every measurement: a later try closes its cuts with Muse Image
   * (healFrame) before anything is drawn from scratch, so a pose the rig got right isn't thrown away.
   */
  const rigPosed = new Map<number, Buffer>();
  /** The rig's latest deformation per frame: the silhouette a generator's drawing is compared with. */
  const predictions = new Map<number, MappedFrame>();
  /** Why the rig didn't draw a frame: kept on the attempt the generators drew instead, so the fallback is on record. */
  const rigRefused = new Map<number, string>();
  const fallbackCheck = (index: number, drawnBy: Generator): Check[] => {
    const why = rigRefused.get(index);
    return why ? [{ name: "rig", passed: true, status: "warn", detail: `character rig not used (${why}); drawn by ${GENERATOR_NAME[drawnBy]} instead` }] : [];
  };

  /** Cuts out, measures and registers one generator's picture; every measurable check runs here. */
  const measure = async (generator: Generator, raw: Buffer, stem: string, index: number, marks: Marks, spec: BodySpec | null, anchorDensity: number | null): Promise<Candidate> => {
    await writeFile(`${stem}_${generator}_raw.png`, raw);
    // The rig's drawing is already a cut-out on the canvas: its cuts are closed here, never redrawn, so its pose
    // can't move. Every drawing's tones then go onto the palette's.
    // The background the generator came back on, magenta or not (Higgsfield paints crimson, Muse Image sometimes pink).
    const background = generator === "rig" ? null : keyBackground(await toRgba(raw));
    if (background && background.background !== KEY_COLOR) log(`  ${GENERATOR_NAME[generator]} painted the background ${background.background}, not magenta: keyed that colour instead`);
    let cutout = background ? background.image : await toRgba(raw);
    if (generator === "rig") {
      const closed = closeCuts(cutout);
      cutout = closed.image;
      if (closed.filled || closed.removed) log(`  closed the rig's cuts: ${closed.filled} px filled, ${closed.removed} px of loose fragments removed`);
    }
    const held = holdColours(cutout, colours, await previousShares(index));
    const keyed = await fromRgba(held.image);
    await writeFile(`${stem}_${generator}_keyed.png`, keyed);
    await pose(["detect", "--image", `${stem}_${generator}_keyed.png`, "--out", `${stem}_${generator}_pose.json`]);
    const drawn = (JSON.parse(await readFile(`${stem}_${generator}_pose.json`, "utf8")) as PoseFile).frames[0];
    const scored = await scoreDrawing(keyed, drawn, held.check, { reference, sheet, source: sourcePoses.frames[index - 1], clip: sourcePoses.frames, hidden: await hiddenIn(index), marks, spec, anchorDensity });
    return { generator, png: scored.png, drawn, placed: scored.placed, checks: scored.checks, note: scored.note };
  };

  /**
   * The rig's drawing of a frame: plan, retarget and deform (mapping/engine.ts), then repaint
   * the exposed surface with Muse Image when there is enough of it, keeping the repair only if
   * the pose measured after it matches the pose before it. Null when the mapping can't draw
   * this frame (no drawing to deform, a failed constraint): the generators draw it instead.
   */
  const drawByMapping = async (index: number, attempt: number, stem: string, marks: Marks, spec: BodySpec | null, anchorDensity: number | null): Promise<Candidate | null> => {
    const engine = await openMappingNow();
    if (!engine) return null;
    const tried = triedBases.get(index) ?? new Set<string>();
    triedBases.set(index, tried);
    let frame: MappedFrame;
    try {
      frame = await mapFrame(engine, { index, manifest: await readManifest(dir), guide: onCanvas(guides.frames[index - 1], fit), marks, canvas: CANVAS, exclude: new Set([...tried, ...(await rigMade())]), signal: options.signal });
    } catch (error) {
      options.signal?.throwIfAborted();
      const why = error instanceof Error ? error.message.slice(0, 160) : String(error);
      rigRefused.set(index, why);
      log(`  character rig: ${why}`);
      return null;
    }
    tried.add(frame.decision.base!.id);
    targets.set(index, frame.target);
    predictions.set(index, frame);
    const failed = constraintFailures(frame.outcomes);
    const route = `${frame.decision.mode} from ${frame.decision.base!.id}`;
    if (failed.length) {
      const why = `${route} rejected: ${failed.map((outcome) => `${outcome.id} — ${outcome.detail}`).join("; ")}`;
      rigRefused.set(index, why);
      log(`  character rig (${why})`);
      return null;
    }
    rigRefused.delete(index);
    let png = frame.png;
    let repair: FrameDiagnostics["repair"] = null;
    if (repairs && frame.result.stats.exposedArea + frame.result.stats.distortedArea > 0) {
      try {
        const repaired = await repairRegions({ deformed: frame.result.image, regions: frame.regions, character, description, hints: frame.hints, signal: options.signal });
        if (repaired.applied) {
          await writeFile(`${stem}_rig_deformed.png`, png);
          await writeFile(`${stem}_rig_repaired.png`, repaired.png);
          const [before, after] = await Promise.all([
            estimatePose(`${stem}_rig_deformed.png`, `${stem}_rig_deformed_pose.json`),
            estimatePose(`${stem}_rig_repaired.png`, `${stem}_rig_repaired_pose.json`),
          ]);
          const moved = before && after ? Math.max(0, ...Object.values(boneAngleErrors(skeletonFromPose(before.pose), skeletonFromPose(after.pose)))) : Infinity;
          const kept = moved <= REPAIR_POSE_TOLERANCE;
          if (kept) png = repaired.png;
          repair = { applied: true, kept, note: kept ? `${repaired.note}; pose unchanged (≤ ${moved}°)` : `${repaired.note}; discarded: it moved a limb ${Number.isFinite(moved) ? `${moved}°` : "(pose not found)"}` };
        } else repair = { applied: false, kept: false, note: repaired.note };
      } catch (error) {
        options.signal?.throwIfAborted();
        repair = { applied: false, kept: false, note: `repair failed: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}` };
      }
      log(`  character rig repair: ${repair.note}`);
    }
    const candidate = await measure("rig", png, stem, index, marks, spec, anchorDensity);
    const exposed = frame.result.stats.exposedArea;
    const mappingCheck: Check = {
      name: "mapping",
      passed: true,
      detail: `${route}${frame.decision.distance !== null ? ` (${frame.decision.distance.toFixed(0)}°)` : ""}; ${exposed} px exposed${repair?.kept ? " and repainted" : exposed ? " and filled locally" : ""}`,
    };
    mapped.set(key(index, attempt), { ...frame, repair });
    await mkdir(path.join(dir, "mapping", "diagnostics"), { recursive: true });
    await writeFile(path.join(dir, exposedFile(index, attempt)), await maskToPng(frame.regions));
    return { ...candidate, checks: [...candidate.checks, mappingCheck], note: `${route}; ${candidate.note}` };
  };

  /** The approved previous frame's diagnostics, when it has them (frames drawn before the mapping engine don't). */
  const previousDiagnostics = async (index: number): Promise<FrameDiagnostics | null> => {
    const previous = (await readManifest(dir)).frames.find((entry) => entry.index === index - 1);
    return previous?.approved ? readDiagnostics(dir, previous.index, previous.approved.attempt) : null;
  };

  const recordDiagnostics = async (index: number, attempt: number, winner: Candidate, target: MappedFrame["target"], generated: Skeleton, validation: readonly PolicyOutcome[], png: Buffer) => {
    const rig = mapped.get(key(index, attempt)) ?? null;
    const method: RenderMethod = winner.generator === "rig" ? (rig?.repair?.kept ? "rig-deform+muse-repair" : "rig-deform") : winner.generator === "higgsfield" ? "higgsfield" : "muse-image";
    await writeDiagnostics(dir, await buildDiagnostics({
      dir, index, attempt, method, engine: mapping ? await mapping : null, rig, prediction: rig ?? predictions.get(index) ?? null,
      sourcePose: sourcePoses.frames[index - 1], target, generated, validation, png,
    }));
  };

  return runFrames(dir, {
    log,
    draw: async ({ frame, attempt, anchor, feedback }) => {
      const name = frameName(frame.index);
      const tries = feedback.length + 1;
      live(frame.index, attempt, tries, "drawing");
      const { guide, sourceGrey, marks, spec } = await poseImages(frame.index);
      const source = sourcePoses.frames[frame.index - 1];
      const input: FrameInput = {
        character,
        description,
        style,
        guide,
        sourceGrey,
        // Every frame is drawn from the character sheet, the mannequin, the video frame and the palette alone: the
        // previous frame and the style anchor are earlier drawings, and copies of copies lose the sheet's details
        // (trim, embroidery, thigh width). The frame that drew the character most faithfully had neither.
        previous: null,
        anchor: null,
        marks,
        poseText: describePose(source),
        measured: measureArms(source, fullArms),
        palette: paletteRef,
        bodyMap: spec?.text ?? "",
        face: describeFace(source),
        // The long frame reading only feeds the Higgsfield prompt; Muse Image edits the video frame with a short note.
        reading: generators.includes("higgsfield") ? await readingFor(frame.index).finally(() => readAhead(frame.index)) : "",
        correction: await correctionFor(frame),
        feedback,
        // Every rejected attempt so far, read back from the manifest: the run learns as it draws.
        lessons: lessonLines((await readManifest(dir)).frames, frame.index, feedback.length === 0),
        body,
        signal: options.signal,
      };
      const stem = path.join(dir, "work", `${name.replace(".png", "")}_a${attempt}`);
      // Line work is held to the approved frames on average, not to the first alone: how much outline a
      // figure shows changes with its pose (arms out show less per area), and one frame is a narrow bar.
      const anchorDensity = anchor ? await approvedDensity() : null;
      // A prompt under test is Muse Image's: the rig draws nothing from words.
      if (!options.prompt && (renderer === "rig" || (renderer === "auto" && tries === 1))) {
        const rigged = await drawByMapping(frame.index, attempt, stem, marks, spec, anchorDensity);
        if (rigged) {
          // Only a drawing that passed every measurement is worth closing up: healing a broken one invents parts.
          if (rigged.checks.every((check) => check.passed)) rigPosed.set(frame.index, rigged.png);
          live(frame.index, attempt, tries, "measuring");
          chosen.set(key(frame.index, attempt), rigged);
          await writeFile(`${stem}_pose.json`, JSON.stringify({ width: CANVAS.width, height: CANVAS.height, frames: [rigged.drawn] }));
          return rigged.png;
        }
        if (renderer === "rig") throw new Error("the character rig can't draw this frame and the generators are off for this run");
      }
      // The rig had the pose right: close its cuts (once per frame) instead of drawing anew.
      const torn = renderer === "auto" && !options.prompt ? rigPosed.get(frame.index) : undefined;
      if (torn) {
        rigPosed.delete(frame.index);
        try {
          const raw = await healFrame({ drawing: torn, character, description, problem: feedback.at(-1), signal: options.signal });
          live(frame.index, attempt, tries, "measuring");
          const healed = await measure("muse", raw, stem, frame.index, marks, spec, anchorDensity);
          const note = `rig drawing healed by Muse Image; ${healed.note}`;
          chosen.set(key(frame.index, attempt), { ...healed, note, checks: [...healed.checks, ...fallbackCheck(frame.index, "muse")] });
          await writeFile(`${stem}_pose.json`, JSON.stringify({ width: CANVAS.width, height: CANVAS.height, frames: [healed.drawn] }));
          return healed.png;
        } catch (error) {
          options.signal?.throwIfAborted();
          log(`  healing the rig's drawing failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}; drawing anew`);
        }
      }
      // The generators follow the pose mannequin, built on the rig's target when it ran, else on the pose guide.
      const target = targets.get(frame.index)?.skeleton ?? skeletonFromPose(onCanvas(guides.frames[frame.index - 1], fit));
      // With the character's own hips and legs measured on its sheet's rig when the mapping opened: never a generic dummy body.
      const engine = mapping ? await mapping : null;
      const posed: FrameInput = { ...input, mannequin: await withGrid(await fromRgba(mannequin(target, CANVAS, engine ? sheetBuild(engine.sheet.rig) : null).shaded), marks) };
      await writeFile(`${stem}_mannequin.png`, posed.mannequin!);
      // Muse Image edits the colour video frame into the character with a short prompt; Higgsfield still gets the full one.
      const written = generators.includes("muse")
        ? swapFramePrompt({ frame: await sourcePlaced(frame.index), character: (await characterAtVideoScale()).png, characterSheet: character, description, style, note: await noteFor(frame.index), correction: input.correction, feedback, body, poseSheet, signal: options.signal })
        : null;
      // Muse Spark's own prompt, written from the template and the images; the template draws when it can't write one.
      const manifestNow = written && !options.prompt && writer === "spark" ? await readManifest(dir) : null;
      const spark = written && manifestNow
        ? await writeFramePrompt({ template: written, lessons: lessonLines(manifestNow.frames, frame.index, feedback.length === 0, SPARK_LESSONS), memory: await recallMemory(dir, manifestNow, frame.index), signal: options.signal }).catch((error: unknown) => {
          options.signal?.throwIfAborted();
          log(`  Muse Spark couldn't write the prompt (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing with the template`);
          return null;
        })
        : null;
      const swap = written && options.prompt ? { ...written, prompt: options.prompt } : written && spark ? { ...written, prompt: spark } : written;
      // Every reference recorded with its entity and hash, and refused if B isn't the run's character or an output stands in for A or B.
      const generation: GenerationTarget = {
        kind: "generation-target", frame: frame.index, attempt,
        pose: { kind: "pose-source", frame: frame.index, file: frame.source, sha256: sha256(await readFile(path.join(dir, frame.source))), crop: manifestCrop, layout: fit },
        identity,
        references: recordReferences(swap?.references ?? framePrompt(posed).references),
      };
      assertIsolation(generation, await outputHashes());
      await writeFile(`${stem}_target.json`, `${JSON.stringify(generation, null, 2)}\n`);
      // The exact words the generators get, after the labelled images: what a person reads to see why a drawing came out as it did.
      const record = (name: string, sent: { prompt: string; references: readonly { role: string }[] }) => writeFile(name, `${sent.references.map((reference, i) => `Image ${i + 1}: ${reference.role}`).join("\n")}\n\n${sent.prompt}\n`);
      if (swap) await record(`${stem}_prompt.txt`, swap);
      // Beside Muse Spark's prompt, the template it was written from: the two can be compared frame by frame.
      if (spark && written) await record(`${stem}_template_prompt.txt`, written);
      if (generators.includes("higgsfield")) await record(swap ? `${stem}_higgsfield_prompt.txt` : `${stem}_prompt.txt`, framePrompt(posed));
      // With two generators both draw the same prompt at once; one failing still leaves the other.
      const drawings = await Promise.allSettled(generators.map(async (generator) => {
        if (generator === "muse") return { generator, raw: await drawSwap(swap!, options.signal) };
        const { prompt, references } = framePrompt(posed);
        return { generator, raw: await toCanvas(await generateHiggsfield({ prompt, references, aspectRatio: "2:3", signal: options.signal })) };
      }));
      options.signal?.throwIfAborted();
      const ready = drawings.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      for (const [i, result] of drawings.entries()) {
        if (result.status === "rejected") log(`  ${GENERATOR_NAME[generators[i]]} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
      if (!ready.length) throw (drawings[0] as PromiseRejectedResult).reason;
      live(frame.index, attempt, tries, "measuring");
      const candidates = await Promise.all(ready.map(({ generator, raw }) => measure(generator, raw, stem, frame.index, marks, spec, anchorDensity)));
      const best = candidates.reduce((winner, candidate) => (better(candidate, winner) ? candidate : winner));
      const others = candidates.filter((candidate) => candidate !== best)
        .map((candidate) => `${GENERATOR_NAME[candidate.generator]} ${candidate.checks.filter((check) => !check.passed).map((check) => check.name).join("+") || "passed"}`);
      const note = `${GENERATOR_NAME[best.generator]}${others.length ? ` kept over ${others.join(", ")}` : ""}; ${best.note}`;
      if (candidates.length > 1) log(`  ${note}`);
      chosen.set(key(frame.index, attempt), { ...best, note, checks: [...best.checks, ...fallbackCheck(frame.index, best.generator)] });
      await writeFile(`${stem}_pose.json`, JSON.stringify({ width: CANVAS.width, height: CANVAS.height, frames: [best.drawn] }));
      const output: GeneratedFrame = { kind: "generated-frame", frame: frame.index, attempt, generator: best.generator, sha256: sha256(ready.find((drawing) => drawing.generator === best.generator)!.raw), target: sha256(Buffer.from(JSON.stringify(generation))) };
      await writeFile(`${stem}_generated.json`, `${JSON.stringify(output, null, 2)}\n`);
      return best.png;
    },
    validate: async (png, { frame, attempt, previous, anchor, feedback }) => {
      const tries = feedback.length + 1;
      live(frame.index, attempt, tries, "checking");
      const winner = chosen.get(key(frame.index, attempt))!;
      const checks: Check[] = winner.checks.map((check) => (check.name === "alpha" ? { ...check, detail: `${check.detail}; ${winner.note}` } : check));
      // The runtime animation policies on the finished drawing, against the previous approved frame.
      const target = targets.get(frame.index) ?? { skeleton: skeletonFromPose(onCanvas(guides.frames[frame.index - 1], fit)), rotations: [], unseen: [] };
      const generated = skeletonFromPose(winner.placed);
      const previousRecord = await previousDiagnostics(frame.index);
      const engine = mapping ? await mapping : null;
      const validation = engine?.registry.run("validation", {
        stage: "validation", index: frame.index, target: target.skeleton, generated,
        previous: previousRecord ? { target: skeletonFromMap(previousRecord.target.joints), generated: previousRecord.generated ? skeletonFromMap(previousRecord.generated.joints) : null } : null,
      }).outcomes ?? [];
      const broken = constraintFailures(validation);
      if (validation.length) {
        checks.push({
          name: "policies",
          passed: broken.length === 0,
          detail: broken.length ? broken.map((outcome) => outcome.detail).join("; ") : validation.map((outcome) => `${outcome.id.split("/")[1]} ${outcome.passed ? "ok" : `warn (${outcome.detail})`}`).join(", "),
          ...(broken.length ? { feedback: "Keep every joint the source holds still exactly where it was in the previous frame." } : {}),
        });
      }
      // The overlay scan (scan.ts): every joint's distance from the video frame's pose after the drawing is aligned on its
      // torso, in torso lengths, plus the grid cells where a limb is missing or misplaced. Kept as evidence beside the
      // attempt (the error map) and listed with the checks; it doesn't decide a frame until its limits are calibrated on
      // this generator's drawings (the limits were set on rig and mannequin drawings).
      const scan = scanPose(target.skeleton, generated, await toRgba(png));
      checks.push({ name: "scan", passed: true, ...(scan.passed ? {} : { status: "warn" as const }), severity: "info", detail: scan.detail, ...(scan.score !== undefined ? { score: scan.score } : {}) });
      await writeFile(path.join(dir, "work", `${frameName(frame.index).replace(".png", "")}_a${attempt}_scan.png`), await scanOverlay((await poseImages(frame.index)).sourceGrey, png, target.skeleton, generated, scan)).catch((error: unknown) => log(`  scan overlay not saved: ${error instanceof Error ? error.message : String(error)}`));
      // The pictures Muse Spark reviews with, made for every attempt and kept beside it (the debug panel shows them), also
      // for one the measurements already reject. The finished drawing, registered onto the frame's marks, ghosted over the
      // video frame placed the same way: it shows the pose differences a side by side hides, and whether the character
      // stands where the person stood, as tall. Next to the character sheet at the drawings' scale it shows the build.
      const overlay = await ghostOverlay(await sourceFitted(frame.index), png);
      const pair = build ? await buildPair(await sheetOnCanvas(frame.index), png) : undefined;
      const seen = path.join(dir, "work", `${frameName(frame.index).replace(".png", "")}_a${attempt}`);
      await writeFile(`${seen}_review_overlay.png`, overlay);
      if (pair) await writeFile(`${seen}_review_build.png`, pair);
      // Muse Spark looks at every drawing the measurements don't already reject (a pose they couldn't measure
      // is exactly what it should see), and at every drawing in debug (`review: "always"`), whatever was measured.
      if (options.review === "always" || decide(checks).decision !== "REJECTED") {
        live(frame.index, attempt, tries, "reviewing");
        const correction = await correctionFor(frame);
        checks.push(reviewCheck(await reviewFrame({
          overlay,
          build: pair && build ? { pair, profile: buildText(build) } : undefined,
          character,
          pair: await sideBySide(await readFile(path.join(dir, frame.source)), png),
          drawing: await onColour(png, "#d8d8d8"),
          previous: previous ? await onColour(previous, "#d8d8d8") : null,
          anchor: anchor ? await onColour(anchor, "#d8d8d8") : null,
          correction,
          legs: describeLegs(sourcePoses.frames[frame.index - 1]),
          poseSheet,
          signal: options.signal,
        }), correction, closePose(sourcePoses.frames[frame.index - 1], winner.drawn, sourcePoses.frames)));
      }
      live(frame.index, attempt, tries, decide(checks).decision === "ACCEPTED" ? "approved" : "rejected");
      await recordDiagnostics(frame.index, attempt, winner, target, generated, validation, png).catch((error: unknown) => log(`  diagnostics not saved: ${error instanceof Error ? error.message : String(error)}`));
      return checks;
    },
  }, { limit: options.limit, only: options.only, signal: options.signal, attempts: options.attempts })
    // What this run's prompts taught goes to the character's kit, for its next runs.
    .finally(() => readManifest(dir).then((manifest) => keepMemory(dir, manifest)).catch((error: unknown) => log(`  prompt memory not saved: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`)));
}

type DiagnosticsInput = {
  readonly dir: string;
  readonly index: number;
  readonly attempt: number;
  readonly method: RenderMethod;
  readonly engine: RunMapping | null;
  /** The deformation that drew this attempt; null for a generator's drawing. */
  readonly rig: (MappedFrame & { readonly repair: FrameDiagnostics["repair"] }) | null;
  /** A deformation of the same frame, for the silhouette comparison. */
  readonly prediction: MappedFrame | null;
  readonly sourcePose: Pose;
  readonly target: MappedFrame["target"];
  readonly generated: Skeleton | null;
  readonly validation: readonly PolicyOutcome[];
  readonly png: Buffer;
};

/** IoU of the rig's predicted silhouette and the drawing's; null when either is empty or missing. */
export function silhouetteMatch(predicted: Mask | null, drawn: Mask): number | null {
  if (!predicted || !area(predicted) || !area(drawn)) return null;
  return Math.round(intersectionOverUnion(predicted, drawn) * 1000) / 1000;
}

/** One attempt's mapping diagnostics (mapping/diagnostics.ts), whichever method drew it. */
async function buildDiagnostics(input: DiagnosticsInput): Promise<FrameDiagnostics> {
  const { dir, index, attempt, engine, rig, prediction, target, generated } = input;
  const tracked = engine?.track[index - 1];
  const source = skeletonFromPose(tracked ?? input.sourcePose);
  const image = await toRgba(input.png);
  const finalMask = fromAlpha(image);
  const errors = generated ? jointErrors(target.skeleton, generated) : {};
  const values = Object.values(errors);
  const predicted = prediction ? { width: prediction.result.coverage.width, height: prediction.result.coverage.height, data: prediction.result.coverage.data.map((v, p) => (v || prediction.result.exposed.data[p] ? 1 : 0)) } : null;
  const names = (indices: readonly number[]) => indices.map((i) => (i === 0 ? "nose" : `keypoint ${i}`));
  return {
    version: 1, frame: index, attempt, at: new Date().toISOString(), method: input.method,
    base: rig ? { id: rig.decision.base!.id, index: rig.decision.base!.index, mode: rig.decision.mode, distance: rig.decision.distance, depth: rig.decision.base!.depth } : null,
    source: {
      joints: jointMap(source), raw: jointMap(skeletonFromPose(input.sourcePose)), swapped: tracked?.swapped ?? false,
      occluded: names(tracked?.flags.occluded ?? []), bridged: names(tracked?.flags.bridged ?? []), offSubject: names(tracked?.flags.offSubject ?? []),
    },
    rig: rig ? { joints: jointMap(rig.base.rig.skeleton), bones: rig.base.rig.bones.map(({ name, z }) => ({ name, z })) } : null,
    masks: {
      character: engine ? path.relative(dir, path.join(engine.sheet.dir, "mask.png")) : null,
      segmentation: engine?.sheet.profile.segmentation.method ?? "none",
      subjectTracked: engine?.subjectTracked ?? false,
      exposed: rig ? exposedFile(index, attempt) : null,
      labels: rig?.base.analysis ? path.relative(dir, path.join(rig.base.analysis.dir, "labels.png")) : null,
    },
    target: { joints: jointMap(target.skeleton), rotations: target.rotations, unseen: target.unseen },
    generated: generated ? { joints: jointMap(generated), estimator: "rtmw" } : null,
    jointError: errors,
    boneError: generated ? boneAngleErrors(target.skeleton, generated) : {},
    meanJointError: values.length ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 1000) / 1000 : null,
    // No silhouette on either side (an empty cut-out, a failed segmentation) is no comparison, not a perfect match.
    silhouette: silhouetteMatch(predicted, finalMask),
    missing: generated ? JOINT_NAMES.filter((name) => target.skeleton[name] && !generated[name]) : [],
    occluded: names(tracked?.flags.occluded ?? []),
    consistency: engine ? paletteSimilarity(palette(image, finalMask), engine.sheet.profile.palette) : null,
    exposedArea: rig?.result.stats.exposedArea ?? 0,
    repair: rig?.repair ?? null,
    policies: [...(rig?.outcomes ?? engine?.outcomes ?? []), ...input.validation],
  };
}

/**
 * Measures a frame's attempts that have no mapping diagnostics yet (drawn before the mapping
 * engine): DWPose on each drawing, the frame's target from the mapping, the validation policies.
 * Local work only, no model call. Returns how many attempts were measured.
 */
export async function diagnoseFrame(dir: string, index: number, log: (line: string) => void = () => undefined): Promise<number> {
  const manifest = await readManifest(dir);
  const frame = manifest.frames.find((entry) => entry.index === index);
  if (!frame) throw new Error(`frame ${index} doesn't exist`);
  const { guides, fit, poseImages } = await layoutRun(dir);
  const { marks } = await poseImages(index);
  const sourcePoses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
  const engine = await openMapping(dir, { manifest, log }).catch((error: unknown) => {
    log(`  character mapping unavailable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    return null;
  });
  const prediction = engine ? await mapFrame(engine, { index, manifest, guide: onCanvas(guides.frames[index - 1], fit), marks, canvas: CANVAS }).catch(() => null) : null;
  const target = prediction?.target ?? { skeleton: skeletonFromPose(onCanvas(guides.frames[index - 1], fit)), rotations: [], unseen: [] };
  const previous = manifest.frames.find((entry) => entry.index === index - 1);
  const before = previous?.approved ? await readDiagnostics(dir, previous.index, previous.approved.attempt) : null;
  await mkdir(path.join(dir, "mapping", "diagnostics"), { recursive: true });
  let measured = 0;
  for (const attempt of frame.attempts) {
    if (await readDiagnostics(dir, index, attempt.attempt)) continue;
    const file = path.join(dir, attempt.file);
    if (!existsSync(file)) continue;
    const estimate = await estimatePose(file, path.join(dir, diagnosticsFile(index, attempt.attempt).replace(".json", "_pose.json")));
    const generated = estimate ? skeletonFromPose(estimate.pose) : null;
    const validation = engine && generated ? engine.registry.run("validation", {
      stage: "validation", index, target: target.skeleton, generated,
      previous: before ? { target: skeletonFromMap(before.target.joints), generated: before.generated ? skeletonFromMap(before.generated.joints) : null } : null,
    }).outcomes : [];
    const alpha = attempt.checks.find((check) => check.name === "alpha")?.detail ?? "";
    const method: RenderMethod = attempt.checks.some((check) => check.name === "mapping") ? "rig-deform" : /(^|; )Higgsfield/.test(alpha) ? "higgsfield" : "muse-image";
    await writeDiagnostics(dir, await buildDiagnostics({
      dir, index, attempt: attempt.attempt, method, engine, rig: null, prediction, sourcePose: sourcePoses.frames[index - 1],
      target, generated, validation, png: await readFile(file),
    }));
    measured++;
    log(`frame ${index} attempt ${attempt.attempt}: measured`);
  }
  return measured;
}

/**
 * The character rig's drawing of one frame, with no model call: mapping (the segmenter is
 * local unless FOCUS_MAPPING_SAM says otherwise), deformation, then DWPose on the result and
 * the firewall's pose check against the video frame. Writes mapping/preview/frame_NNNN*.png.
 */
export async function mapPreview(dir: string, index: number, log: (line: string) => void = () => undefined): Promise<{ file: string; pose: ReturnType<typeof comparePoses>; outcomes: readonly PolicyOutcome[] }> {
  const manifest = await readManifest(dir);
  const { guides, fit, poseImages } = await layoutRun(dir);
  const { marks } = await poseImages(index);
  const engine = await openMapping(dir, { manifest, log });
  const frame = await mapFrame(engine, { index, manifest, guide: onCanvas(guides.frames[index - 1], fit), marks, canvas: CANVAS });
  const out = path.join(dir, "mapping", "preview");
  await mkdir(out, { recursive: true });
  const file = path.join(out, frameName(index));
  await writeFile(file, frame.png);
  await writeFile(file.replace(".png", "_repaint.png"), await maskToPng(frame.regions));
  const measured = await estimatePose(file, file.replace(".png", "_pose.json"));
  const sourcePoses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
  const pose = measured ? comparePoses(sourcePoses.frames[index - 1], measured.pose, undefined, sourcePoses.frames) : { name: "pose", passed: false, status: "fail" as const, detail: "no body found on the deformed drawing", bones: [], missing: [], unmeasured: [], coverage: { measured: 0, of: 0 } };
  log(`frame ${index}: ${frame.decision.mode} from ${frame.decision.base!.id}; ${frame.result.stats.exposedArea} px exposed, ${frame.result.stats.distortedArea} px over-stretched`);
  for (const outcome of frame.outcomes) log(`  ${outcome.passed ? "ok  " : outcome.kind === "advisory" ? "warn" : "FAIL"} ${outcome.id}: ${outcome.detail}`);
  log(`  ${pose.passed ? "ok  " : "FAIL"} pose: ${pose.detail}`);
  return { file, pose, outcomes: frame.outcomes };
}

/** Side-by-side sheet and GIF, transparent MOV and a score table of the approved frames. Returns the report folder. */
export async function buildReport(dir: string, speed = 1): Promise<string> {
  const manifest = await readManifest(dir);
  const out = path.join(dir, "report");
  // Pairs are rebuilt each time; outputs at other speeds stay.
  await rm(path.join(out, "pairs"), { recursive: true, force: true });
  await mkdir(path.join(out, "pairs"), { recursive: true });
  const approved = manifest.frames.filter((frame) => frame.approved);
  if (!approved.length) throw new Error("no approved frames yet");
  const cell = { width: 256, height: 384 };
  const pairs: Buffer[] = [];
  for (const [i, frame] of approved.entries()) {
    const source = await sharp(await fitCanvas(await readFile(path.join(dir, frame.source)), "#ffffff")).resize(cell.width, cell.height).png().toBuffer();
    const drawing = await sharp(await onColour(await readFile(path.join(dir, frame.approved!.file)), "#ffffff")).resize(cell.width, cell.height).png().toBuffer();
    const pair = await sharp({ create: { width: cell.width * 2, height: cell.height, channels: 3, background: "#ffffff" } }).composite([{ input: source, left: 0, top: 0 }, { input: drawing, left: cell.width, top: 0 }]).png().toBuffer();
    await writeFile(path.join(out, "pairs", `pair_${String(i + 1).padStart(4, "0")}.png`), pair);
    pairs.push(pair);
  }
  const columns = Math.min(5, pairs.length);
  const rows = Math.ceil(pairs.length / columns);
  await sharp({ create: { width: columns * cell.width * 2 + (columns - 1) * 8, height: rows * cell.height + (rows - 1) * 8, channels: 3, background: "#888888" } })
    .composite(pairs.map((input, i) => ({ input, left: (i % columns) * (cell.width * 2 + 8), top: Math.floor(i / columns) * (cell.height + 8) })))
    .png().toFile(path.join(out, "sheet.png"));
  const rate = String(manifest.fps * speed);
  await ffmpeg(["-framerate", rate, "-i", path.join(out, "pairs", "pair_%04d.png"), "-vf", "split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", path.join(out, `side-by-side_${speed}x.gif`)]);
  await ffmpeg(["-framerate", rate, "-i", path.join(dir, "frames", "frame_%04d.png"), "-c:v", "png", "-f", "mov", path.join(out, `transparent_${speed}x.mov`)]);
  const lines = ["| frame | attempts | pose (mean °) | result |", "| --- | --- | --- | --- |"];
  for (const frame of manifest.frames) {
    const winner = frame.attempts.find((a) => a.attempt === frame.approved?.attempt);
    lines.push(`| ${frame.index} | ${frame.attempts.length} | ${winner?.checks.find((c) => c.name === "pose")?.score ?? "—"} | ${frame.status}${frame.approved?.manual ? " (manual)" : ""} |`);
  }
  await writeFile(path.join(out, "scores.md"), `${lines.join("\n")}\n`);
  return out;
}

