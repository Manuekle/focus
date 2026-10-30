import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { rotoscopeEnabled } from "../../shared/features";
import { MAX_SEQUENCE_FRAMES, SEQUENCE_CLOCK } from "../../shared/sequence";
import {
  ROTOSCOPE_LIMITS,
  RotoscopeIdSchema,
  RotoscopeLiveSchema,
  type RotoscopeMedia,
  type RotoscopePhase,
  type RotoscopeRun,
  type RotoscopeRunSummary,
} from "../../shared/rotoscope";
import { AppError } from "../errors";
import { probe } from "../ffmpeg";
import { importSequence } from "../animation/flipbooks";
import { decodeImage } from "../animation/image-input";
import { readJsonFile, writeAtomic } from "../animation/store";
import { writeZip } from "../animation/zip";
import { frameName } from "./extract";
import { CANVAS } from "./draw";
import { higgsfieldConfigured } from "./higgsfield";
import { generateRun, initRun, poseToolAvailable, reguideRun, runsRoot, type LiveEvent } from "./pipeline";
import { approveManually, attemptFile, readManifest, requestCorrection, type Manifest } from "./run-state";

// Rotoscope runs in the app: one folder per run under FOCUS_DATA_DIR/rotoscope,
// owned by an account. Preparing and drawing run in the background in this
// process (one dispatcher per run on globalThis, like the other job types);
// the manifest is the source of truth for frames, and run.json holds the rest.

