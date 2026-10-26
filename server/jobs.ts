import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  ACTIVE_JOB_STATUSES,
  EditJobSchema,
  EditPlanSchema,
  type EditJob,
  type EditPlan,
  type EditRequest,
  type RefineRequest,
  type VideoAsset,
} from "../shared/schemas";
import { TrackingSchema, frameAt, hitTest, mergeTracking, type Tracking } from "../shared/tracking";
import { interpretInstruction } from "./ai/planner";
import { segmentVideo, type SamPrompt } from "./ai/sam";
import { recordUsage } from "./ai/usage";
import { AppError } from "./errors";
import { VIDEO_FILES, dataRoot, videoDir } from "./storage";
import { getVideo } from "./videos";

// Local job manager. Jobs are JSON files under .focus-data/jobs; plans and
// segmentations are cached per video so a repeated instruction or a changed
// effect setting never pays for the same API work twice.

const JOB_TTL_MS = 24 * 60 * 60 * 1000;

// Process-wide state lives on globalThis: Next bundles each route handler
// separately, so module-level maps would not be shared between /api/edits
// and /api/jobs/:id, and dev reloads would otherwise reset them.
type JobRuntime = {
  readonly running: Map<string, AbortController>;
  readonly inflightSegmentations: Map<string, Promise<Tracking>>;
  readonly inflightPlans: Map<string, Promise<EditPlan>>;
  readonly locks: Map<string, Promise<unknown>>;
};
const runtime: JobRuntime = ((globalThis as { __focusJobs?: JobRuntime }).__focusJobs ??= {
  running: new Map(),
  inflightSegmentations: new Map(),
  inflightPlans: new Map(),
  locks: new Map(),
});
const { running, inflightSegmentations, inflightPlans, locks } = runtime;

/** Replaceable in tests so no paid request ever runs there. */
export const services = {
  interpret: interpretInstruction,
  segment: segmentVideo,
};

function jobsDir(): string {
  return path.join(dataRoot(), "jobs");
}

function jobPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("job_not_found", 404, "Ese proceso no existe.");
  return path.join(jobsDir(), `${id}.json`);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function requestKey(request: EditRequest): string {
  const prompt = request.prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return hash(`${request.videoId}|${request.effect}|${prompt}`);
}

export function segmentationKey(concept: string): string {
  return `c-${hash(`concept:${concept.trim().toLowerCase()}`)}`;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash never leaves a half-written job.
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}

async function readJob(id: string): Promise<EditJob> {
  const raw = await readFile(jobPath(id), "utf8").catch(() => null);
  if (!raw) throw new AppError("job_not_found", 404, "Ese proceso no existe o ya expiró.");
  return EditJobSchema.parse(JSON.parse(raw));
}

async function saveJob(job: EditJob): Promise<EditJob> {
  const next = { ...job, updatedAt: new Date().toISOString() };
  await writeJson(jobPath(job.id), next);
  return next;
}

/** Serializes read-modify-write per job, so a late progress write never undoes a status change. */
function withJobLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(id, next.catch(() => undefined));
  return next;
}

/** Applies a patch unless the job was canceled meanwhile. */
function patchJob(id: string, patch: Partial<EditJob>): Promise<EditJob> {
  return withJobLock(id, async () => {
    const current = await readJob(id);
    if (current.status === "canceled") return current;
    return saveJob({ ...current, ...patch });
  });
}

/** A progress-only update: dropped once the job has left its active state. */
function patchProgress(id: string, patch: Pick<EditJob, "progress"> & Partial<Pick<EditJob, "detail">>): Promise<unknown> {
  return withJobLock(id, async () => {
    const current = await readJob(id);
    if (current.status !== "segmenting") return current;
    return saveJob({ ...current, ...patch });
  }).catch(() => undefined);
}

export async function getJob(id: string): Promise<EditJob> {
  const job = await readJob(id);
  // An active job with no live worker was interrupted by a restart or crash.
  if (ACTIVE_JOB_STATUSES.includes(job.status) && !running.has(id)) {
    return saveJob({
      ...job,
      status: "failed",
      detail: null,
      error: { code: "interrupted", message: "El proceso se interrumpió (el servidor se reinició). Vuelve a generarlo; lo ya calculado se reutiliza." },
    });
  }
  return job;
}

