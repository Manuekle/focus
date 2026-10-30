import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  CreateJobRequestSchema,
  ENGINE_LABELS,
  ENGINE_MIN_SECONDS,
  ERROR_MESSAGES,
  INPUT_FILES,
  OUTPUT_FILES,
  isActiveStatus,
  type AnimationJob,
  type CreateJobRequest,
  type Engine,
  type ErrorCode,
  type InputName,
  type JobStatus,
  type OutputName,
  type Verification,
  type WorkerManifest,
  type WorkerStatus,
} from "../../shared/reference-motion";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { parseRate } from "../media-validation";
import { writeAtomic } from "../animation/store";
import { sha256File } from "./assets";
import { signedUrl } from "./signing";
import * as worker from "./worker-client";
import {
  abortDispatcher,
  addEvent,
  assetFiles,
  createJobState,
  getOwnedAsset,
  getOwnedJob,
  isRunning,
  jobFiles,
  listJobs,
  peekJob,
  runningCount,
  startDispatcher,
  updateJob,
} from "./store";

// The Reference Motion job: Focus validates and trims the inputs, hands a
// manifest of signed URLs to the GPU worker, follows it by polling, and
// verifies the uploaded MP4 itself before calling anything complete. Every
// state lives in job.json; the dispatcher holds no state a restart could lose
// beyond "a worker run is in flight", which recovery turns into a retryable
// INTERRUPTED failure.

/** Replaceable in tests so no network call or GPU work ever runs there. */
export const services = {
  availability: worker.availability,
  dispatch: worker.dispatch,
  status: worker.status,
  cancel: worker.cancel,
  sleep: (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  }),
};

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function animationLimits() {
  return {
    perUser: number("ANIMATION_MAX_ACTIVE_JOBS_PER_USER", 1),
    total: number("ANIMATION_MAX_ACTIVE_JOBS", 1),
  };
}

class JobFailure extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly recoverable: boolean, readonly detail?: string) {
    super(message);
  }
}

const fail = (code: ErrorCode, recoverable: boolean, detail?: string, message = ERROR_MESSAGES[code]) => new JobFailure(code, message, recoverable, detail);

// ── Create, cancel, retry ──────────────────────────────────────────────────

export type JobGate = () => Promise<void>;

export async function createAnimationJob(ownerId: string, asked: CreateJobRequest, gate: JobGate): Promise<AnimationJob> {
  const input = CreateJobRequestSchema.parse(asked);
  const existing = (await listJobs(ownerId)).find((job) => job.idempotencyKey === input.idempotencyKey);
  if (existing) return existing;

  const [character, driving] = await Promise.all([getOwnedAsset(input.characterAssetId, ownerId), getOwnedAsset(input.drivingVideoAssetId, ownerId)]);
  if (character.kind !== "character" || driving.kind !== "driving") throw new AppError("INPUT_INVALID", 400, "Choose a character image and a movement video.");
  const available = await services.availability();
  if (input.durationSeconds > available.maxSegmentSeconds) throw new AppError("INPUT_INVALID", 400, `Choose a segment of ${available.maxSegmentSeconds} s or less.`);
  if (input.startSeconds + input.durationSeconds > (driving.durationSeconds ?? 0) + 0.05) throw new AppError("INPUT_INVALID", 400, "The selected segment goes past the end of the video.");
  const engine: Engine | null = input.engine ?? available.defaultEngine;
  if (!available.ready || !engine || !available.engines.includes(engine)) throw new AppError("GPU_UNAVAILABLE", 503, ERROR_MESSAGES.GPU_UNAVAILABLE, available.detail ?? undefined);
  if (input.durationSeconds < ENGINE_MIN_SECONDS[engine]) throw new AppError("INPUT_INVALID", 400, `${ENGINE_LABELS[engine]} renders segments of ${ENGINE_MIN_SECONDS[engine]} s or more.`);
  if (engine === "wan-zerogpu" && input.resolution !== "480p") throw new AppError("INPUT_INVALID", 400, "The ZeroGPU demo renders at most 480p.");

  const mine = (await listJobs(ownerId)).filter((job) => isActiveStatus(job.status) && isRunning(job.id)).length;
  const limits = animationLimits();
  if (limits.perUser > 0 && mine >= limits.perUser) throw new AppError("busy", 429, "Wait for your current animation to finish before starting another.");
  if (limits.total > 0 && runningCount() >= limits.total) throw new AppError("busy", 503, "The animation engine is busy. Try again in a few minutes.");
  await gate();

  const now = new Date().toISOString();
  const job = await createJobState({
    id: randomUUID(),
    ownerId,
    status: "queued",
    progress: 0,
    stageStartedAt: now,
    attempt: 1,
    idempotencyKey: input.idempotencyKey,
    retryKeys: [],
    characterAssetId: character.id,
    drivingVideoAssetId: driving.id,
    engine,
    mode: "animation",
    config: {
      startSeconds: input.startSeconds,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      outputFps: input.outputFps,
      interpolation: input.interpolation,
      useAudio: input.useAudio && Boolean(driving.hasAudio),
      seed: input.seed ?? randomInt(0, 2 ** 31 - 1),
    },
    inputFps: driving.fps ?? null,
    width: null,
    height: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    workerRunId: null,
    workerDetail: null,
    timings: {},
    workerTimings: {},
    gpu: null,
    gpuSeconds: null,
    estimatedCostUsd: null,
    outputs: [],
    verification: null,
    synthetic: engine === "fake",
    flipbookId: null,
    flipbookImport: null,
    events: [],
  });
  startDispatcher(job.id, (signal) => run(job.id, signal));
  return job;
}

