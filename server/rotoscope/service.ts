import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, cp, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { rotoscopeEnabled } from "../../shared/features";
import { MAX_SEQUENCE_FRAMES, SEQUENCE_CLOCK } from "../../shared/sequence";
import {
  CharacterMeasuresSchema,
  MAPPING_JOINTS,
  RendererSchema,
  MAX_BATCH_CHARACTERS,
  ROTOSCOPE_LIMITS,
  RotoscopeIdSchema,
  RotoscopeLiveSchema,
  type CharacterMeasures,
  type FramePrompt,
  type GeneratorName,
  type MappingJoint,
  type MappingView,
  type PromptAnalysis,
  type RotoscopeBatch,
  type Renderer,
  type RotoscopeMedia,
  type RotoscopePhase,
  type RotoscopeRun,
  type RotoscopeRunSummary,
} from "../../shared/rotoscope";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { importSequence } from "../animation/flipbooks";
import { drawFrontView } from "../characters/front-view";
import { readJsonFile, writeAtomic } from "../animation/store";
import { writeZip } from "../animation/zip";
import { frameName } from "./extract";
import { CANVAS } from "./draw";
import { higgsfieldConfigured } from "./higgsfield";
import { learn, PROMPT_LESSONS } from "./lessons";
import { fillCharacterKitFromRun, findCharacterKit, kitFitsBody } from "../characters/kit";
import { sha256 } from "./provenance";
import { analyzeFramePrompt, characterSheet, diagnoseFrame, extendRun, fitsPerson, framePromptOf, generateRun, initRun, MEASURES_FILE, POSE_SHEET, poseToolAvailable, readingFile, refitRun, reguideRun, runsRoot, SCALED_CHARACTER, scaledCharacter, type LiveEvent } from "./pipeline";
import { approveManually, attemptFile, readManifest, requestCorrection, type Manifest } from "./run-state";
import { readDiagnostics } from "../mapping/diagnostics";
import { readOverrides, writeOverrides } from "../mapping/engine";

// Rotoscope runs in the app: one folder per run under FOCUS_DATA_DIR/rotoscope,
// owned by an account. Preparing and drawing run in the background in this
// process (one dispatcher per run on globalThis, like the other job types);
// the manifest is the source of truth for frames, and run.json holds the rest.

const StateSchema = z.object({
  id: RotoscopeIdSchema,
  ownerId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  phase: z.enum(["preparing", "ready", "extending", "generating", "stopping", "failed"]),
  error: z.string().nullable(),
  log: z.array(z.string()),
  live: RotoscopeLiveSchema.nullable().default(null),
  fps: z.number(),
  start: z.number(),
  seconds: z.number().nullable(),
  /** The whole video's length; measured on first view for runs made before it was stored. */
  duration: z.number().nullable().default(null),
  /** Draw every attempt with Muse Image and Higgsfield and keep the closer one. */
  dual: z.boolean().default(false),
  /** The video has a sound track; null until measured (runs made before it was stored). */
  audio: z.boolean().nullable().default(null),
  /** How frames are drawn (pipeline.ts Renderer); runs made before the mapping engine read as "auto". */
  renderer: RendererSchema.default("auto"),
  /** The character's height and weight and the video person's height (also in measures.json, where the pipeline reads them). */
  measures: CharacterMeasuresSchema.default({ heightCm: null, weightKg: null, personHeightCm: null }),
  /** Draw the character in other poses before its first drawing (pipeline.ts runPoseSheet). */
  poseSheet: z.boolean().default(true),
  /** The test batch the run was made in (createBatch). */
  batch: z.string().uuid().nullable().default(null),
  /** Made by a test batch: once prepared, and on every round, frames 1 to this are drawn once each, and nothing else. */
  batchFrames: z.number().int().min(1).nullable().default(null),
});
type State = z.infer<typeof StateSchema>;

const MAX_LOG = 60;

// Shared across route bundles (Next bundles each route separately).
type Runtime = { readonly running: Map<string, AbortController>; readonly locks: Map<string, Promise<unknown>> };
const runtime: Runtime = ((globalThis as { __focusRotoscope?: Runtime }).__focusRotoscope ??= { running: new Map(), locks: new Map() });

export function assertRotoscopeEnabled(): void {
  if (!rotoscopeEnabled()) throw new AppError("rotoscope_disabled", 404, "Rotoscope isn’t available in this version.");
}

function runDir(id: string): string {
  const parsed = RotoscopeIdSchema.safeParse(id);
  if (!parsed.success) throw new AppError("run_not_found", 404, "This rotoscope run doesn’t exist.");
  return path.join(runsRoot(), parsed.data);
}
const statePath = (id: string) => path.join(runDir(id), "run.json");

async function readState(id: string): Promise<State | null> {
  return readJsonFile(statePath(id), (value) => StateSchema.parse(value));
}

/** Changes run.json under a per-run lock: the dispatcher and the routes both write it. */
async function updateState(id: string, change: (state: State) => State): Promise<State> {
  const previous = runtime.locks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const state = await readState(id);
    if (!state) throw new AppError("run_not_found", 404, "This rotoscope run doesn’t exist.");
    const changed = change(state);
    await writeAtomic(statePath(id), `${JSON.stringify(changed, null, 2)}\n`);
    return changed;
  });
  runtime.locks.set(id, next);
  try { return await next; }
  finally { if (runtime.locks.get(id) === next) runtime.locks.delete(id); }
}

const appendLog = (id: string, line: string) => updateState(id, (state) => ({ ...state, log: [...state.log, line].slice(-MAX_LOG) })).catch(() => undefined);

async function ownedState(id: string, ownerId: string): Promise<State> {
  const state = await readState(id);
  if (!state || state.ownerId !== ownerId) throw new AppError("run_not_found", 404, "This rotoscope run doesn’t exist.");
  // A phase whose worker is gone (the server restarted) is settled here.
  if ((state.phase === "preparing" || state.phase === "extending" || state.phase === "generating" || state.phase === "stopping") && !runtime.running.has(id)) {
    return updateState(id, (current) => current.phase === "preparing"
      ? { ...current, phase: "failed", error: "Preparation was interrupted. Delete this run and create it again." }
      // An interrupted extension never wrote its manifest: the run is as it was.
      : { ...current, phase: "ready", live: null });
  }
  return state;
}