function segmentationFile(video: VideoAsset, id: string): string {
  if (!/^[a-z0-9+-]+$/.test(id)) throw new AppError("segmentation_not_found", 404, "Segmentación no encontrada.");
  return path.join(videoDir(video.id), "segmentations", `${id}.json`);
}

export async function readTracking(video: VideoAsset, id: string): Promise<Tracking | null> {
  const raw = await readFile(segmentationFile(video, id), "utf8").catch(() => null);
  return raw ? TrackingSchema.parse(JSON.parse(raw)) : null;
}

export async function getJobTracking(jobId: string): Promise<Tracking> {
  const job = await getJob(jobId);
  if (!job.segmentationId) throw new AppError("tracking_not_ready", 409, "La segmentación todavía no está lista.");
  const tracking = await readTracking(await getVideo(job.videoId), job.segmentationId);
  if (!tracking) throw new AppError("tracking_not_found", 404, "La segmentación ya no está disponible.");
  return tracking;
}

export async function createJob(request: EditRequest): Promise<EditJob> {
  const video = await getVideo(request.videoId);
  void cleanupJobs();
  const key = requestKey(request);

  // Deduplicate: the same instruction on the same video returns the live or
  // finished job instead of starting new paid work.
  const existing = await findJobByKey(key);
  if (existing && !["failed", "canceled"].includes(existing.status)) return existing;

  const now = new Date().toISOString();
  const job = await saveJob({
    id: randomUUID(),
    videoId: video.id,
    request,
    status: "interpreting",
    detail: "Interpretando la instrucción con Muse Spark",
    progress: 0.05,
    plan: null,
    segmentationId: null,
    objects: [],
    selection: [],
    reused: { plan: false, segmentation: false },
    error: null,
    resultUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  start(job.id, (signal) => runJob(job.id, video, request, key, signal));
  return job;
}

async function findJobByKey(key: string): Promise<EditJob | null> {
  const names = await readdir(jobsDir()).catch(() => [] as string[]);
  let latest: EditJob | null = null;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const job = await getJob(name.slice(0, -5)).catch(() => null);
    if (job && requestKey(job.request) === key && (!latest || job.createdAt > latest.createdAt)) latest = job;
  }
  return latest;
}

function start(id: string, work: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  running.set(id, controller);
  void work(controller.signal)
    .catch(async (error) => {
      if (controller.signal.aborted) return;
      const failure = error instanceof AppError ? error : new AppError("internal_error", 500, "Algo falló durante el proceso.");
      if (!(error instanceof AppError)) console.error("[focus] job failed", error);
      await patchJob(id, { status: "failed", detail: null, error: { code: failure.code, message: failure.message } }).catch(() => undefined);
    })
    .finally(() => running.delete(id));
}

async function planFor(video: VideoAsset, request: EditRequest, key: string, signal: AbortSignal): Promise<{ plan: EditPlan; reused: boolean }> {
  const file = path.join(videoDir(video.id), "plans", `${key}.json`);
  const cached = await readFile(file, "utf8").catch(() => null);
  if (cached) {
    const parsed = EditPlanSchema.safeParse(JSON.parse(cached));
    if (parsed.success) {
      await recordUsage({ model: "muse-spark", kind: "plan", cached: true, ok: true, videoId: video.id });
      return { plan: parsed.data, reused: true };
    }
  }
  let pending = inflightPlans.get(key);
  if (!pending) {
    pending = services
      .interpret({
        request,
        posterPath: path.join(videoDir(video.id), VIDEO_FILES.poster),
        media: video.normalized,
        knownConcepts: await knownConcepts(video),
        signal,
      })
      .then(async (plan) => {
        await writeJson(file, plan);
        return plan;
      })
      .finally(() => inflightPlans.delete(key));
    inflightPlans.set(key, pending);
  }
  return { plan: await pending, reused: false };
}

/** Concepts with a stored concept segmentation for this video. */
async function knownConcepts(video: VideoAsset): Promise<string[]> {
  const dir = path.join(videoDir(video.id), "segmentations");
  const names = await readdir(dir).catch(() => [] as string[]);
  const concepts: string[] = [];
  for (const name of names.filter((entry) => entry.startsWith("c-") && !entry.includes("+") && entry.endsWith(".json"))) {
    const tracking = await readTracking(video, name.slice(0, -5)).catch(() => null);
    if (tracking?.source === "concept" && tracking.objects.length > 0) concepts.push(tracking.prompt);
  }
  return concepts;
}

async function trackingFor(
  video: VideoAsset,
  id: string,
  prompt: SamPrompt,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<{ tracking: Tracking; reused: boolean }> {
  const cached = await readTracking(video, id);
  if (cached) {
    await recordUsage({ model: "sam", kind: "segment", cached: true, ok: true, videoId: video.id });
    return { tracking: cached, reused: true };
  }
  const flightKey = `${video.id}/${id}`;
  let pending = inflightSegmentations.get(flightKey);
  if (!pending) {
    pending = services
      .segment({
        id,
        videoId: video.id,
        videoDir: videoDir(video.id),
        normalizedPath: path.join(videoDir(video.id), VIDEO_FILES.normalized),
        media: video.normalized,
        prompt,
        signal,
        onProgress,
      })
      .then(async (tracking) => {
        await writeJson(segmentationFile(video, id), tracking);
        return tracking;
      })
      .finally(() => inflightSegmentations.delete(flightKey));
    inflightSegmentations.set(flightKey, pending);
  }
  return { tracking: await pending, reused: false };
}

async function runJob(id: string, video: VideoAsset, request: EditRequest, key: string, signal: AbortSignal): Promise<void> {
  const { plan, reused: planReused } = await planFor(video, request, key, signal);
  if (!plan.supported) {
    await patchJob(id, {
      plan,
      status: "failed",
      detail: null,
      error: { code: "unsupported_edit", message: plan.unsupportedReason ?? "Focus todavía no puede hacer ese tipo de edición." },
      reused: { plan: planReused, segmentation: false },
    });
    return;
  }
  if (plan.needsClarification) {
    await patchJob(id, {
      plan,
      status: "awaiting_clarification",
      detail: plan.clarificationQuestion ?? "¿Qué sujeto quieres destacar?",
      progress: 0.15,
      reused: { plan: planReused, segmentation: false },
    });
    return;
  }

  await patchJob(id, {
    plan,
    status: "segmenting",
    detail: `Buscando y siguiendo «${plan.target.concept}» con SAM 3.1`,
    progress: 0.15,
    reused: { plan: planReused, segmentation: false },
  });

  let lastWrite = 0;
  const segmentationId = segmentationKey(plan.target.concept);
  const { tracking, reused } = await trackingFor(
    video,
    segmentationId,
    { kind: "concept", concept: plan.target.concept },
    signal,
    (fraction) => {
      // Throttled: progress is written at most every 400 ms.
      if (Date.now() - lastWrite < 400) return;
      lastWrite = Date.now();
      void patchProgress(id, { progress: 0.15 + fraction * 0.8, detail: `Siguiendo «${plan.target.concept}» · ${Math.round(fraction * video.normalized.frameCount)}/${video.normalized.frameCount} fotogramas` });
    },
  );
  if (signal.aborted) return;

  if (tracking.objects.length === 0) {
    await patchJob(id, {
      status: "failed",
      detail: null,
      segmentationId,
      reused: { plan: planReused, segmentation: reused },
      error: { code: "no_match", message: `SAM 3.1 no encontró «${plan.target.concept}» en el video. Prueba a nombrar el sujeto de otra forma.` },
    });
    return;
  }

  const ids = tracking.objects.map((object) => object.id);
  const autoSelect = plan.target.selection === "all" ? ids : ids.length === 1 ? ids : [];
  await patchJob(id, {
    status: autoSelect.length ? "ready_to_render" : "awaiting_selection",
    detail: autoSelect.length ? null : `Encontramos ${ids.length} coincidencias. Elige cuál destacar.`,
    progress: 1,
    segmentationId,
    objects: tracking.objects,
    selection: autoSelect,
    reused: { plan: planReused, segmentation: reused },
  });
}

export async function cancelJob(id: string): Promise<EditJob> {
  const job = await getJob(id);
  if (!ACTIVE_JOB_STATUSES.includes(job.status)) return job;
  running.get(id)?.abort();
  running.delete(id);
  return withJobLock(id, () => saveJob({ ...job, status: "canceled", detail: null, error: null }));
}

export async function setSelection(id: string, objectIds: readonly string[]): Promise<EditJob> {
  const job = await getJob(id);
  if (!["awaiting_selection", "ready_to_render"].includes(job.status)) {
    throw new AppError("selection_not_allowed", 409, "Este proceso no está esperando una selección.");
  }
  const known = new Set(job.objects.map((object) => object.id));
  const unique = [...new Set(objectIds)];
  if (unique.some((objectId) => !known.has(objectId))) throw new AppError("unknown_object", 400, "Ese objeto no existe en la segmentación.");
  return saveJob({ ...job, selection: unique, status: "ready_to_render", detail: null });
}

/** Re-opens selection without any API call. */
export async function reopenSelection(id: string): Promise<EditJob> {
  const job = await getJob(id);
  if (job.status !== "ready_to_render") throw new AppError("selection_not_allowed", 409, "La selección no se puede cambiar ahora.");
  return saveJob({ ...job, status: "awaiting_selection", detail: "Elige qué destacar." });
}

/**
 * A click on the preview. If an existing mask already covers the point, that
 * object is selected for free; only an uncovered point costs a SAM pass.
 */
export async function refineWithPoint(id: string, refine: RefineRequest): Promise<EditJob> {
  const job = await getJob(id);
  if (!["awaiting_selection", "ready_to_render"].includes(job.status) || !job.segmentationId) {
    throw new AppError("refine_not_allowed", 409, "Este proceso no admite una selección por punto ahora.");
  }
  const video = await getVideo(job.videoId);
  const { width, height, frameCount } = video.normalized;
  if (refine.frameIndex >= frameCount || refine.point.x >= width || refine.point.y >= height) {
    throw new AppError("invalid_point", 400, "El punto está fuera del video.");
  }
  const base = await readTracking(video, job.segmentationId);
  if (!base) throw new AppError("tracking_not_found", 404, "La segmentación ya no está disponible.");

  const hit = hitTest(frameAt(base, refine.frameIndex), refine.point.x, refine.point.y);
  if (hit) return saveJob({ ...job, selection: [hit], status: "awaiting_selection", detail: null });

  const pointObjects = base.objects.filter((object) => object.source === "point").length;
  const objectId = 100 + pointObjects;
  const pointId = `p-${hash(`${refine.frameIndex}:${refine.point.x}:${refine.point.y}`)}`;
  const previous = job.segmentationId;
  const updated = await saveJob({ ...job, status: "segmenting", detail: "Segmentando el punto elegido con SAM 3.1", progress: 0.2 });

  start(id, async (signal) => {
    const { tracking: extra } = await trackingFor(
      video,
      pointId,
      { kind: "point", objectId, frameIndex: refine.frameIndex, point: refine.point },
      signal,
      (fraction) => void patchProgress(id, { progress: 0.2 + fraction * 0.75 }),
    );
    if (signal.aborted) return;
    if (extra.objects.length === 0) {
      await patchJob(id, { status: "awaiting_selection", detail: "SAM 3.1 no encontró un objeto en ese punto. Prueba en otra zona.", progress: 1 });
      return;
    }
    const mergedId = `${previous}+${pointId}`;
    const merged = mergeTracking(base, { ...extra, objects: extra.objects.map((object) => ({ ...object, source: "point" as const })) });
    await writeJson(segmentationFile(video, mergedId), { ...merged, id: mergedId });
    await patchJob(id, {
      status: "awaiting_selection",
      detail: null,
      progress: 1,
      segmentationId: mergedId,
      objects: merged.objects,
      selection: extra.objects.map((object) => object.id),
    });
  });
  return updated;
}

/** Removes jobs older than a day, and jobs whose video is gone. */
export async function cleanupJobs(): Promise<void> {
  const names = await readdir(jobsDir()).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of names) {
    const file = path.join(jobsDir(), name);
    if (name.endsWith(".tmp")) {
      await rm(file, { force: true });
      continue;
    }
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    const id = name.replace(/\.json$/, "");
    if (running.has(id)) continue;
    const job = await readJob(id).catch(() => null);
    const videoExists = job ? await stat(videoDir(job.videoId)).then(() => true, () => false) : false;
    if (!job || !videoExists || now - info.mtimeMs > JOB_TTL_MS) await rm(file, { force: true });
  }
}
