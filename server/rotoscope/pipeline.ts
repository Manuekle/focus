import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { ffmpeg } from "../ffmpeg";
import { dataRoot } from "../storage";
import { checkAlpha, fromRgba, KEY_COLOR, keyOut, toRgba } from "./alpha";
import { checkStyle, outlineDensity } from "./style";
import { bodySpec, checkProportions, describeFace, fullLengths, onCanvas, sheetLengths, type BodySpec } from "./body-map";
import { CANVAS, describeCharacter, describeFrame, drawFrame, fitCanvas, framePrompt, onColour, reviewCheck, reviewFrame, sideBySide, toCanvas, type Correction, type FrameInput } from "./draw";
import { generateHiggsfield, higgsfieldConfigured } from "./higgsfield";
import { lessonLines } from "./lessons";
import { detectCrop, extractFrames, frameName } from "./extract";
import { comparePoses, describeLegs, describePose, type Pose } from "./pose-match";
import { checkScale, figureBox, GRID, REGISTER_SCALE, proportions, targets, toLine, withGrid, type Marks } from "./grid";
import { acquireLock, copyInto, readManifest, runFrames, writeManifest, type Check, type Manifest, type RunOutcome } from "./run-state";

// The rotoscope pipeline, shared by the console (cli.ts) and the app
// (service.ts): video → frames at N fps → DWPose guides on the character's
// proportions → one drawing per frame, gridded, keyed to alpha, registered
// and validated behind the firewall.

const exec = promisify(execFile);
// Runtime tools, not source: keep them out of Turbopack's file tracing.
const PYTHON = process.env.ROTOSCOPE_PYTHON ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "services/animation-worker/.venv/bin/python");
const POSE_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), "services/animation-worker/scripts/rotoscope_pose.py");

export const runsRoot = () => path.join(dataRoot(), "rotoscope");

/** DWPose runs in the worker's Python environment; a server without it can't prepare runs. */
export function poseToolAvailable(): boolean {
  return existsSync(PYTHON) && existsSync(POSE_SCRIPT);
}

type PoseFile = { width: number; height: number; files?: string[]; frames: Pose[] };