function start(id: string, work: (signal: AbortSignal) => Promise<void>): void {
  if (runtime.running.has(id)) throw new AppError("run_busy", 409, "This run is already working.");
  const controller = new AbortController();
  runtime.running.set(id, controller);
  void work(controller.signal).finally(() => {
    if (runtime.running.get(id) === controller) runtime.running.delete(id);
  });
}

export function activeRuns(): number {
  return runtime.running.size;
}

function friendly(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/no usable pose|no face|ankles|figure on a light background/.test(message)) return "The character or the video has no full body facing the camera to measure. Use a full-body character on a plain background and a video with the whole body in view.";
  if (/no frames/.test(message)) return "That part of the video has no frames. Check the start and length.";
  return `Preparation failed: ${message.slice(0, 200)}`;
}

// ── Views ──────────────────────────────────────────────────────────────────

function view(state: State, manifest: Manifest | null, readings: ReadonlyMap<number, string> = new Map()): RotoscopeRun {
  const frames = (manifest?.frames ?? []).map((frame) => ({
    index: frame.index,
    status: frame.status,
    attempts: frame.attempts.map((attempt) => ({ attempt: attempt.attempt, at: attempt.at, passed: attempt.passed, checks: attempt.checks.map(({ name, passed, detail }) => ({ name, passed, detail })) })),
    approvedAttempt: frame.approved?.attempt ?? null,
    manual: Boolean(frame.approved?.manual),
    correction: frame.correction ? { comment: frame.correction.comment, attempt: frame.correction.attempt, at: frame.correction.at } : null,
    reading: readings.get(frame.index) ?? null,
  }));
  return {
    id: state.id,
    name: state.name,
    createdAt: state.createdAt,
    phase: state.phase,
    total: frames.length,
    approved: frames.filter((frame) => frame.status === "approved").length,
    fps: state.fps,
    start: state.start,
    seconds: state.seconds,
    videoSeconds: state.duration,
    maxAttempts: manifest?.maxAttempts ?? ROTOSCOPE_LIMITS.maxAttempts,
    error: state.error,
    halted: manifest?.halted ? { frame: manifest.halted.frame, reason: manifest.halted.reason } : null,
    live: state.phase === "generating" || state.phase === "stopping" ? state.live : null,
    log: state.log,
    frames,
    dual: state.dual && higgsfieldConfigured(),
    dualAvailable: higgsfieldConfigured(),
    guidesVersion: "",
    hasAudio: state.audio === true,
    renderer: state.renderer,
    measures: state.measures,
    fitsPerson: true,
    poseSheet: false,
    batch: state.batch,
    batchFrames: state.batchFrames,
    lessons: learn(manifest?.frames ?? []).map(({ rule, count, frames }, i) => ({ rule, count, frames: [...frames], inPrompt: i < PROMPT_LESSONS })),
  };
}

export async function getRun(id: string, ownerId: string): Promise<RotoscopeRun> {
  let state = await ownedState(id, ownerId);
  if (state.duration === null && state.phase === "ready") {
    const duration = await videoDuration(id);
    if (duration !== null) state = await updateState(id, (current) => ({ ...current, duration }));
  }
  if (state.audio === null && state.phase === "ready") {
    const audio = await videoHasAudio(id);
    if (audio !== null) state = await updateState(id, (current) => ({ ...current, audio }));
  }
  const manifest = existsSync(path.join(runDir(id), "manifest.json")) ? await readManifest(runDir(id)) : null;
  const guides = await stat(path.join(runDir(id), "guides", "guides.json")).catch(() => null);
  return {
    ...view(state, manifest, await readings(id, manifest)),
    guidesVersion: guides ? String(Math.round(guides.mtimeMs)) : "",
    fitsPerson: await fitsPerson(runDir(id)),
    poseSheet: existsSync(path.join(runDir(id), POSE_SHEET)),
  };
}

/** The frames' readings (pipeline.ts readingFor), from readings/: one small text file per frame drawn so far. */
async function readings(id: string, manifest: Manifest | null): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const names = new Set(await readdir(path.join(runDir(id), "readings")).catch(() => [] as string[]));
  for (const frame of manifest?.frames ?? []) {
    const file = readingFile(frame.index);
    if (!names.has(path.basename(file))) continue;
    const text = await readFile(path.join(runDir(id), file), "utf8").catch(() => "");
    if (text.trim()) out.set(frame.index, text.trim());
  }
  return out;
}