const StateSchema = z.object({
  id: RotoscopeIdSchema,
  ownerId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  phase: z.enum(["preparing", "ready", "generating", "stopping", "failed"]),
  error: z.string().nullable(),
  log: z.array(z.string()),
  live: RotoscopeLiveSchema.nullable().default(null),
  fps: z.number(),
  start: z.number(),
  seconds: z.number().nullable(),
  /** Draw every attempt with Muse Image and Higgsfield and keep the closer one. */
  dual: z.boolean().default(false),
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
  if ((state.phase === "preparing" || state.phase === "generating" || state.phase === "stopping") && !runtime.running.has(id)) {
    return updateState(id, (current) => current.phase === "preparing"
      ? { ...current, phase: "failed", error: "Preparation was interrupted. Delete this run and create it again." }
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

function view(state: State, manifest: Manifest | null): RotoscopeRun {
  const frames = (manifest?.frames ?? []).map((frame) => ({
    index: frame.index,
    status: frame.status,
    attempts: frame.attempts.map((attempt) => ({ attempt: attempt.attempt, at: attempt.at, passed: attempt.passed, checks: attempt.checks.map(({ name, passed, detail }) => ({ name, passed, detail })) })),
    approvedAttempt: frame.approved?.attempt ?? null,
    manual: Boolean(frame.approved?.manual),
    correction: frame.correction ? { comment: frame.correction.comment, attempt: frame.correction.attempt, at: frame.correction.at } : null,
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
    maxAttempts: manifest?.maxAttempts ?? ROTOSCOPE_LIMITS.maxAttempts,
    error: state.error,
    halted: manifest?.halted ? { frame: manifest.halted.frame, reason: manifest.halted.reason } : null,
    live: state.phase === "generating" || state.phase === "stopping" ? state.live : null,
    log: state.log,
    frames,
    dual: state.dual && higgsfieldConfigured(),
    dualAvailable: higgsfieldConfigured(),
    guidesVersion: "",
  };
}

export async function getRun(id: string, ownerId: string): Promise<RotoscopeRun> {
  const state = await ownedState(id, ownerId);
  const manifest = existsSync(path.join(runDir(id), "manifest.json")) ? await readManifest(runDir(id)) : null;
  const guides = await stat(path.join(runDir(id), "guides", "guides.json")).catch(() => null);
  return { ...view(state, manifest), guidesVersion: guides ? String(Math.round(guides.mtimeMs)) : "" };
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

/** Stores the original video (frames must match the user's own export) and the character, then prepares in the background. */
export async function createRun(input: { ownerId: string; video: File; character: File; options: z.input<typeof CreateRunSchema> }): Promise<RotoscopeRun> {
  if (!poseToolAvailable()) throw new AppError("pose_unavailable", 503, "Pose detection (DWPose) isn’t installed on this server, so rotoscope runs can’t be prepared here.");
  const options = CreateRunSchema.parse(input.options);
  const id = randomUUID();
  const dir = runDir(id);
  const inputs = path.join(dir, "input");
  await mkdir(inputs, { recursive: true });
  try {
    const extension = (path.extname(input.video.name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/)?.[0]) ?? ".mp4";
    const video = path.join(inputs, `video${extension}`);
    await writeFile(video, Buffer.from(await input.video.arrayBuffer()));
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
    const decoded = await decodeImage(Buffer.from(await input.character.arrayBuffer()), { minDimension: 256 });
    // Measured against a light background (grid.ts figureBox), so transparency becomes white.
    const character = path.join(inputs, "character.png");
    await sharp(decoded.flat).flatten({ background: "#ffffff" }).png().toFile(character);
    const state: State = {
      id, ownerId: input.ownerId,
      name: options.name || path.basename(input.video.name, path.extname(input.video.name)).slice(0, 80) || "Rotoscope",
      createdAt: new Date().toISOString(), phase: "preparing", error: null, log: [], live: null, fps: options.fps, start: options.start, seconds, dual: false,
    };
    await writeAtomic(statePath(id), `${JSON.stringify(state, null, 2)}\n`);
    start(id, async () => {
      try {
        await initRun(path.join(dir, "work-init"), { video, character, fps: options.fps, start: options.start, seconds, maxAttempts: ROTOSCOPE_LIMITS.maxAttempts, ownerId: input.ownerId, name: state.name }, (line) => void appendLog(id, line))
          .then(() => moveInto(path.join(dir, "work-init"), dir));
        await updateState(id, (current) => ({ ...current, phase: "ready" }));
      } catch (error) {
        await updateState(id, (current) => ({ ...current, phase: "failed", error: friendly(error) }));
      }
    });
    return view(state, null);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Preparation writes into a scratch folder; only a complete run lands next to run.json. */
async function moveInto(from: string, to: string): Promise<void> {
  for (const name of await readdir(from)) await rename(path.join(from, name), path.join(to, name));
  await rm(from, { recursive: true, force: true });
}

const PHASE_BUSY: Partial<Record<RotoscopePhase, string>> = {
  preparing: "This run is still being prepared.",
  generating: "This run is already drawing.",
  stopping: "This run is stopping. Try again in a moment.",
  failed: "This run couldn’t be prepared. Delete it and create it again.",
};

/** Draws from the first open frame; approved frames are never drawn again unless a pencil note reopened them. */
export async function startGeneration(id: string, ownerId: string, gate: () => Promise<void>, options: { dual?: boolean; only?: number } = {}): Promise<RotoscopeRun> {
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
  await updateState(id, (current) => ({ ...current, phase: "generating", error: null, live: null, dual }));
  start(id, async (signal) => {
    try {
      const onLive = (event: LiveEvent) => void updateState(id, (current) => ({
        ...current,
        live: { ...event, image: event.stage !== "drawing" && event.stage !== "measuring", at: new Date().toISOString() },
      })).catch(() => undefined);
      const outcome = await generateRun(runDir(id), { signal, onLive, dual, only, log: (line) => void appendLog(id, line) });
      const summary = outcome.kind === "complete" ? `all ${outcome.approved} frames approved`
        : outcome.kind === "halted" ? `FIREWALL: stopped at frame ${outcome.frame}`
          : outcome.kind === "stopped" ? `stopped by you at frame ${outcome.frame}` : `paused at frame ${outcome.next}`;
      await appendLog(id, summary);
      await updateState(id, (current) => ({
        ...current,
        phase: "ready",
        live: null,
        ...(only !== undefined && outcome.kind === "halted" ? { error: `Frame ${only} couldn’t be redrawn, so its earlier drawing was kept.` } : {}),
      }));
    } catch (error) {
      await updateState(id, (current) => ({ ...current, phase: "ready", live: null, error: error instanceof AppError ? error.message : `Drawing stopped: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }));
    }
  });
  return getRun(id, ownerId);
}

/** The name is only a label: it can change while the run is drawing. */
export async function renameRun(id: string, ownerId: string, name: string): Promise<RotoscopeRun> {
  await ownedState(id, ownerId);
  await updateState(id, (current) => ({ ...current, name }));
  return getRun(id, ownerId);
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
export async function openInFlipbook(id: string, ownerId: string): Promise<{ flipbookId: string }> {
  const state = await ownedState(id, ownerId);
  if (PHASE_BUSY[state.phase]) throw new AppError("run_busy", 409, PHASE_BUSY[state.phase]!);
  const manifest = await readManifest(runDir(id));
  const approved: string[] = [];
  for (const frame of manifest.frames) {
    if (frame.status !== "approved" || !frame.approved) break;
    approved.push(path.join(runDir(id), frame.approved.file));
  }
  const seconds = Math.min(FLIPBOOK_MAX_SECONDS, Math.floor(approved.length / state.fps));
  if (seconds < 1) {
    const needed = Math.ceil(state.fps);
    throw new AppError("not_enough_frames", 409, `Flipbook works in whole seconds. Approve ${needed} frames to open this run in Flipbook.`);
  }
  // The first `seconds` of the approved prefix, held at Flipbook's 24ths.
  const source = approved.slice(0, seconds * state.fps);
  const frames = Array.from({ length: seconds * FLIPBOOK_FPS }, (_, tick) => source[Math.min(source.length - 1, Math.floor((tick * state.fps) / FLIPBOOK_FPS))]);
  const flipbook = await importSequence({
    ownerId,
    title: `${state.name} · ${seconds} s`,
    character: await readFile(path.join(runDir(id), "input", "character.png")),
    frames,
    sequence: { durationSeconds: seconds, drawingFps: FLIPBOOK_FPS },
    importedFrom: { kind: "rotoscope", runId: id, fps: state.fps },
  });
  await appendLog(id, `opened in Flipbook as ${seconds} s (${frames.length} drawings)`);
  return { flipbookId: flipbook.id };
}

/** Copies a console run (pnpm rotoscope …) into an account, so it opens in the app. The console run is left as it was. */
export async function importConsoleRun(source: string, ownerId: string): Promise<RotoscopeRun> {
  const manifest = await readManifest(source);
  const id = randomUUID();
  const dir = runDir(id);
  await cp(source, dir, { recursive: true, filter: (from) => !from.endsWith("run.lock") });
  const state: State = {
    id, ownerId, name: manifest.name ?? path.basename(source), createdAt: manifest.createdAt, phase: "ready", error: null, live: null,
    log: [`imported from the console run ${path.basename(source)}`], fps: manifest.fps, start: manifest.start, seconds: manifest.seconds, dual: false,
  };
  await writeAtomic(statePath(id), `${JSON.stringify(state, null, 2)}\n`);
  // The app serves the character from input/, where its own uploads keep it.
  await mkdir(path.join(dir, "input"), { recursive: true });
  await cp(path.join(dir, "character.png"), path.join(dir, "input", "character.png"));
  return getRun(id, ownerId);
}

// ── Media ──────────────────────────────────────────────────────────────────

/** Only files the run's own state names are served. */
export async function mediaFile(id: string, ownerId: string, kind: RotoscopeMedia, frame?: number, attempt?: number): Promise<string> {
  const state = await ownedState(id, ownerId);
  const dir = runDir(id);
  const missing = () => new AppError("media_not_found", 404, "This file is no longer available.");
  if (kind === "character") return path.join(dir, "input", "character.png");
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
