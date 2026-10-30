import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import {
  AnimationAssetSchema,
  AnimationJobSchema,
  AssetIdSchema,
  JobIdSchema,
  PROGRESS_STAGES,
  isActiveStatus,
  type AnimationAsset,
  type AnimationJob,
  type JobStatus,
} from "../../shared/reference-motion";
import { referenceMotionEnabled } from "../../shared/features";
import { AppError } from "../errors";
import { dataRoot } from "../storage";
import { readJsonFile, writeAtomic } from "../animation/store";

// Reference Motion storage. Same conventions as Flipbook and the video jobs:
// one JSON state file per entity written with write-then-rename, changes
// under a per-id lock, live dispatchers on globalThis (Next bundles each route
// separately), every id validated by pattern before it reaches a path.

const ASSET_TTL_MS = 24 * 60 * 60 * 1000;
/** Intermediate inputs of finished jobs; outputs stay until the owner deletes the job. */
const INPUT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 80;

type Runtime = { readonly running: Map<string, AbortController>; readonly locks: Map<string, Promise<unknown>> };
const shared = ((globalThis as { __focusReferenceMotion?: { -readonly [K in keyof Runtime]?: Runtime[K] } }).__focusReferenceMotion ??= {});
const runtime: Runtime = { running: (shared.running ??= new Map()), locks: (shared.locks ??= new Map()) };

export function assertReferenceMotionEnabled(): void {
  if (!referenceMotionEnabled()) throw new AppError("reference_motion_disabled", 404, "Reference Motion isn’t available in this version.");
}

export function root(): string {
  return path.join(dataRoot(), "reference-motion");
}

export function parseAssetId(value: string): string {
  const parsed = AssetIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("asset_not_found", 404, "This upload no longer exists. Upload it again.");
  return parsed.data;
}

export function parseJobId(value: string): string {
  const parsed = JobIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("job_not_found", 404, "This animation doesn’t exist.");
  return parsed.data;
}

export const assetFiles = {
  dir: (id: string) => path.join(root(), "assets", parseAssetId(id)),
  state: (id: string) => path.join(assetFiles.dir(id), "asset.json"),
  /** character.png (normalized PNG) or driving.mp4 (normalized H.264, 24 fps). */
  media: (asset: Pick<AnimationAsset, "id" | "kind">) => path.join(assetFiles.dir(asset.id), asset.kind === "character" ? "character.png" : "driving.mp4"),
  poster: (id: string) => path.join(assetFiles.dir(id), "poster.jpg"),
};

export const jobFiles = {
  dir: (id: string) => path.join(root(), "jobs", parseJobId(id)),
  state: (id: string) => path.join(jobFiles.dir(id), "job.json"),
  inputs: (id: string) => path.join(jobFiles.dir(id), "input"),
  input: (id: string, name: "character.png" | "driving.mp4") => path.join(jobFiles.inputs(id), name),
  outputs: (id: string, attempt: number) => {
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 99) throw new AppError("media_not_found", 404, "This file is no longer available.");
    return path.join(jobFiles.dir(id), "output", String(attempt));
  },
  manifest: (id: string) => path.join(jobFiles.dir(id), "manifest.json"),
};

// ── Assets ─────────────────────────────────────────────────────────────────

export async function writeAsset(asset: AnimationAsset): Promise<AnimationAsset> {
  const next = AnimationAssetSchema.parse(asset);
  await writeAtomic(assetFiles.state(next.id), JSON.stringify(next));
  return next;
}

/** An upload the requester owns; anyone else gets the same 404 as a missing one. */
export async function getOwnedAsset(id: string, ownerId: string): Promise<AnimationAsset> {
  const asset = await readJsonFile(assetFiles.state(id), (value) => AnimationAssetSchema.parse(value));
  if (!asset || asset.ownerId !== ownerId) throw new AppError("asset_not_found", 404, "This upload no longer exists. Upload it again.");
  return asset;
}

// ── Jobs ───────────────────────────────────────────────────────────────────

function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = runtime.locks.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  runtime.locks.set(id, next.catch(() => undefined));
  return next;
}

/** Measured progress: stages already finished, never a timer. */
export function progressFor(status: JobStatus): number {
  if (status === "completed") return 1;
  const index = PROGRESS_STAGES.indexOf(status);
  return index <= 0 ? 0 : index / PROGRESS_STAGES.length;
}

/** Last written state, no recovery and no owner check: for the dispatcher and signed routes. */
export function peekJob(id: string): Promise<AnimationJob> {
  return readJob(parseJobId(id));
}

async function readJob(id: string): Promise<AnimationJob> {
  const job = await readJsonFile(jobFiles.state(id), (value) => AnimationJobSchema.parse(value));
  if (!job) throw new AppError("job_not_found", 404, "This animation doesn’t exist or has been deleted.");
  return job;
}