export async function listRuns(ownerId: string): Promise<RotoscopeRunSummary[]> {
  const names = await readdir(runsRoot()).catch(() => [] as string[]);
  const runs: RotoscopeRunSummary[] = [];
  for (const name of names) {
    if (!RotoscopeIdSchema.safeParse(name).success) continue;
    const state = await readState(name);
    if (!state || state.ownerId !== ownerId) continue;
    const { id, createdAt, total, approved, phase } = await getRun(name, ownerId);
    runs.push({ id, name: state.name, createdAt, total, approved, phase });
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Commands ───────────────────────────────────────────────────────────────

export const CreateRunSchema = z.object({
  name: z.string().trim().max(80).optional(),
  fps: z.coerce.number().int().min(ROTOSCOPE_LIMITS.minFps).max(ROTOSCOPE_LIMITS.maxFps),
  start: z.coerce.number().min(0),
  seconds: z.union([z.literal("").transform(() => null), z.coerce.number().min(1).max(ROTOSCOPE_LIMITS.maxSeconds)]).nullable(),
});

export type CreateRunInput = {
  readonly ownerId: string;
  /** The uploaded video, or one a batch already stored (linked, not copied again). */
  readonly video: File | { readonly path: string; readonly name: string };
  readonly character: File;
  /** Already drawn front-on by My characters: used as is. */
  readonly frontOn?: boolean;
  readonly options: z.input<typeof CreateRunSchema>;
  /** The character's height and weight, given before it is analysed. */
  readonly measures?: CharacterMeasures | null;
  /** Draw the character in other poses while preparing (one Muse Image drawing). */
  readonly poseSheet?: boolean;
  readonly batch?: string;
  /** A test batch's run: once prepared, frames 1 to this are drawn once each, and nothing else. */
  readonly batchFrames?: number;
  /** Each drawing by Muse Image and Higgsfield both (needs HF_CREDENTIALS). */
  readonly dual?: boolean;
};

/** Stores the original video (frames must match the user's own export) and the character, then prepares in the background. */
export async function createRun(input: CreateRunInput): Promise<RotoscopeRun> {
  if (!poseToolAvailable()) throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server, so rotoscope runs can’t be prepared here.");
  const options = CreateRunSchema.parse(input.options);
  const id = randomUUID();
  const dir = runDir(id);
  const inputs = path.join(dir, "input");
  await mkdir(inputs, { recursive: true });
  try {
    const name = input.video instanceof File ? input.video.name : input.video.name;
    const extension = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/)?.[0]) ?? ".mp4";
    const video = path.join(inputs, `video${extension}`);
    if (input.video instanceof File) await writeFile(video, Buffer.from(await input.video.arrayBuffer()));
    else await link(input.video.path, video).catch(() => copyFile((input.video as { path: string }).path, video));
    const facts = await probe(video, true).catch(() => null);
    const duration = Number(facts?.format?.duration);
    if (!facts || !Number.isFinite(duration) || duration <= 0 || !facts.streams.some((stream) => stream.codec_type === "video")) {
      throw new AppError("unreadable_video", 422, "We couldn’t read this file as a video.");
    }
    if (options.start + 1 > duration) throw new AppError("invalid_segment", 422, `The video is ${duration.toFixed(1)} s long: start at least a second before its end.`);
    const seconds = options.seconds === null ? null : Math.min(options.seconds, duration - options.start);
    const covered = seconds ?? duration - options.start;
    if (covered > ROTOSCOPE_LIMITS.maxSeconds || Math.round(covered * options.fps) > ROTOSCOPE_LIMITS.maxFrames) {
      throw new AppError("segment_too_long", 422, `One run covers at most ${ROTOSCOPE_LIMITS.maxSeconds} s and ${ROTOSCOPE_LIMITS.maxFrames} frames. Choose a shorter part or fewer frames per second.`);
    }
    // Measured against a light background (grid.ts figureBox), so transparency becomes white.
    const character = path.join(inputs, "character.png");
    await writeFile(character, await characterSheet(Buffer.from(await input.character.arrayBuffer())));
    const measures = input.measures ?? { heightCm: null, weightKg: null, personHeightCm: null };
    const dual = Boolean(input.dual) && higgsfieldConfigured();
    const state: State = {
      id, ownerId: input.ownerId,
      name: options.name || path.basename(name, path.extname(name)).slice(0, 80) || "Rotoscope",
      createdAt: new Date().toISOString(), phase: "preparing", error: null, log: [], live: null, fps: options.fps, start: options.start, seconds, duration, dual, audio: facts.streams.some((stream) => stream.codec_type === "audio"),
      // A batch compares the generators on every frame: the rig would draw frame 2 on from frame 1 instead.
      renderer: input.batchFrames ? "muse" : "auto", measures, poseSheet: input.poseSheet ?? true, batch: input.batch ?? null, batchFrames: input.batchFrames ?? null,
    };
    await writeAtomic(statePath(id), `${JSON.stringify(state, null, 2)}\n`);
    start(id, async (signal) => {
      try {
        if (!input.frontOn) await frontOnCharacter(character, signal, (line) => void appendLog(id, line));
        // A saved character prepared in My characters brings its pose, description, pose sheet, palette and build.
        const kit = await findCharacterKit(input.ownerId, sha256(await readFile(character))).catch(() => null);
        await initRun(path.join(dir, "work-init"), { video, character, fps: options.fps, start: options.start, seconds, maxAttempts: ROTOSCOPE_LIMITS.maxAttempts, ownerId: input.ownerId, name: state.name, measures, poseSheet: state.poseSheet, kit: kit ? { dir: kit.dir, body: kitFitsBody(kit, measures) } : null }, (line) => void appendLog(id, line))
          .then(() => moveInto(path.join(dir, "work-init"), dir));
        // A saved character (sent front-on) without animation data in My characters gets this run's analysis.
        if (!kit && input.frontOn) {
          await fillCharacterKitFromRun(input.ownerId, dir, { heightCm: measures.heightCm, weightKg: measures.weightKg }, (line) => void appendLog(id, line))
            .catch((error: unknown) => void appendLog(id, `Couldn’t save the character’s analysis to My characters (${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}); the run goes on.`));
        }
        await updateState(id, (current) => ({ ...current, phase: "ready" }));
      } catch (error) {
        await updateState(id, (current) => ({ ...current, phase: "failed", error: friendly(error) }));
        return;
      }
      // A test batch draws its first frames once each, as soon as it is prepared.
      if (state.batchFrames && !signal.aborted) {
        await updateState(id, (current) => ({ ...current, phase: "generating", live: null }));
        await drawRun(id, signal, { frames: state.batchFrames, attempts: 1, renderer: "muse", dual, poseSheet: state.poseSheet });
      }
    });
    return view(state, null);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A test batch: one video and up to MAX_BATCH_CHARACTERS characters, one run each, prepared side by side; each draws
 * only its first `frames` frames, once each per round (with Higgsfield too when `dual`). The video is stored once and linked.
 */
export async function createBatch(input: { readonly ownerId: string; readonly video: File; readonly characters: readonly { readonly file: File; readonly name: string; readonly frontOn: boolean; readonly measures: CharacterMeasures | null }[]; readonly options: z.input<typeof CreateRunSchema>; readonly poseSheet: boolean; readonly frames: number; readonly dual: boolean }): Promise<RotoscopeBatch> {
  if (input.dual && !higgsfieldConfigured()) throw new AppError("higgsfield_unconfigured", 422, "Comparing with Higgsfield needs it configured on this server (HF_CREDENTIALS).");
  if (!input.characters.length || input.characters.length > MAX_BATCH_CHARACTERS) throw new AppError("INPUT_INVALID", 400, `Choose one to ${MAX_BATCH_CHARACTERS} characters.`);
  const batch = randomUUID();
  const scratch = path.join(runsRoot(), `.batch-${batch}`);
  await mkdir(scratch, { recursive: true });
  try {
    const stored = path.join(scratch, `video${(path.extname(input.video.name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/)?.[0]) ?? ".mp4"}`);
    await writeFile(stored, Buffer.from(await input.video.arrayBuffer()));
    const video = { path: stored, name: input.video.name };
    const base = input.options.name || path.basename(input.video.name, path.extname(input.video.name)).slice(0, 50) || "Batch";
    const runs: RotoscopeRun[] = [];
    for (const character of input.characters) {
      runs.push(await createRun({
        ownerId: input.ownerId, video, character: character.file, frontOn: character.frontOn, measures: character.measures, poseSheet: input.poseSheet, batch, batchFrames: input.frames, dual: input.dual,
        options: { ...input.options, name: `${base} · ${character.name}`.slice(0, 80) },
      }));
    }
    return { id: batch, runs };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Every run of a test batch, as the batch view shows them. */
export async function getBatch(batch: string, ownerId: string): Promise<RotoscopeBatch> {
  const runs: RotoscopeRun[] = [];
  for (const name of await readdir(runsRoot()).catch(() => [] as string[])) {
    if (!RotoscopeIdSchema.safeParse(name).success) continue;
    const state = await readState(name).catch(() => null);
    if (state?.ownerId === ownerId && state.batch === batch) runs.push(await getRun(name, ownerId));
  }
  if (!runs.length) throw new AppError("batch_not_found", 404, "This test batch doesn’t exist.");
  return { id: batch, runs: runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

/** Another round of a test batch: every idle run draws its first frames once more each. */
export async function drawBatch(batch: string, ownerId: string, gate: () => Promise<void>): Promise<RotoscopeBatch> {
  const { runs } = await getBatch(batch, ownerId);
  const idle = runs.filter((run) => run.phase === "ready" && run.total > 0);
  if (!idle.length) throw new AppError("run_busy", 409, "Every run of this batch is still working.");
  await gate();
  for (const run of idle) {
    const state = await ownedState(run.id, ownerId);
    await startGeneration(run.id, ownerId, async () => undefined, { frames: Math.min(state.batchFrames ?? 1, run.total), attempts: 1, renderer: "muse" });
  }
  return getBatch(batch, ownerId);
}

/**
 * Whatever angle or pose the upload has, the run is measured and redrawn from the character facing
 * the camera in a neutral pose. The upload is kept as input/character-original.png; if the model
 * can't redraw it, the run goes on with the upload as it was.
 */
async function frontOnCharacter(character: string, signal: AbortSignal, log: (line: string) => void): Promise<void> {
  try {
    log("Redrawing the character front-on in a neutral pose…");
    const original = await readFile(character);
    const front = await drawFrontView({ png: original, signal });
    const sheet = await characterSheet(front);
    await cp(character, path.join(path.dirname(character), "character-original.png"));
    await writeFile(character, sheet);
  } catch (error) {
    if (signal.aborted) throw error;
    log(`Couldn’t redraw the character front-on (${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}); using the image as uploaded.`);
  }
}

/** Preparation writes into a scratch folder; only a complete run lands next to run.json. */
async function moveInto(from: string, to: string): Promise<void> {
  for (const name of await readdir(from)) await rename(path.join(from, name), path.join(to, name));
  await rm(from, { recursive: true, force: true });
}

const PHASE_BUSY: Partial<Record<RotoscopePhase, string>> = {
  preparing: "This run is still being prepared.",
  extending: "This run is adding frames. Try again in a moment.",
  generating: "This run is already drawing.",
  stopping: "This run is stopping. Try again in a moment.",
  failed: "This run couldn’t be prepared. Delete it and create it again.",
};

/** Draws from the first open frame; approved frames are never drawn again unless a pencil note reopened them. */
export async function startGeneration(id: string, ownerId: string, gate: () => Promise<void>, options: { dual?: boolean; only?: number; renderer?: Renderer; prompt?: string; attempts?: number; /** Frames 1 to this, each drawn once more (a test batch's round). */ frames?: number } = {}): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (PHASE_BUSY[state.phase]) throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  const dual = options.dual ?? state.dual;
  if (dual && !higgsfieldConfigured()) throw new AppError("higgsfield_unconfigured", 422, "Two drawings per attempt need Higgsfield, and it isn’t configured on this server (HF_CREDENTIALS).");
  const manifest = await readManifest(runDir(id));
  const only = options.only;
  // `only` redraws one frame, approved or not; without it the run draws what is still open.
  if (only !== undefined && !manifest.frames.some((frame) => frame.index === only)) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  if (only === undefined && manifest.frames.every((frame) => frame.status === "approved")) throw new AppError("run_complete", 409, "Every frame is already approved.");
  await gate();
  // A prompt under test is a setting of that one drawing, not of the run.
  const renderer = options.renderer ?? state.renderer;
  await updateState(id, (current) => ({ ...current, phase: "generating", error: null, live: null, dual, ...(options.prompt ? {} : { renderer }) }));
  start(id, (signal) => drawRun(id, signal, { dual, only, frames: options.frames, renderer: options.prompt ? "muse" : renderer, prompt: options.prompt, attempts: options.attempts, poseSheet: state.poseSheet }));
  return getRun(id, ownerId);
}

/** The drawing itself, in the run's background job: the run is "generating" when it starts and "ready" when it ends. */
async function drawRun(id: string, signal: AbortSignal, options: { dual?: boolean; only?: number; frames?: number; renderer: Renderer; prompt?: string; attempts?: number; poseSheet: boolean }): Promise<void> {
  const { only } = options;
  try {
    const onLive = (event: LiveEvent) => void updateState(id, (current) => ({
      ...current,
      live: { ...event, image: event.stage !== "drawing" && event.stage !== "measuring", at: new Date().toISOString() },
    })).catch(() => undefined);
    if (options.prompt) await appendLog(id, `frame ${only}: drawing once with your prompt from the debug panel`);
    const draw = (frame: number | undefined) => generateRun(runDir(id), { signal, onLive, dual: options.dual, only: frame, renderer: options.renderer, prompt: options.prompt, attempts: options.attempts, poseSheet: options.poseSheet, log: (line) => void appendLog(id, line) });
    // A batch round: each of its frames drawn once more, approved or not, one after the other.
    let outcome = await draw(options.frames ? 1 : only);
    for (let frame = 2; options.frames && frame <= options.frames && !signal.aborted; frame++) outcome = await draw(frame);
    const summary = outcome.kind === "complete" ? `all ${outcome.approved} frames approved`
      : outcome.kind === "partial" ? `${outcome.approved} frames approved; frame${outcome.failed.length === 1 ? "" : "s"} ${outcome.failed.join(", ")} didn’t pass and stay open`
      : outcome.kind === "halted" ? `FIREWALL: stopped at frame ${outcome.frame}`
        : outcome.kind === "stopped" ? `stopped by you at frame ${outcome.frame}` : `paused at frame ${outcome.next}`;
    await appendLog(id, summary);
    // One test drawing that misses a check is a result to look at, not a failure of the run.
    const tested = options.prompt || options.attempts === 1 || options.frames;
    await updateState(id, (current) => ({
      ...current,
      phase: "ready",
      live: null,
      ...(only !== undefined && outcome.kind === "halted" && !tested ? { error: `Frame ${only} couldn’t be redrawn, so its earlier drawing was kept.` } : {}),
    }));
  } catch (error) {
    await updateState(id, (current) => ({ ...current, phase: "ready", live: null, error: error instanceof AppError ? error.message : `Drawing stopped: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }));
  }
}

async function videoHasAudio(id: string): Promise<boolean | null> {
  const manifest = await readManifest(runDir(id)).catch(() => null);
  if (!manifest || !existsSync(manifest.video)) return null;
  const facts = await probe(manifest.video, true).catch(() => null);
  return facts ? facts.streams.some((stream) => stream.codec_type === "audio") : null;
}

/** The video's sound from the run's start to its end (or `seconds` of it), as AAC: frame N plays at (N - 1) / fps into this clip. */
async function cutSound(id: string, to: string, seconds?: number): Promise<void> {
  const manifest = await readManifest(runDir(id));
  if (!existsSync(manifest.video)) throw new AppError("video_missing", 409, "This run’s video is no longer available, so its sound can’t be used.");
  const partial = `${to}.${randomUUID()}.part.m4a`;
  try {
    await ffmpeg(["-ss", String(manifest.start), ...(seconds ? ["-t", String(seconds)] : []), "-i", manifest.video, "-vn", "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "128k", partial], 300_000);
    await rename(partial, to);
  } catch (error) {
    await rm(partial, { force: true });
    if (error instanceof AppError) throw error;
    throw new AppError("no_audio", 422, "This video has no sound to use.");
  }
}

/** The reference sound, cut on first use and kept next to the video. */
async function soundClip(id: string): Promise<string> {
  const clip = path.join(runDir(id), "input", "sound.m4a");
  if (!existsSync(clip)) await cutSound(id, clip);
  return clip;
}

async function videoDuration(id: string): Promise<number | null> {
  const manifest = await readManifest(runDir(id)).catch(() => null);
  if (!manifest || !existsSync(manifest.video)) return null;
  const duration = Number((await probe(manifest.video, true).catch(() => null))?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/**
 * Adds the next `seconds` of the video after the run's last frame as open frames, so a long
 * clip is animated a piece at a time. Local work only (FFmpeg and DWPose, no AI call); the
 * approved frames stay. Drawing the new frames is a separate generate.
 */
export async function extendRunBy(id: string, ownerId: string, seconds: number): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (PHASE_BUSY[state.phase]) throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  if (!poseToolAvailable()) throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server.");
  const manifest = await readManifest(runDir(id));
  const duration = state.duration ?? await videoDuration(id);
  if (duration === null) throw new AppError("video_missing", 409, "This run’s video is no longer available, so no more frames can be added.");
  const covered = manifest.frames.length / manifest.fps;
  const left = duration - (manifest.start + covered);
  if (left < 0.5 / manifest.fps) throw new AppError("video_end", 409, "The run already reaches the end of the video.");
  const room = Math.min(ROTOSCOPE_LIMITS.maxSeconds - covered, (ROTOSCOPE_LIMITS.maxFrames - manifest.frames.length) / manifest.fps);
  if (room < 1 / manifest.fps) throw new AppError("segment_too_long", 422, `One run covers at most ${ROTOSCOPE_LIMITS.maxSeconds} s and ${ROTOSCOPE_LIMITS.maxFrames} frames. Start a new run for the rest of the video.`);
  const length = Math.min(seconds, left, room);
  await updateState(id, (current) => ({ ...current, phase: "extending", error: null, duration }));
  start(id, async () => {
    try {
      const added = await extendRun(runDir(id), length, duration, (line) => void appendLog(id, line));
      const after = await readManifest(runDir(id));
      await updateState(id, (current) => ({ ...current, phase: "ready", seconds: after.seconds, ...(added ? {} : { error: "The video has no more frames after this run." }) }));
    } catch (error) {
      await updateState(id, (current) => ({ ...current, phase: "ready", error: `Couldn’t add frames: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }));
    }
  });
  return getRun(id, ownerId);
}

/**
 * The name is only a label: it can change while the run is drawing. New measures reach the next drawing's prompt;
 * the size the drawings are placed at follows them once the run is refitted (refit).
 */
export async function updateRun(id: string, ownerId: string, input: { name?: string; measures?: CharacterMeasures }): Promise<RotoscopeRun> {
  await ownedState(id, ownerId);
  if (input.measures) await writeFile(path.join(runDir(id), MEASURES_FILE), `${JSON.stringify(input.measures, null, 2)}\n`);
  await updateState(id, (current) => ({ ...current, ...(input.name ? { name: input.name } : {}), ...(input.measures ? { measures: input.measures } : {}) }));
  return getRun(id, ownerId);
}

/**
 * Lays the run out again on the video person's own figure (times the measures' height ratio) and moves every
 * drawing onto it: local work, no AI call (pipeline.ts refitRun). The old files are kept beside the new ones.
 */
export async function refit(id: string, ownerId: string): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  if (runtime.running.has(id)) throw new AppError("run_busy", 409, "This run is already working.");
  const controller = new AbortController();
  runtime.running.set(id, controller);
  try {
    const moved = await refitRun(runDir(id), (line) => void appendLog(id, line));
    await appendLog(id, `refitted to the video person: ${moved} frame${moved === 1 ? "" : "s"} moved to the new size`);
  } catch (error) {
    throw new AppError("refit_failed", 500, `The run couldn’t be refitted: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  } finally {
    runtime.running.delete(id);
  }
  return getRun(id, ownerId);
}

// ── Prompt debugging ───────────────────────────────────────────────────────

/** A frame's Muse Image prompt: the one an attempt was drawn with, else the one its next drawing gets. No AI call. */
export async function framePrompt(id: string, ownerId: string, frame: number, attempt: number | null): Promise<FramePrompt> {
  const state = await ownedState(id, ownerId);
  if (state.phase === "preparing" || state.phase === "failed") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  const manifest = await readManifest(runDir(id));
  if (!manifest.frames.some((entry) => entry.index === frame)) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  const { prompt, images, sent } = await framePromptOf(runDir(id), frame, attempt);
  return { prompt, images: [...images], sent };
}

/** Muse Spark reads an edited prompt against the frame's images and an attempt's drawing: what is wrong and a rewrite. */
export async function analyzePrompt(id: string, ownerId: string, input: { frame: number; attempt: number | null; prompt: string }): Promise<PromptAnalysis> {
  const state = await ownedState(id, ownerId);
  if (state.phase === "preparing" || state.phase === "failed") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  try {
    const analysis = await analyzeFramePrompt(runDir(id), input.frame, input.attempt, input.prompt);
    return { ...analysis, issues: analysis.issues.map((issue) => ({ ...issue })) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("analysis_failed", 502, `The prompt couldn’t be analysed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  }
}

export async function stopGeneration(id: string, ownerId: string): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "generating") throw new AppError("run_idle", 409, "This run isn’t drawing.");
  await updateState(id, (current) => ({ ...current, phase: "stopping" }));
  runtime.running.get(id)?.abort();
  return getRun(id, ownerId);
}

export async function approveAttempt(id: string, ownerId: string, frame: number, attempt: number): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  try {
    await approveManually(runDir(id), frame, attempt);
  } catch (error) {
    throw new AppError("approve_failed", 409, error instanceof Error ? error.message : "That attempt can’t be approved.");
  }
  await appendLog(id, `frame ${frame} approved by you (attempt ${attempt})`);
  return getRun(id, ownerId);
}