export async function cancelAnimationJob(id: string, ownerId: string): Promise<AnimationJob> {
  const job = await getOwnedJob(id, ownerId);
  if (!isActiveStatus(job.status)) return job;
  const next = await updateJob(job.id, (current) => ({ ...current, status: "cancel_requested" }));
  abortDispatcher(job.id);
  return next;
}

/** Runs a failed or cancelled job again from its stored inputs. The same key twice is one retry. */
export async function retryAnimationJob(id: string, ownerId: string, key: string): Promise<AnimationJob> {
  const job = await getOwnedJob(id, ownerId);
  if (job.retryKeys.includes(key) || isActiveStatus(job.status)) return job;
  if (job.status === "completed") throw new AppError("job_completed", 409, "This animation is already complete.");
  if (job.error && !job.error.recoverable) throw new AppError("not_recoverable", 409, "This animation can’t be retried. Start a new one with other inputs.");
  if (job.attempt >= 99) throw new AppError("not_recoverable", 409, "This animation has been retried too many times.");
  const next = await updateJob(job.id, (current) => ({
    ...current,
    status: "queued",
    attempt: current.attempt + 1,
    retryKeys: [...current.retryKeys, key].slice(-20),
    error: null,
    completedAt: null,
    workerRunId: null,
    workerDetail: null,
    outputs: [],
    verification: null,
    timings: {},
    workerTimings: {},
  }), { evenIfFinished: true });
  startDispatcher(next.id, (signal) => run(next.id, signal));
  return next;
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

const WORKER_STAGE: Record<WorkerStatus["stage"], JobStatus | null> = {
  queued: "awaiting_gpu",
  validating: "preprocessing",
  preprocessing: "preprocessing",
  generating: "generating",
  postprocessing: "postprocessing",
  uploading: "uploading",
  completed: null,
  failed: null,
  cancelled: null,
};

const setStatus = (id: string, status: JobStatus, extra: Partial<AnimationJob> = {}) => updateJob(id, (current) => ({ ...current, ...extra, status, timings: closeTiming(current, status) }));

/** Seconds spent in the stage being left, recorded when the stage changes. */
function closeTiming(job: AnimationJob, next: JobStatus): Record<string, number> {
  if (job.status === next) return job.timings;
  const seconds = Math.max(0, (Date.now() - Date.parse(job.stageStartedAt)) / 1000);
  return { ...job.timings, [job.status]: Math.round(((job.timings[job.status] ?? 0) + seconds) * 100) / 100 };
}

async function run(id: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + worker.workerConfig().deadlineSeconds * 1000;
  let dispatched = false;
  try {
    const job = await setStatus(id, "validating", { startedAt: new Date().toISOString() });
    await prepareInputs(job);
    if (signal.aborted) throw fail("CANCELLED", true);

    await setStatus(id, "awaiting_gpu");
    await waitForWorker(signal, deadline);
    const current = await peekJob(id);
    const manifest = buildManifest(current, Math.ceil((deadline - Date.now()) / 1000), await inputChecksums(current));
    await writeAtomic(jobFiles.manifest(id), JSON.stringify(redactManifest(manifest), null, 2));
    const accepted = await services.dispatch(manifest, signal);
    dispatched = true;
    await updateJob(id, (value) => addEvent({ ...value, workerRunId: accepted.runId }, "dispatched"));

    const final = await follow(id, signal, deadline);
    await setStatus(id, "verifying", { workerDetail: null, workerTimings: final.timings, gpu: final.gpu ?? null, gpuSeconds: final.gpuSeconds ?? null, synthetic: final.synthetic || current.synthetic, estimatedCostUsd: cost(final) });
    const outputs = await verifyOutputs(await peekJob(id));
    await updateJob(id, (value) => ({ ...value, ...outputs, status: "completed", completedAt: new Date().toISOString(), timings: closeTiming(value, "completed") }));
  } catch (error) {
    const failure = signal.aborted ? fail("CANCELLED", true) : error instanceof JobFailure ? error : asFailure(error);
    if (dispatched && failure.code !== "GPU_UNAVAILABLE") await services.cancel(id);
    if (failure.detail) console.warn(`[focus] reference motion ${id} ${failure.code}: ${failure.detail}`);
    else if (!(error instanceof JobFailure) && !signal.aborted) console.error("[focus] reference motion failed", error);
    const status: JobStatus = failure.code === "CANCELLED" ? "cancelled" : "failed";
    await updateJob(id, (value) => addEvent({
      ...value,
      status,
      completedAt: new Date().toISOString(),
      timings: closeTiming(value, status),
      error: { code: failure.code, message: failure.message, recoverable: failure.recoverable },
    }, "error", failure.code)).catch(() => undefined);
  }
}

function asFailure(error: unknown): JobFailure {
  if (error instanceof AppError) {
    const code = (["GPU_UNAVAILABLE", "GENERATION_FAILED", "INPUT_INVALID"] as const).find((entry) => entry === error.code);
    if (code) return fail(code, code !== "INPUT_INVALID", error.detail);
    return fail("INPUT_INVALID", false, `${error.code}: ${error.message}`, error.message);
  }
  return fail("GENERATION_FAILED", true, error instanceof Error ? error.message : String(error));
}

/** Copies the selected segment into the job, trimmed and at a constant 24 fps. */
async function prepareInputs(job: AnimationJob): Promise<void> {
  const [character, driving] = await Promise.all([getOwnedAsset(job.characterAssetId, job.ownerId), getOwnedAsset(job.drivingVideoAssetId, job.ownerId)]).catch(() => {
    throw fail("INPUT_INVALID", false, "assets expired", "The uploads for this animation have expired. Upload them again.");
  });
  const characterFile = jobFiles.input(job.id, "character.png");
  const drivingFile = jobFiles.input(job.id, "driving.mp4");
  // A retry reuses the trimmed inputs it already has.
  if (await stat(drivingFile).catch(() => null)) return;
  await mkdir(jobFiles.inputs(job.id), { recursive: true });
  await copyFile(assetFiles.media(character), characterFile);
  const { startSeconds, durationSeconds, useAudio } = job.config;
  await ffmpeg([
    "-protocol_whitelist", "file,pipe", "-ss", String(startSeconds), "-i", assetFiles.media(driving), "-t", String(durationSeconds),
    "-map", "0:v:0", ...(useAudio ? ["-map", "0:a:0?"] : []), "-vf", "fps=24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    ...(useAudio ? ["-c:a", "aac"] : ["-an"]), "-movflags", "+faststart", drivingFile,
  ]).catch((error) => { throw fail("INPUT_INVALID", false, error instanceof Error ? error.message : String(error), "The selected segment couldn’t be prepared."); });
  const facts = await probe(drivingFile, true);
  const video = facts.streams.find((stream) => stream.codec_type === "video");
  const seconds = Number(facts.format.duration);
  if (!video?.width || !video.height || !(Math.abs(seconds - durationSeconds) < 0.2)) {
    await rm(drivingFile, { force: true });
    throw fail("INPUT_INVALID", false, `trimmed ${seconds}s`, "The selected segment couldn’t be prepared. Choose another start.");
  }
  await updateJob(job.id, (current) => ({ ...current, width: video.width ?? null, height: video.height ?? null }));
}

/** A sleeping Space takes minutes to wake: keep asking until the deadline. */
async function waitForWorker(signal: AbortSignal, deadline: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const state = await services.availability();
    if (state.ready) return;
    if (Date.now() + 10_000 > deadline || attempt >= 40) throw fail("GPU_UNAVAILABLE", true, state.detail ?? "worker not ready");
    await services.sleep(Math.min(15_000, 2_000 * (attempt + 1)), signal);
    if (signal.aborted) throw fail("CANCELLED", true);
  }
}