async function pose(args: string[]): Promise<void> {
  await exec(PYTHON, ["-I", POSE_SCRIPT, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

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

/**
 * The clip's layout, from every guide pose: the figure drawn as large as the
 * canvas allows without the highest hand or the hair leaving it. Muse Image
 * draws figures filling the height on its own; target lines this close to
 * that are ones it can hit, and they stay the same for every frame.
 */
function clipLayout(guides: PoseFile, reference: Pose, sheet: ReturnType<typeof proportions>): Layout {
  let [top, bottom, left, right] = [Infinity, -Infinity, Infinity, -Infinity];
  const centers: number[] = [];
  for (const frame of guides.frames) {
    const marks = targets(frame, drawnSize(frame, reference) ?? 1, sheet, { scale: 1, x: 0, y: 0 });
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
async function register(png: Buffer, drawn: Marks | null, target: Marks): Promise<{ png: Buffer; note: string }> {
  if (!drawn || drawn.feet <= drawn.head) return { png, note: "not registered (body not found)" };
  const scale = Math.min(REGISTER_SCALE.max, Math.max(REGISTER_SCALE.min, (target.feet - target.head) / (drawn.feet - drawn.head)));
  const ox = Math.round(target.center - drawn.center * scale);
  const oy = Math.round(target.feet - drawn.feet * scale);
  return { png: await place(png, scale, ox, oy, { r: 0, g: 0, b: 0, alpha: 0 }), note: `moved ${ox}, ${oy} px, scaled ${scale.toFixed(2)}` };
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
  const half = Math.max(2, Math.round(Math.abs(ls[0] - rs[0]) * 0.2));
  const tops: number[] = [];
  for (let x = Math.max(0, Math.round(nose[0]) - half); x <= Math.min(info.width - 1, Math.round(nose[0]) + half); x++) {
    let y = Math.min(info.height - 1, Math.round(nose[1]));
    while (y > 0 && solid(x, y - 1)) y--;
    tops.push(y);
  }
  tops.sort((a, b) => a - b);
  let soles = -1;
  for (let y = info.height - 1; y >= 0 && soles < 0; y--) {
    for (let x = 0; x < info.width; x++) if (solid(x, y)) { soles = y; break; }
  }
  if (soles < 0) return null;
  let head = tops[Math.floor(tops.length / 2)];
  const size = drawnSize(drawn, reference);
  const reach = Math.abs(ls[0] - rs[0]) * 0.75;
  const handOverHead = [9, 10, ...Array.from({ length: 42 }, (_, i) => 91 + i)].some((i) => {
    const p = at(drawn, i);
    return p !== null && p[1] < nose[1] && Math.abs(p[0] - nose[0]) < reach;
  });
  if (size && handOverHead) {
    const expected = nose[1] - sheet.headAboveNose * size;
    if (head < expected - 0.15 * sheet.headAboveNose * size) head = expected;
  }
  return { head, feet: soles, center: (lh[0] + rh[0]) / 2 };
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
};

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
  log("DWPose on the source frames and the character, Muse Spark describing the character…");
  // Independent work at once: both DWPose passes (local CPU) and the character description (remote).
  await Promise.all([
    Promise.all([
      pose(["detect", "--images", path.join(dir, "source"), "--out", path.join(dir, "source-poses.json")]),
      pose(["detect", "--image", path.join(dir, "character.png"), "--out", path.join(dir, "character-pose.json")]),
    ]).then(() => drawGuides(dir)),
    readFile(path.join(dir, "character.png")).then(describeCharacter).then((text) => writeFile(path.join(dir, "character.txt"), `${text}\n`)),
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

/** Everything a frame's drawing is placed by: the clip layout, the grid's target lines and the gridded pose images. */
export async function layoutRun(dir: string) {
  const guides = JSON.parse(await readFile(path.join(dir, "guides/guides.json"), "utf8")) as PoseFile;
  const character = await readFile(path.join(dir, "character.png"));
  const reference = (JSON.parse(await readFile(path.join(dir, "character-pose.json"), "utf8")) as PoseFile).frames[0];
  const sheet = proportions(reference, await figureBox(character));
  // Fixed on the first generate: a resume must place new frames exactly like the approved ones.
  const layoutFile = path.join(dir, "layout.json");
  const fit: Layout = existsSync(layoutFile) ? JSON.parse(await readFile(layoutFile, "utf8")) : clipLayout(guides, reference, sheet);
  if (!existsSync(layoutFile)) await writeFile(layoutFile, `${JSON.stringify(fit)}\n`);
  // How long each guide bone is at its most extended, never shorter than the character's own limb:
  // shorter means the camera sees it foreshortened.
  const onFit = guides.frames.map((frame) => onCanvas(frame, fit));
  const full = fullLengths(onFit, sheetLengths(reference, onFit));
  const poseImages = async (index: number) => {
    const guide = guides.frames[index - 1];
    const size = drawnSize(guide, reference) ?? 1;
    const marks = targets(guide, size, sheet, fit);
    if (!marks) throw new Error(`frame ${index}: the pose guide has no face, ankles or hips to place the grid lines`);
    const placeOnCanvas = async (png: Buffer) => onColour(await place(png, fit.scale, fit.x, fit.y, "#ffffff"), "#ffffff");
    return {
      marks,
      // Every joint and limb length in grid cells, at this frame's size of the character.
      spec: bodySpec(onCanvas(guide, fit), marks, sheet.headHeight * size * fit.scale, full),
      guide: await withGrid(await placeOnCanvas(await readFile(path.join(dir, "guides", frameName(index)))), marks),
      sourceGrey: await withGrid(await placeOnCanvas(await sharp(path.join(dir, "source", frameName(index))).greyscale().png().toBuffer())),
    };
  };
  return { guides, character, reference, sheet, fit, poseImages };
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

/** Draws and validates every open frame in order, behind the firewall (run-state.ts). */
export type LiveStage = "drawing" | "measuring" | "checking" | "reviewing" | "approved" | "rejected";
export type LiveEvent = { readonly frame: number; readonly attempt: number; readonly tries: number; readonly stage: LiveStage };

export type Generator = "muse" | "higgsfield";
const GENERATOR_NAME: Record<Generator, string> = { muse: "Muse Image", higgsfield: "Higgsfield" };

/** One generator's drawing of a frame, cut out, registered and measured. */
type Candidate = {
  readonly generator: Generator;
  readonly png: Buffer;
  readonly drawn: Pose;
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

export async function generateRun(dir: string, options: { limit?: number; only?: number; signal?: AbortSignal; log?: (line: string) => void; onLive?: (event: LiveEvent) => void; dual?: boolean } = {}): Promise<RunOutcome> {
  const log = options.log ?? (() => undefined);
  const live = (frame: number, attempt: number, tries: number, stage: LiveStage) => options.onLive?.({ frame, attempt, tries, stage });
  if (options.dual && !higgsfieldConfigured()) throw new Error("two drawings per attempt need Higgsfield: set HF_CREDENTIALS");
  const generators: Generator[] = options.dual ? ["muse", "higgsfield"] : ["muse"];
  const sourcePoses = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile;
  const { character, reference, sheet, poseImages } = await layoutRun(dir);
  const description = (await readFile(path.join(dir, "character.txt"), "utf8")).trim();
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
   * Muse Spark's reading of a video frame, asked once and kept in readings/ for every attempt,
   * resume and redraw. Without one (the call failed) the frame is drawn from the measurements alone.
   */
  const readings = new Map<number, Promise<string>>();
  const readingFor = (index: number, source: string): Promise<string> => {
    let pending = readings.get(index);
    if (!pending) {
      // Only a kept reading is shared; a failed one is asked again on the next attempt, as before.
      pending = readFrame(index, source).then((reading) => {
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
    if (next && options.only === undefined) void readingFor(next.index, next.source).catch(() => undefined);
  };
  const readFrame = async (index: number, source: string): Promise<string> => {
    const file = path.join(dir, readingFile(index));
    const kept = await readFile(file, "utf8").catch(() => null);
    if (kept !== null) return kept.trim();
    try {
      const reading = await describeFrame(await readFile(path.join(dir, source)), options.signal);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${reading}\n`);
      log(`  frame ${index} read: ${reading.slice(0, 160)}`);
      return reading;
    } catch (error) {
      options.signal?.throwIfAborted();
      log(`  frame ${index}: couldn't read the video frame (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); drawing from the measurements`);
      return "";
    }
  };

  /** Cuts out, measures and registers one generator's picture; every measurable check runs here. */
  const measure = async (generator: Generator, raw: Buffer, stem: string, index: number, marks: Marks, spec: BodySpec | null, anchorDensity: number | null): Promise<Candidate> => {
    await writeFile(`${stem}_${generator}_raw.png`, raw);
    const keyed = await fromRgba(keyOut(await toRgba(raw)));
    await writeFile(`${stem}_${generator}_keyed.png`, keyed);
    await pose(["detect", "--image", `${stem}_${generator}_keyed.png`, "--out", `${stem}_${generator}_pose.json`]);
    const drawn = (JSON.parse(await readFile(`${stem}_${generator}_pose.json`, "utf8")) as PoseFile).frames[0];
    const measured = await drawnMarks(keyed, drawn, reference, sheet);
    const placed = await register(keyed, measured, marks);
    const poseCheck = comparePoses(sourcePoses.frames[index - 1], drawn);
    const alphaCheck = checkAlpha(await toRgba(placed.png));
    const checks: Check[] = [
      { name: poseCheck.name, passed: poseCheck.passed, detail: poseCheck.detail, ...(poseCheck.feedback ? { feedback: poseCheck.feedback } : {}), ...(poseCheck.score !== undefined ? { score: poseCheck.score } : {}) },
      checkScale(measured, marks),
      checkProportions(spec, drawn, measured, marks),
      alphaCheck,
      // Line work held to the run's first drawing: the model reviewer lets a prettier, softer render through.
      ...(anchorDensity ? [checkStyle(await toRgba(placed.png), anchorDensity)] : []),
    ];
    return { generator, png: placed.png, drawn, checks, note: placed.note };
  };

  return runFrames(dir, {
    log,
    draw: async ({ frame, attempt, previous, anchor, feedback }) => {
      const name = frameName(frame.index);
      const tries = feedback.length + 1;
      live(frame.index, attempt, tries, "drawing");
      const { guide, sourceGrey, marks, spec } = await poseImages(frame.index);
      const source = sourcePoses.frames[frame.index - 1];
      const input: FrameInput = {
        character,
        description,
        guide,
        sourceGrey,
        previous: previous ? await withGrid(await onColour(previous, KEY_COLOR)) : null,
        // Frame 2 already copies frame 1 as its previous: the anchor only matters once they differ.
        anchor: anchor && previous && !anchor.equals(previous) ? await withGrid(await onColour(anchor, KEY_COLOR)) : null,
        marks,
        poseText: describePose(source),
        bodyMap: spec?.text ?? "",
        face: describeFace(source),
        reading: await readingFor(frame.index, frame.source).finally(() => readAhead(frame.index)),
        correction: await correctionFor(frame),
        feedback,
        // Every rejected attempt so far, read back from the manifest: the run learns as it draws.
        lessons: lessonLines((await readManifest(dir)).frames, frame.index, feedback.length === 0),
        signal: options.signal,
      };
      const stem = path.join(dir, "work", `${name.replace(".png", "")}_a${attempt}`);
      // With two generators both draw the same prompt at once; one failing still leaves the other.
      const drawings = await Promise.allSettled(generators.map(async (generator) => {
        if (generator === "muse") return { generator, raw: await drawFrame(input) };
        const { prompt, references } = framePrompt(input);
        return { generator, raw: await toCanvas(await generateHiggsfield({ prompt, references, aspectRatio: "2:3", signal: options.signal })) };
      }));
      options.signal?.throwIfAborted();
      const ready = drawings.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      for (const [i, result] of drawings.entries()) {
        if (result.status === "rejected") log(`  ${GENERATOR_NAME[generators[i]]} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
      if (!ready.length) throw (drawings[0] as PromiseRejectedResult).reason;
      live(frame.index, attempt, tries, "measuring");
      const anchorDensity = anchor ? outlineDensity(await toRgba(anchor)) : null;
      const candidates = await Promise.all(ready.map(({ generator, raw }) => measure(generator, raw, stem, frame.index, marks, spec, anchorDensity)));
      const best = candidates.reduce((winner, candidate) => (better(candidate, winner) ? candidate : winner));
      const others = candidates.filter((candidate) => candidate !== best)
        .map((candidate) => `${GENERATOR_NAME[candidate.generator]} ${candidate.checks.filter((check) => !check.passed).map((check) => check.name).join("+") || "passed"}`);
      const note = `${GENERATOR_NAME[best.generator]}${others.length ? ` kept over ${others.join(", ")}` : ""}; ${best.note}`;
      if (candidates.length > 1) log(`  ${note}`);
      chosen.set(key(frame.index, attempt), { ...best, note });
      await writeFile(`${stem}_pose.json`, JSON.stringify({ width: CANVAS.width, height: CANVAS.height, frames: [best.drawn] }));
      return best.png;
    },
    validate: async (png, { frame, attempt, previous, anchor, feedback }) => {
      const tries = feedback.length + 1;
      live(frame.index, attempt, tries, "checking");
      const winner = chosen.get(key(frame.index, attempt))!;
      const checks: Check[] = winner.checks.map((check) => (check.name === "alpha" ? { ...check, detail: `${check.detail}; ${winner.note}` } : check));
      // Muse Spark only looks at drawings that already pass the measurable checks.
      if (checks.every((check) => check.passed)) {
        live(frame.index, attempt, tries, "reviewing");
        const correction = await correctionFor(frame);
        checks.push(reviewCheck(await reviewFrame({
          character,
          pair: await sideBySide(await readFile(path.join(dir, frame.source)), png),
          previous: previous ? await onColour(previous, "#d8d8d8") : null,
          anchor: anchor ? await onColour(anchor, "#d8d8d8") : null,
          correction,
          legs: describeLegs(sourcePoses.frames[frame.index - 1]),
          signal: options.signal,
        }), correction));
      }
      live(frame.index, attempt, tries, checks.every((check) => check.passed) ? "approved" : "rejected");
      return checks;
    },
  }, { limit: options.limit, only: options.only, signal: options.signal });
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