/**
 * A pencil note on one drawing: the person's red marks (a transparent PNG at
 * the drawing's size) over that attempt, and what to change. The frame opens
 * again if it was approved; the next run redraws it with the note.
 */
export async function correctFrame(id: string, ownerId: string, input: { frame: number; attempt: number; comment: string; marks: Buffer }): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  const dir = runDir(id);
  const manifest = await readManifest(dir);
  const record = manifest.frames.find((entry) => entry.index === input.frame)?.attempts.find((entry) => entry.attempt === input.attempt);
  if (!record) throw new AppError("attempt_not_found", 404, "That drawing doesn’t exist any more.");
  let marks: Buffer;
  try {
    marks = await sharp(input.marks, { failOn: "error" }).ensureAlpha().resize(CANVAS.width, CANVAS.height, { fit: "fill" }).png().toBuffer();
  } catch {
    throw new AppError("INPUT_INVALID", 400, "We couldn’t read your pencil marks. Draw them again.");
  }
  // On light grey, so the marks and a white shirt both read.
  const marked = await sharp(await readFile(path.join(dir, record.file))).resize(CANVAS.width, CANVAS.height, { fit: "fill" })
    .flatten({ background: "#e4e4e4" }).composite([{ input: marks, left: 0, top: 0 }]).png().toBuffer();
  try {
    await requestCorrection(dir, input.frame, { comment: input.comment, attempt: input.attempt }, marked);
  } catch (error) {
    throw new AppError("correction_failed", 409, error instanceof Error ? error.message : "That note couldn’t be saved.");
  }
  await appendLog(id, `frame ${input.frame}: your note on attempt ${input.attempt} — “${input.comment.slice(0, 80)}”`);
  return getRun(id, ownerId);
}