const DOWNLOAD_TTL_SECONDS = 15 * 60;

export function buildManifest(job: AnimationJob, remainingSeconds: number, sha256: { character: string; driving: string }): WorkerManifest {
  const deadline = Math.max(60, remainingSeconds);
  const get = (name: InputName) => signedUrl({ method: "GET", jobId: job.id, attempt: job.attempt, name }, DOWNLOAD_TTL_SECONDS);
  const uploads = Object.fromEntries((Object.keys(OUTPUT_FILES) as OutputName[]).map((name) => [name, signedUrl({ method: "PUT", jobId: job.id, attempt: job.attempt, name }, deadline)])) as Record<OutputName, string>;
  return {
    jobId: job.id,
    attempt: job.attempt,
    engine: job.engine,
    mode: job.mode,
    seed: job.config.seed,
    resolution: job.config.resolution,
    outputFps: job.config.outputFps,
    durationSeconds: job.config.durationSeconds,
    interpolation: job.config.interpolation,
    keepAudio: job.config.useAudio,
    inputs: {
      character: { url: get("character.png"), sha256: sha256.character },
      driving: { url: get("driving.mp4"), sha256: sha256.driving },
    },
    uploads,
    deadlineSeconds: deadline,
  };
}

/** The reproducible record kept beside the job: everything but the capability URLs. */
function redactManifest(manifest: WorkerManifest) {
  return { ...manifest, inputs: { character: { sha256: manifest.inputs.character.sha256 }, driving: { sha256: manifest.inputs.driving.sha256 } }, uploads: Object.keys(manifest.uploads) };
}