async function writeJob(previous: AnimationJob | null, job: AnimationJob): Promise<AnimationJob> {
  const now = new Date().toISOString();
  const moved = previous?.status !== job.status;
  const next = AnimationJobSchema.parse({
    ...job,
    progress: progressFor(job.status),
    stageStartedAt: moved ? now : job.stageStartedAt,
    updatedAt: now,
    events: (moved ? [...job.events, { at: now, stage: job.status, event: "stage" }] : job.events).slice(-MAX_EVENTS),
  });
  await writeAtomic(jobFiles.state(next.id), JSON.stringify(next));
  return next;
}

export function createJobState(job: AnimationJob): Promise<AnimationJob> {
  return withLock(job.id, () => writeJob(null, job));
}

/**
 * Read-modify-write under the job's lock. A finished job only accepts
 * changes that say so (retry), so a late worker poll can't revive it.
 */
export function updateJob(id: string, change: (current: AnimationJob) => AnimationJob, options: { evenIfFinished?: boolean } = {}): Promise<AnimationJob> {
  return withLock(id, async () => {
    const current = await readJob(id);
    if (!isActiveStatus(current.status) && !options.evenIfFinished) return current;
    return writeJob(current, change(current));
  });
}

export function addEvent(job: AnimationJob, event: string, detail?: string): AnimationJob {
  return { ...job, events: [...job.events, { at: new Date().toISOString(), stage: job.status, event, ...(detail ? { detail: detail.slice(0, 400) } : {}) }] };
}

/** A job the requester owns. An active job without a live dispatcher was cut by a restart. */
export async function getOwnedJob(id: string, ownerId: string): Promise<AnimationJob> {
  const job = await readJob(parseJobId(id));
  if (job.ownerId !== ownerId) throw new AppError("job_not_found", 404, "This animation doesn’t exist.");
  if (isActiveStatus(job.status) && !runtime.running.has(job.id)) {
    return withLock(job.id, async () => {
      const current = await readJob(job.id);
      if (!isActiveStatus(current.status) || runtime.running.has(current.id)) return current;
      const cancelled = current.status === "cancel_requested";
      return writeJob(current, {
        ...current,
        status: cancelled ? "cancelled" : "failed",
        completedAt: new Date().toISOString(),
        error: cancelled ? { code: "CANCELLED", message: "Cancelled.", recoverable: true } : { code: "INTERRUPTED", message: "Processing was interrupted by a server restart. Retry to run it again.", recoverable: true },
      });
    });
  }
  return job;
}

export async function listJobs(ownerId: string): Promise<AnimationJob[]> {
  const dir = path.join(root(), "jobs");
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => JobIdSchema.safeParse(name).success);
  const jobs = await Promise.all(names.map((name) => readJsonFile(jobFiles.state(name), (value) => AnimationJobSchema.parse(value))));
  return jobs.filter((job): job is AnimationJob => job?.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteJobFiles(id: string): Promise<void> {
  await rm(jobFiles.dir(id), { recursive: true, force: true });
}

// ── Dispatchers ────────────────────────────────────────────────────────────

export function isRunning(id: string): boolean {
  return runtime.running.has(id);
}

export function runningCount(): number {
  return runtime.running.size;
}

export function startDispatcher(id: string, work: (signal: AbortSignal) => Promise<void>): void {
  if (runtime.running.has(id)) throw new AppError("job_busy", 409, "This animation is already running.");
  const controller = new AbortController();
  runtime.running.set(id, controller);
  void work(controller.signal).finally(() => {
    if (runtime.running.get(id) === controller) runtime.running.delete(id);
  });
}

export function abortDispatcher(id: string): void {
  runtime.running.get(id)?.abort();
}

// ── Cleanup ────────────────────────────────────────────────────────────────

/** Uploads untouched for a day, and the input copies of finished jobs. Outputs stay. */
export async function cleanupReferenceMotion(now = Date.now()): Promise<void> {
  const assets = path.join(root(), "assets");
  for (const name of await readdir(assets).catch(() => [] as string[])) {
    if (!AssetIdSchema.safeParse(name).success) continue;
    const info = await stat(path.join(assets, name)).catch(() => null);
    if (info && now - info.mtimeMs > ASSET_TTL_MS) await rm(path.join(assets, name), { recursive: true, force: true });
  }
  const jobs = path.join(root(), "jobs");
  for (const name of await readdir(jobs).catch(() => [] as string[])) {
    if (!JobIdSchema.safeParse(name).success || runtime.running.has(name)) continue;
    const job = await readJsonFile(jobFiles.state(name), (value) => AnimationJobSchema.parse(value));
    if (!job || isActiveStatus(job.status)) continue;
    if (now - Date.parse(job.updatedAt) > INPUT_TTL_MS) await rm(jobFiles.inputs(name), { recursive: true, force: true });
  }
}