/** Redraws the run's pose guides with the current guide code (the old ones are kept on disk); approved frames stay. */
export async function rebuildGuides(id: string, ownerId: string): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  if (!poseToolAvailable()) throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server.");
  await reguideRun(runDir(id)).catch((error: unknown) => { throw new AppError("guides_failed", 500, `The pose guides couldn’t be redrawn: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`); });
  await appendLog(id, "pose guides redrawn; frames drawn from now on use them");
  return getRun(id, ownerId);
}

export async function deleteRun(id: string, ownerId: string): Promise<void> {
  const state = await ownedState(id, ownerId);
  if (runtime.running.has(id) || state.phase === "generating" || state.phase === "preparing") throw new AppError("run_busy", 409, "Stop this run before deleting it.");
  await rm(runDir(id), { recursive: true, force: true });
}

/** Flipbook's own clock: whole seconds at 24 drawings per second. */
const FLIPBOOK_FPS = SEQUENCE_CLOCK;
const FLIPBOOK_MAX_SECONDS = MAX_SEQUENCE_FRAMES / SEQUENCE_CLOCK;

/**
 * The run's approved frames, copied into a new Flipbook: the one-way bridge
 * out of the sandbox. Flipbook plays whole seconds at 24 drawings/s, so the
 * approved prefix is resampled to it by holding the nearest Rotoscope frame
 * (no new AI work: each copy is cut out from its own transparency locally).
 */