async function follow(id: string, signal: AbortSignal, deadline: number): Promise<WorkerStatus> {
  let misses = 0;
  for (;;) {
    await services.sleep(worker.workerConfig().pollMs, signal);
    if (signal.aborted) throw fail("CANCELLED", true);
    if (Date.now() > deadline) throw fail("TIMEOUT", true, "job deadline");
    let state: WorkerStatus | null;
    try {
      state = await services.status(id, signal);
    } catch (error) {
      // A few failed polls are network noise; many mean the worker is gone.
      if (++misses >= 5) throw error;
      continue;
    }
    misses = 0;
    if (!state) throw fail("GPU_UNAVAILABLE", true, "worker lost the run (restart or sleep)");
    if (state.stage === "completed") return state;
    if (state.stage === "cancelled") throw fail("CANCELLED", true);
    if (state.stage === "failed") {
      const code = state.error?.code ?? "GENERATION_FAILED";
      // Worker messages are written for people (no log tails): show the real reason, e.g. a used-up quota.
      throw fail(code, code !== "INPUT_INVALID" && code !== "POSE_NOT_FOUND", state.error?.message, state.error?.message || ERROR_MESSAGES[code]);
    }
    const status = WORKER_STAGE[state.stage];
    if (status) await updateJob(id, (current) => ({ ...current, status, timings: closeTiming(current, status), workerDetail: state.detail ?? null }));
  }
}

function cost(state: WorkerStatus): number | null {
  if (state.gpuSeconds == null || state.gpuHourlyUsd == null) return null;
  return Math.round((state.gpuSeconds / 3600) * state.gpuHourlyUsd * 10_000) / 10_000;
}

// ── Verification ───────────────────────────────────────────────────────────

/** FFprobe facts, a full decode and a black-frame count. Nothing unverified is offered. */
export async function verifyVideo(file: string, expectedSeconds: number): Promise<Verification> {
  const facts = await probe(file, true).catch(() => null);
  const video = facts?.streams.find((stream) => stream.codec_type === "video");
  if (!facts || !video?.width || !video.height) throw fail("OUTPUT_INVALID", true, "no readable video stream");
  const durationSeconds = Number(facts.format.duration ?? video.duration);
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  if (video.codec_name !== "h264") throw fail("OUTPUT_INVALID", true, `codec ${video.codec_name}`);
  if (!(Math.abs(durationSeconds - expectedSeconds) <= Math.max(0.25, expectedSeconds * 0.1))) throw fail("OUTPUT_INVALID", true, `duration ${durationSeconds}s, expected ${expectedSeconds}s`);
  const printed = await ffmpeg(["-protocol_whitelist", "file,pipe", "-xerror", "-i", file, "-an", "-vf", "blackframe=amount=0:threshold=24,metadata=mode=print:key=lavfi.blackframe.pblack:file=-", "-f", "null", "-"], 120_000)
    .catch((error) => { throw fail("OUTPUT_INVALID", true, `decode failed: ${error instanceof Error ? error.message : String(error)}`); });
  const shares = [...printed.matchAll(/lavfi\.blackframe\.pblack=(\d+)/g)].map((match) => Number(match[1]));
  const frames = shares.length || null;
  const blackRatio = shares.length ? shares.filter((share) => share >= 98).length / shares.length : 0;
  if (!frames) throw fail("OUTPUT_INVALID", true, "no decodable frames");
  if (blackRatio > 0.5) throw fail("OUTPUT_INVALID", true, `black frames ${Math.round(blackRatio * 100)}%`);
  return {
    codec: video.codec_name,
    pixelFormat: (video as { pix_fmt?: string }).pix_fmt ?? null,
    width: video.width,
    height: video.height,
    fps: Math.round(fps * 1000) / 1000,
    durationSeconds,
    frames,
    hasAudio: facts.streams.some((stream) => stream.codec_type === "audio"),
    blackRatio,
  };
}