export async function openInFlipbook(id: string, ownerId: string, options: { sound?: boolean } = {}): Promise<{ flipbookId: string }> {
  const state = await ownedState(id, ownerId);
  if (PHASE_BUSY[state.phase]) throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  const manifest = await readManifest(runDir(id));
  // From the first frame to the last approved one: a frame the run went past without approving holds the drawing before it.
  const lastApproved = manifest.frames.findLastIndex((frame) => frame.status === "approved" && frame.approved);
  const approved: string[] = [];
  for (const frame of manifest.frames.slice(0, lastApproved + 1)) {
    if (frame.status === "approved" && frame.approved) approved.push(path.join(runDir(id), frame.approved.file));
    else if (approved.length) approved.push(approved[approved.length - 1]);
    else break;
  }
  const seconds = Math.min(FLIPBOOK_MAX_SECONDS, Math.floor(approved.length / state.fps));
  if (seconds < 1) {
    const needed = Math.ceil(state.fps);
    throw new AppError("not_enough_frames", 409, `Flipbook works in whole seconds. Approve ${needed} frames to open this run in Flipbook.`);
  }
  // The first `seconds` of the approved prefix, held at Flipbook's 24ths.
  const source = approved.slice(0, seconds * state.fps);
  const frames = Array.from({ length: seconds * FLIPBOOK_FPS }, (_, tick) => source[Math.min(source.length - 1, Math.floor((tick * state.fps) / FLIPBOOK_FPS))]);
  // The sound of the same seconds the frames cover, so it lines up with them from the start.
  const sound = options.sound && state.audio !== false ? path.join(runDir(id), "input", `flipbook-sound-${seconds}.m4a`) : null;
  if (sound && !existsSync(sound)) await cutSound(id, sound, seconds);
  const flipbook = await importSequence({
    ownerId,
    title: `${state.name} · ${seconds} s`,
    character: await readFile(path.join(runDir(id), "input", "character.png")),
    frames,
    sequence: { durationSeconds: seconds, drawingFps: FLIPBOOK_FPS },
    importedFrom: { kind: "rotoscope", runId: id, fps: state.fps },
    ...(sound ? { audio: { file: sound, name: `${state.name} · sound` } } : {}),
  });
  await appendLog(id, `opened in Flipbook as ${seconds} s (${frames.length} drawings${sound ? ", with sound" : ""})`);
  return { flipbookId: flipbook.id };
}

/**
 * Copies a console run (pnpm rotoscope …) into an account, so it opens in the app. The console run is left as it was.
 * With `batch` it joins that test batch, whose rounds draw `batchFrames` frames (with Higgsfield too when `dual`).
 */
export async function importConsoleRun(source: string, ownerId: string, options: { batch?: string; batchFrames?: number; dual?: boolean } = {}): Promise<RotoscopeRun> {
  const manifest = await readManifest(source);
  const id = randomUUID();
  const dir = runDir(id);
  await cp(source, dir, { recursive: true, filter: (from) => !from.endsWith("run.lock") });
  const state: State = {
    id, ownerId, name: manifest.name ?? path.basename(source), createdAt: manifest.createdAt, phase: "ready", error: null, live: null,
    log: [`imported from the console run ${path.basename(source)}`], fps: manifest.fps, start: manifest.start, seconds: manifest.seconds, duration: null, dual: false, audio: null, renderer: "auto",
    measures: await readFile(path.join(source, MEASURES_FILE), "utf8").then((text) => CharacterMeasuresSchema.parse(JSON.parse(text)), () => ({ heightCm: null, weightKg: null, personHeightCm: null })),
    poseSheet: true, batch: options.batch ?? null, batchFrames: options.batch ? options.batchFrames ?? 1 : null,
    ...(options.dual ? { dual: true, renderer: "muse" as const } : {}),
  };
  await writeAtomic(statePath(id), `${JSON.stringify(state, null, 2)}\n`);
  // The app serves the character from input/, where its own uploads keep it.
  await mkdir(path.join(dir, "input"), { recursive: true });
  await cp(path.join(dir, "character.png"), path.join(dir, "input", "character.png"));
  return getRun(id, ownerId);
}

// ── Character mapping ──────────────────────────────────────────────────────

/** An attempt's mapping diagnostics and the frame's joint corrections, for the overlay inspector. */
export async function getMapping(id: string, ownerId: string, frame: number, attempt: number): Promise<MappingView> {
  await ownedState(id, ownerId);
  const dir = runDir(id);
  const manifest = await readManifest(dir);
  if (!manifest.frames.some((entry) => entry.index === frame)) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  const overrides = (await readOverrides(dir)).frames?.[String(frame)]?.joints ?? {};
  const kept = (kind: keyof typeof REVIEW_PICTURE) => existsSync(path.join(dir, "work", `${frameName(frame).replace(".png", "")}_a${attempt}_${REVIEW_PICTURE[kind]}.png`));
  return { diagnostics: await readDiagnostics(dir, frame, attempt) as MappingView["diagnostics"], overrides: overrides as MappingView["overrides"], canvas: CANVAS, review: { overlay: kept("overlay"), build: kept("build"), scan: kept("scan") } };
}

/**
 * A person moved target joints in the inspector: the frame's next drawing deforms to them.
 * An empty set clears the frame's corrections. Approved frames stay approved; the person
 * redraws the frame to use the correction.
 */