async function verifyOutputs(job: AnimationJob): Promise<Pick<AnimationJob, "outputs" | "verification">> {
  const dir = jobFiles.outputs(job.id, job.attempt);
  const outputs: AnimationJob["outputs"] = [];
  for (const name of Object.keys(OUTPUT_FILES) as OutputName[]) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) outputs.push({ name, type: OUTPUT_FILES[name].type, bytes: info.size });
  }
  if (!outputs.some((output) => output.name === "animation.mp4")) throw fail("OUTPUT_INVALID", true, "animation.mp4 was not uploaded");
  const verification = await verifyVideo(path.join(dir, "animation.mp4"), job.config.durationSeconds);
  if (verification.pixelFormat !== "yuv420p") throw fail("OUTPUT_INVALID", true, `pixel format ${verification.pixelFormat}`);
  if (outputs.some((output) => output.name === "animation_rife.mp4")) await verifyVideo(path.join(dir, "animation_rife.mp4"), job.config.durationSeconds);
  return { outputs, verification };
}

// ── Worker file exchange (signed routes) ───────────────────────────────────

/** An input the worker may download: only while its attempt is the live one. */
export async function workerInput(jobId: string, attempt: number, name: InputName): Promise<{ file: string; type: string }> {
  const job = await readLiveJob(jobId, attempt);
  return { file: jobFiles.input(job.id, name), type: INPUT_FILES[name] };
}

/** Streams one worker upload to disk with its size cap; replaces any earlier copy. */
export async function receiveWorkerOutput(jobId: string, attempt: number, name: OutputName, body: ReadableStream<Uint8Array> | null): Promise<{ bytes: number }> {
  const job = await readLiveJob(jobId, attempt);
  if (!body) throw new AppError("empty_file", 400, "Empty upload.");
  const dir = jobFiles.outputs(job.id, attempt);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  const temp = `${target}.${randomUUID().slice(0, 8)}.part`;
  const limit = OUTPUT_FILES[name].maxBytes;
  let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new AppError("file_too_large", 413, "Upload too large.") : null, chunk);
    } }), createWriteStream(temp));
    if (!bytes) throw new AppError("empty_file", 400, "Empty upload.");
    if (name.endsWith(".json")) JSON.parse(await readFile(temp, "utf8"));
    await rename(temp, target);
    return { bytes };
  } catch (error) {
    await rm(temp, { force: true });
    if (error instanceof SyntaxError) throw new AppError("invalid_json", 400, "Invalid JSON upload.");
    throw error;
  }
}

async function readLiveJob(jobId: string, attempt: number): Promise<AnimationJob> {
  const job = await peekJob(jobId).catch(() => null);
  if (!job || job.attempt !== attempt || !isActiveStatus(job.status) || job.status === "cancel_requested") throw new AppError("forbidden", 403, "This link is invalid or has expired.");
  return job;
}

/** For results: the checked path of an output the job actually recorded. */
export function outputFile(job: AnimationJob, name: OutputName): string {
  if (!job.outputs.some((output) => output.name === name)) throw new AppError("media_not_found", 404, "This file is no longer available.");
  return path.join(jobFiles.outputs(job.id, job.attempt), name);
}

export async function inputChecksums(job: AnimationJob) {
  return { character: await sha256File(jobFiles.input(job.id, "character.png")), driving: await sha256File(jobFiles.input(job.id, "driving.mp4")) };
}