export async function correctMapping(id: string, ownerId: string, input: { frame: number; joints: Partial<Record<MappingJoint, readonly [number, number]>> }): Promise<MappingView> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  const dir = runDir(id);
  const manifest = await readManifest(dir);
  const entry = manifest.frames.find((candidate) => candidate.index === input.frame);
  if (!entry) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  const overrides = await readOverrides(dir);
  const joints = Object.fromEntries(Object.entries(input.joints).filter(([name]) => (MAPPING_JOINTS as readonly string[]).includes(name)));
  const frames = { ...overrides.frames };
  if (Object.keys(joints).length) frames[String(input.frame)] = { joints };
  else delete frames[String(input.frame)];
  await writeOverrides(dir, { ...overrides, frames });
  await appendLog(id, Object.keys(joints).length ? `frame ${input.frame}: your mapping correction (${Object.keys(joints).join(", ")}) for its next drawing` : `frame ${input.frame}: mapping corrections cleared`);
  return getMapping(id, ownerId, input.frame, entry.approved?.attempt ?? entry.attempts.at(-1)?.attempt ?? 1);
}

/** Measures the frame's attempts that have no mapping diagnostics (drawn before the engine): DWPose locally, no AI call. */
export async function diagnoseMapping(id: string, ownerId: string, frame: number, attempt: number): Promise<MappingView> {
  const state = await ownedState(id, ownerId);
  if (state.phase !== "ready") throw new AppError("run_busy", 409, PHASE_BUSY[state.phase] ?? "This run is busy.");
  if (!poseToolAvailable()) throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server.");
  if (runtime.running.has(id)) throw new AppError("run_busy", 409, "This run is already working.");
  const controller = new AbortController();
  runtime.running.set(id, controller);
  try {
    await diagnoseFrame(runDir(id), frame);
  } catch (error) {
    throw new AppError("diagnose_failed", 500, `The mapping couldn’t be measured: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  } finally {
    runtime.running.delete(id);
  }
  return getMapping(id, ownerId, frame, attempt);
}

// ── Media ──────────────────────────────────────────────────────────────────

/** The file each review picture is kept under, next to the attempt it belongs to. */
const REVIEW_PICTURE = { overlay: "review_overlay", build: "review_build", scan: "scan" } as const;

/** Only files the run's own state names are served. */
export async function mediaFile(id: string, ownerId: string, kind: RotoscopeMedia, frame?: number, attempt?: number, by?: GeneratorName): Promise<string> {
  const state = await ownedState(id, ownerId);
  const dir = runDir(id);
  const missing = () => new AppError("media_not_found", 404, "This file is no longer available.");
  if (kind === "character") return path.join(dir, "input", "character.png");
  if (kind === "posesheet") {
    if (!existsSync(path.join(dir, POSE_SHEET))) throw missing();
    return path.join(dir, POSE_SHEET);
  }
  if (kind === "scaled") {
    // Made the first time it is asked for, or when drawing starts; the sheet as it is when the clip's poses aren't there yet.
    const scaled = path.join(dir, SCALED_CHARACTER);
    if (!existsSync(scaled)) await scaledCharacter(dir).catch(() => null);
    return existsSync(scaled) ? scaled : path.join(dir, "input", "character.png");
  }
  if (kind === "exposed" || kind === "labels" || kind === "mask") {
    // Only files an attempt's own diagnostics name.
    const record = frame && attempt ? await readDiagnostics(dir, frame, attempt) : null;
    const file = kind === "exposed" ? record?.masks.exposed : kind === "labels" ? record?.masks.labels : record?.masks.character;
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw missing();
    return path.join(dir, file);
  }
  if (kind === "overlay" || kind === "build" || kind === "scan") {
    // Kept beside the attempt in work/ when it was reviewed (pipeline.ts validate).
    if (!frame || !attempt) throw missing();
    const file = path.join(dir, "work", `${frameName(frame).replace(".png", "")}_a${attempt}_${REVIEW_PICTURE[kind]}.png`);
    if (!existsSync(file)) throw missing();
    return file;
  }
  if (kind === "drawn") {
    // Each generator's cut-out, kept in work/ when an attempt was drawn by two (pipeline.ts measure).
    if (!frame || !attempt || !by) throw missing();
    const file = path.join(dir, "work", `${frameName(frame).replace(".png", "")}_a${attempt}_${by}_keyed.png`);
    if (!existsSync(file)) throw missing();
    return file;
  }
  if (kind === "audio") {
    if (state.audio === false) throw missing();
    return soundClip(id);
  }
  const manifest = await readManifest(dir).catch(() => null);
  const entry = manifest?.frames.find((candidate) => candidate.index === frame);
  if (!entry) throw missing();
  if (kind === "source") return path.join(dir, entry.source);
  if (kind === "guide") return path.join(dir, "guides", frameName(entry.index));
  if (kind === "correction") {
    if (!entry.correction) throw missing();
    return path.join(dir, entry.correction.marked);
  }
  if (kind === "frame") {
    if (!entry.approved) throw missing();
    return path.join(dir, entry.approved.file);
  }
  const record = entry.attempts.find((candidate) => candidate.attempt === attempt);
  if (record) return path.join(dir, record.file);
  // The attempt being checked right now: drawn and cut out, not yet in the manifest.
  if (state.live?.image && state.live.frame === entry.index && state.live.attempt === attempt) return path.join(dir, attemptFile(entry.index, attempt));
  throw missing();
}

/** The approved drawings as transparent PNGs, named by frame. */
export async function exportZip(id: string, ownerId: string): Promise<{ data: Buffer; name: string }> {
  const state = await ownedState(id, ownerId);
  const manifest = await readManifest(runDir(id));
  const approved = manifest.frames.filter((frame) => frame.approved);
  if (!approved.length) throw new AppError("nothing_to_export", 409, "No frame is approved yet.");
  const entries = await Promise.all(approved.map(async (frame) => ({ name: frameName(frame.index), data: await readFile(path.join(runDir(id), frame.approved!.file)) })));
  return { data: writeZip(entries), name: `${state.name.replace(/[^\w.-]+/g, "_") || "rotoscope"}_${manifest.fps}fps.zip` };
}
