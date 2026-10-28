import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  ACTIVE_JOB_STATUSES,
  CHAT_HISTORY_MAX,
  EFFECT_PLAN_EFFECTS,
  effectFamily,
  EditJobSchema,
  EditPlanSchema,
  type ChatMessage,
  type EditJob,
  type EditPlan,
  type EditRequest,
  type EffectId,
  type RefineRequest,
  type VideoAsset,
} from "../shared/schemas";
import {
  RENDERER_VERSION,
  TEMPORAL_RENDERER_VERSION,
  RenderParamsSchema,
  RenderResultSchema,
  applyParamsPatch,
  defaultParams,
  describeParamChanges,
  type RenderParams,
  type RenderParamsInput,
  type RenderResult,
} from "../shared/render";
import { TrackingSchema, fillTracking, frameAt, hitTest, mergeTracking, type Tracking } from "../shared/tracking";
import { effectEnabled } from "../shared/features";
import { planFreeze, triggerProblem } from "../shared/temporal";
import { suggestTemporalEvent, type TemporalSuggestion } from "../shared/temporal-events";
import { checkTemporalTracking, selectionTrack } from "../shared/temporal-track";
import { assistEdit } from "./ai/assistant";
import { interpretInstruction } from "./ai/planner";
import { segmentVideo, type SamPrompt } from "./ai/sam";
import { recordUsage } from "./ai/usage";
import { Limiter } from "./ai/meta";
import { AppError } from "./errors";
import { renderComparison, renderVideo, trackingMaskSource, verifyOutput } from "./video/compositor";
import { retainedIds } from "./projects";
import { activeFlipbookCount } from "./animation/store";
import { activeCharacterCount } from "./characters/store";
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
  readonly inflightRenders: Map<string, Promise<RenderResult>>;
  /** Local CPU work: one render at a time keeps the machine responsive. */
  readonly renderLimiter: Limiter;
};
// Each field is initialized on its own: a dev reload may find a runtime
// object created by an older version of this module.
const shared = ((globalThis as { __focusJobs?: { -readonly [K in keyof JobRuntime]?: JobRuntime[K] } }).__focusJobs ??= {});
const runtime: JobRuntime = {
  running: (shared.running ??= new Map()),
  inflightSegmentations: (shared.inflightSegmentations ??= new Map()),
  inflightPlans: (shared.inflightPlans ??= new Map()),
  locks: (shared.locks ??= new Map()),
  inflightRenders: (shared.inflightRenders ??= new Map()),
  renderLimiter: (shared.renderLimiter ??= new Limiter(1)),
};
const { running, inflightSegmentations, inflightPlans, locks, inflightRenders, renderLimiter } = runtime;

/** Replaceable in tests so no paid request ever runs there. */
export const services = {
  interpret: interpretInstruction,
  segment: segmentVideo,
  assist: assistEdit,
};

function jobsDir(): string {
  return path.join(dataRoot(), "jobs");
}

function jobPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("job_not_found", 404, "This edit doesn’t exist.");
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
  if (!raw) throw new AppError("job_not_found", 404, "This edit no longer exists or has expired.");
  return EditJobSchema.parse(JSON.parse(raw));
}

async function saveJob(job: EditJob): Promise<EditJob> {
  // A phase only describes running work.
  const phase = ACTIVE_JOB_STATUSES.includes(job.status) ? job.phase : null;
  const next = { ...job, phase, updatedAt: new Date().toISOString() };
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
function patchProgress(id: string, patch: Pick<EditJob, "progress"> & Partial<Pick<EditJob, "detail" | "phase">>): Promise<unknown> {
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
    return withJobLock(id, async () => {
      // The worker can finish between the initial read and the running check.
      // Confirm the current state under the same lock as terminal writes.
      const current = await readJob(id);
      if (!ACTIVE_JOB_STATUSES.includes(current.status) || running.has(id)) return current;
      return saveJob({
        ...current,
        status: "failed",
        detail: null,
        error: { code: "interrupted", message: "Processing was interrupted when the server restarted. Generate again to continue from your saved progress." },
      });
    });
  }
  return job;
}

function segmentationFile(video: VideoAsset, id: string): string {
  if (!/^[a-z0-9+-]+$/.test(id)) throw new AppError("segmentation_not_found", 404, "Subject tracking wasn’t found.");
  return path.join(videoDir(video.id), "segmentations", `${id}.json`);
}

export async function readTracking(video: VideoAsset, id: string): Promise<Tracking | null> {
  const raw = await readFile(segmentationFile(video, id), "utf8").catch(() => null);
  return raw ? TrackingSchema.parse(JSON.parse(raw)) : null;
}

export async function getJobTracking(jobId: string): Promise<Tracking> {
  const job = await getJob(jobId);
  if (!job.segmentationId) throw new AppError("tracking_not_ready", 409, "Subject tracking isn’t ready yet.");
  const tracking = await readTracking(await getVideo(job.videoId), job.segmentationId);
  if (!tracking) throw new AppError("tracking_not_found", 404, "Your saved subject tracking is no longer available.");
  return tracking;
}

/** Called right before new paid work starts, with its worst-case SAM frame cost. */
export type PaidWorkGate = (input: { activeJobs: number; estimatedFrames: number }) => Promise<void>;

export function activeJobCount(): number {
  return running.size;
}

/**
 * Everything long, paid and CPU-heavy running in this process: video jobs and
 * Flipbook workers. Both kinds of work check the same FOCUS_MAX_ACTIVE_JOBS
 * cap against this one number, so neither can slip past the other.
 */
export function activeWorkCount(): number {
  return running.size + activeFlipbookCount() + activeCharacterCount();
}

function assertEffectEnabled(effect: EffectId): void {
  if (!effectEnabled(effect)) throw new AppError("effect_disabled", 400, "That effect isn’t available.");
}

export async function createJob(request: EditRequest, gate?: PaidWorkGate): Promise<EditJob> {
  assertEffectEnabled(request.effect);
  const video = await getVideo(request.videoId);
  void cleanupJobs();
  const key = requestKey(request);

  // Deduplicate: the same instruction on the same video returns the live or
  // finished job instead of starting new paid work.
  const existing = await findJobByKey(key);
  if (existing && !["failed", "canceled"].includes(existing.status)) return existing;
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: video.normalized.frameCount });

  const now = new Date().toISOString();
  const job = await saveJob({
    id: randomUUID(),
    videoId: video.id,
    request,
    status: "interpreting",
    detail: "Reading your instruction with Muse Spark",
    phase: "understanding",
    progress: 0.05,
    plan: null,
    segmentationId: null,
    objects: [],
    selection: [],
    reused: { plan: false, segmentation: false },
    error: null,
    params: null,
    temporalSuggestion: null,
    render: null,
    resultUrl: null,
    chat: [],
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
      const failure = error instanceof AppError ? error : new AppError("internal_error", 500, "Something went wrong while processing your edit. Try again.");
      if (!(error instanceof AppError)) console.error("[focus] job failed", error);
      else if (failure.detail) console.warn(`[focus] job ${id} failed: ${failure.code} — ${failure.detail}`);
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

/** The stored gap-filled variant of a concept segmentation with the most tracked frames, if any. */
async function filledVariant(video: VideoAsset, conceptId: string): Promise<Tracking | null> {
  const names = await readdir(path.join(videoDir(video.id), "segmentations")).catch(() => [] as string[]);
  let best: Tracking | null = null;
  for (const name of names.filter((entry) => entry.startsWith(`${conceptId}+g-`) && entry.endsWith(".json"))) {
    const tracking = await readTracking(video, name.slice(0, -5)).catch(() => null);
    if (tracking && (!best || tracking.frames.length > best.frames.length)) best = tracking;
  }
  return best;
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
  // Cached plans can outlive the build that enabled their effect.
  assertEffectEnabled(effectFamily(plan.effect));
  // The instruction named an effect from another family: the job follows it,
  // so render settings and the editor tabs match what is rendered.
  const family = effectFamily(plan.effect);
  if (family !== request.effect) await patchJob(id, { request: { ...request, effect: family } });
  if (!plan.supported) {
    await patchJob(id, {
      plan,
      status: "failed",
      detail: null,
      error: { code: "unsupported_edit", message: plan.unsupportedReason ?? "Focus can’t make that kind of edit yet." },
      reused: { plan: planReused, segmentation: false },
    });
    return;
  }
  if (plan.needsClarification) {
    await patchJob(id, {
      plan,
      status: "awaiting_clarification",
      detail: plan.clarificationQuestion ?? "What should stand out?",
      progress: 0.15,
      reused: { plan: planReused, segmentation: false },
    });
    return;
  }

  await patchJob(id, {
    plan,
    status: "segmenting",
    detail: `Finding “${plan.target.concept}” with SAM 3.1`,
    phase: "finding",
    progress: 0.15,
    reused: { plan: planReused, segmentation: false },
  });

  let lastWrite = 0;
  const conceptId = segmentationKey(plan.target.concept);
  const { tracking: conceptTracking, reused } = await trackingFor(
    video,
    conceptId,
    { kind: "concept", concept: plan.target.concept },
    signal,
    (fraction) => {
      // Throttled: progress is written at most every 400 ms.
      if (Date.now() - lastWrite < 400) return;
      lastWrite = Date.now();
      void patchProgress(id, { progress: 0.15 + fraction * 0.8, phase: "tracking", detail: `Tracking “${plan.target.concept}” · ${Math.round(fraction * video.normalized.frameCount)}/${video.normalized.frameCount} frames` });
    },
  );
  if (signal.aborted) return;
  // A gap-filled version of this same segmentation (a superset: same objects,
  // more frames) is reused when one exists, so the first render is complete.
  const filled = await filledVariant(video, conceptId);
  const segmentationId = filled?.id ?? conceptId;
  const tracking = filled ?? conceptTracking;

  if (tracking.objects.length === 0) {
    await patchJob(id, {
      status: "failed",
      detail: null,
      segmentationId,
      reused: { plan: planReused, segmentation: reused },
      error: { code: "no_match", message: `SAM 3.1 couldn’t find “${plan.target.concept}” in the clip. Try naming the subject another way.` },
    });
    return;
  }

  const ids = tracking.objects.map((object) => object.id);
  // "several": what was found is preselected, and the job waits so the user
  // can click the other subjects in the video.
  const several = plan.target.selection === "several";
  const autoSelect = plan.target.selection === "all" ? ids : ids.length === 1 && !several ? ids : [];
  await patchJob(id, {
    // Straight to rendering when nothing needs choosing: no transient
    // ready_to_render a poller could mistake for a resting state.
    status: autoSelect.length ? "rendering" : "awaiting_selection",
    detail: autoSelect.length
      ? "Preparing the render"
      : several
        ? "Click each other subject in the video to add it."
        : `Found ${ids.length} matches. Pick the ones that should stand out.`,
    phase: autoSelect.length ? "applying" : null,
    progress: autoSelect.length ? 0 : 1,
    segmentationId,
    objects: tracking.objects,
    selection: several ? ids : autoSelect,
    reused: { plan: planReused, segmentation: reused },
  });
  if (autoSelect.length) await renderJob(id, video, null, signal);
}

export function renderKey(segmentationId: string, selection: readonly string[], params: RenderParams): string {
  return `r-${hash(JSON.stringify({ v: RENDERER_VERSION, ...(params.effect === "time_freeze_echo" ? { temporal: TEMPORAL_RENDERER_VERSION } : {}), segmentationId, selection: [...selection].sort(), params }))}`;
}

/** The render key is in each URL so a re-render never hits a cached earlier result. */
function renderUrls(jobId: string, key: string): RenderResult["urls"] {
  return {
    video: `/api/jobs/${jobId}/result?kind=output&r=${key}`,
    compare: `/api/jobs/${jobId}/result?kind=compare&r=${key}`,
    download: `/api/jobs/${jobId}/result?kind=output&download=1&r=${key}`,
  };
}

/** Renders (or reuses) the effect for a job's current selection. Runs inside a job worker. */
async function renderJob(id: string, video: VideoAsset, requested: RenderParams | null, signal: AbortSignal): Promise<void> {
  const job = await readJob(id);
  if (!job.plan || !job.segmentationId || job.selection.length === 0) {
    throw new AppError("render_not_ready", 409, "Choose your subject before rendering.");
  }
  let params = requested ?? job.params ?? defaultParams(job.plan);
  assertEffectEnabled(effectFamily(params.effect));
  const segmentationId = job.segmentationId;
  const selection = job.selection;
  let detectedTracking: Tracking | null = null;
  let temporalSuggestion: TemporalSuggestion | null = null;
  if (params.effect === "time_freeze_echo" && params.trigger.mode === "auto") {
    detectedTracking = await readTracking(video, segmentationId);
    if (!detectedTracking) throw new AppError("tracking_not_found", 404, "Your saved subject tracking is no longer available.");
    const track = selectionTrack(detectedTracking, selection);
    // A changing union of several identities is not one subject's movement.
    temporalSuggestion = selection.length === 1 ? suggestTemporalEvent(track, params.trigger.event!, video.normalized) : null;
    if (temporalSuggestion) {
      // Never trust a client/model timestamp marked auto: resolve it from the
      // current selection, including on re-render after selection changes.
      params = { ...params, trigger: { mode: "auto", event: temporalSuggestion.event, timestampMs: temporalSuggestion.timestampMs } };
      const plan = planFreeze(params, video.normalized);
      if (checkTemporalTracking(track, { triggerFrame: plan.triggerFrame, sampleFrames: plan.requestedSamples }).error) temporalSuggestion = null;
    }
    if (!temporalSuggestion) {
      await patchJob(id, {
        status: "ready_to_render", detail: "No reliable automatic moment was found. Choose the freeze point on the timeline.",
        phase: null, progress: 1, params: { ...params, trigger: { mode: "manual" } },
        temporalSuggestion: null, render: null, resultUrl: null, error: null,
      });
      return;
    }
  }
  // A freeze needs its moment before anything renders. Without one, the job
  // rests until the user places the freeze point; nothing is guessed.
  if (params.effect === "time_freeze_echo" && params.trigger.timestampMs === undefined) {
    await patchJob(id, { status: "ready_to_render", detail: "Choose the freeze point on the timeline.", phase: null, progress: 1, params, temporalSuggestion: null, render: null, resultUrl: null, error: null });
    return;
  }
  const key = renderKey(segmentationId, selection, params);
  await patchJob(id, { status: "rendering", detail: "Preparing the render", phase: "applying", progress: 0, params, temporalSuggestion, error: null });

  const dir = path.join(videoDir(video.id), "renders", key);
  const cached = await readFile(path.join(dir, "meta.json"), "utf8").then((raw) => RenderResultSchema.safeParse(JSON.parse(raw)), () => null);
  let result: RenderResult;
  if (cached?.success) {
    result = cached.data;
  } else {
    // Render keys are local to a video directory. Equal settings on two
    // clips must not share a worker result or leave one clip without files.
    const flightKey = `${video.id}/${key}`;
    let pending = inflightRenders.get(flightKey);
    if (!pending) {
      pending = renderLimiter
        .run(async () => {
          const tracking = detectedTracking ?? await readTracking(video, segmentationId);
          if (!tracking) throw new AppError("tracking_not_found", 404, "Your saved subject tracking is no longer available.");
          const temp = `${dir}.tmp-${process.pid}-${Date.now()}`;
          await mkdir(temp, { recursive: true });
          try {
            const started = Date.now();
            let lastWrite = 0;
            const output = await renderVideo({
              normalizedPath: path.join(videoDir(video.id), VIDEO_FILES.normalized),
              media: video.normalized,
              masks: trackingMaskSource(tracking, selection, video.normalized),
              params,
              outputDir: temp,
              signal,
              onProgress: (fraction) => {
                const done = fraction >= 1;
                // Throttled, except the last frame: that is the encoding signal.
                if (!done && Date.now() - lastWrite < 300) return;
                lastWrite = Date.now();
                void patchRender(id, {
                  progress: fraction * 0.9,
                  phase: done ? "encoding" : "applying",
                  detail: done ? "Finishing the MP4" : `Applying the effect · ${Math.round(fraction * video.normalized.frameCount)}/${video.normalized.frameCount} frames`,
                });
              },
            });
            void patchRender(id, { progress: 0.92, phase: "encoding", detail: "Verifying the MP4" });
            const verified = await verifyOutput(path.join(temp, "output.mp4"), {
              width: output.width,
              height: output.height,
              fps: video.normalized.fps,
              frameCount: output.frameCount,
              hasAudio: video.normalized.hasAudio,
              ...(params.effect === "time_freeze_echo" ? { timingToleranceSeconds: Math.max(1 / video.normalized.fps, 1024 / 48000) } : {}),
            });
            const freeze = output.freeze && params.effect === "time_freeze_echo" ? { ...output.freeze.plan, resume: params.resume } : undefined;
            void patchRender(id, { progress: 0.95, phase: "encoding", detail: "Preparing the comparison" });
            await renderComparison({
              normalizedPath: path.join(videoDir(video.id), VIDEO_FILES.normalized),
              outputPath: path.join(temp, "output.mp4"),
              comparePath: path.join(temp, "compare.mp4"),
              width: output.width,
              height: output.height,
              background: params.effect === "break_frame" ? params.background : "dark",
              freeze,
              signal,
            });
            if (freeze) await verifyOutput(path.join(temp, "compare.mp4"), {
              width: output.width, height: output.height * 2, fps: video.normalized.fps,
              frameCount: output.frameCount, hasAudio: video.normalized.hasAudio,
              timingToleranceSeconds: Math.max(1 / video.normalized.fps, 1024 / 48000),
            });
            const meta: RenderResult = {
              key,
              params,
              width: output.width,
              height: output.height,
              fps: video.normalized.fps,
              frameCount: output.frameCount,
              durationSeconds: verified.durationSeconds,
              hasAudio: video.normalized.hasAudio,
              framesWithoutMask: output.framesWithoutMask,
              breakoutFrameRatio: output.breakoutFrameRatio,
              warnings: output.warnings,
              temporal: freeze
                ? { triggerFrame: freeze.triggerFrame, freezeStart: freeze.freezeStart, freezeFrames: freeze.freezeFrames, echoFrames: [...output.freeze!.echoFrames], resume: freeze.resume }
                : null,
              renderMs: Date.now() - started,
              createdAt: new Date().toISOString(),
              urls: renderUrls(id, key),
            };
            await writeFile(path.join(temp, "meta.json"), JSON.stringify(meta));
            await rm(dir, { recursive: true, force: true });
            await rename(temp, dir);
            return meta;
          } catch (error) {
            await rm(temp, { recursive: true, force: true });
            throw error;
          }
        })
        .finally(() => inflightRenders.delete(flightKey));
      inflightRenders.set(flightKey, pending);
    }
    result = await pending;
  }
  if (signal.aborted) return;
  await patchJob(id, {
    status: "completed",
    detail: null,
    progress: 1,
    params,
    temporalSuggestion,
    render: {
      ...result, urls: renderUrls(id, key),
      warnings: temporalSuggestion
        ? [...result.warnings, `${temporalSuggestion.reason} Confidence: ${Math.round(temporalSuggestion.confidence * 100)}%. Review the freeze point and adjust it manually if needed.`]
        : result.warnings,
    },
    resultUrl: renderUrls(id, key).video,
  });
}

/** A render progress update: dropped once the job left the rendering state. */
function patchRender(id: string, patch: Pick<EditJob, "progress"> & Partial<Pick<EditJob, "detail" | "phase">>): Promise<unknown> {
  return withJobLock(id, async () => {
    const current = await readJob(id);
    if (current.status !== "rendering") return current;
    return saveJob({ ...current, ...patch });
  }).catch(() => undefined);
}

/**
 * User-triggered (re)render with new parameters. Masks are reused; no AI call.
 * `followEffect` lets the AI editor move the job to another effect family:
 * the masks work for every effect, only the editor tabs have to follow.
 */
export async function startRender(id: string, requested?: RenderParamsInput, options: { followEffect?: boolean } = {}): Promise<EditJob> {
  const job = await getJob(id);
  if (!["ready_to_render", "completed", "failed"].includes(job.status) || !job.plan || job.selection.length === 0) {
    throw new AppError("render_not_allowed", 409, "This edit can’t be rendered right now.");
  }
  let params: RenderParams | null = null;
  let request = job.request;
  if (requested) {
    params = RenderParamsSchema.parse(requested);
    if (!EFFECT_PLAN_EFFECTS[job.request.effect].includes(params.effect)) {
      if (!options.followEffect) throw new AppError("effect_mismatch", 400, "That setting doesn’t apply to the selected effect.");
      request = { ...request, effect: effectFamily(params.effect) };
    }
  }
  // An omitted body reuses saved params; it must obey the same release gate.
  const effective = params ?? job.params ?? defaultParams(job.plan);
  assertEffectEnabled(effectFamily(effective.effect));
  const video = await getVideo(job.videoId);
  if (params?.effect === "time_freeze_echo") {
    const problem = triggerProblem(params.trigger, video.normalized);
    if (problem) throw new AppError("invalid_trigger", 400, problem);
  }
  const updated = await withJobLock(id, () => saveJob({ ...job, request, status: "rendering", detail: "Preparing the render", phase: "applying", progress: 0, error: null }));
  start(id, (signal) => renderJob(id, video, params, signal));
  return updated;
}

const chatId = () => randomUUID().slice(0, 12);

/** Appends turns to the conversation, keeping the newest. */
function appendChat(job: EditJob, ...messages: ChatMessage[]): ChatMessage[] {
  return [...job.chat, ...messages].slice(-CHAT_HISTORY_MAX);
}

/**
 * One AI editor turn about a finished result. Muse Spark turns the request
 * into a bounded parameter patch; a real change starts a re-render from the
 * stored masks. A request that needs another subject comes back as a
 * suggested instruction for a new edit, never as silent new SAM work.
 */
export async function chatEdit(id: string, message: string): Promise<EditJob> {
  const job = await getJob(id);
  if (job.status !== "completed" || !job.render || !job.plan) {
    throw new AppError("chat_not_allowed", 409, "The AI editor is available once your edited video is ready.");
  }
  assertEffectEnabled(effectFamily(job.render.params.effect));
  const video = await getVideo(job.videoId);
  const current = job.render.params;
  const turn = await services.assist({
    message,
    history: job.chat,
    params: current,
    family: job.request.effect,
    concept: job.plan.target.concept,
    media: video.normalized,
    videoId: video.id,
  });
  const next = turn.action === "adjust" ? applyParamsPatch(current, turn.patch) : null;
  const changes = next ? describeParamChanges(current, next) : [];
  const now = new Date().toISOString();
  const user: ChatMessage = { id: chatId(), role: "user", text: message, at: now };
  const reply: ChatMessage = {
    id: chatId(),
    role: "assistant",
    text: turn.reply,
    at: now,
    ...(next && changes.length ? { changes, params: next } : {}),
    ...(turn.newInstruction ? { suggestion: turn.newInstruction } : {}),
  };
  const saved = await withJobLock(id, async () => {
    const latest = await readJob(id);
    return saveJob({ ...latest, chat: appendChat(latest, user, reply) });
  });
  if (!next || !changes.length || saved.status !== "completed") return saved;
  return startRender(id, next, { followEffect: true });
}

/** Brings back the render of an earlier AI editor turn. Cached renders return at once; no AI call. */
export async function restoreChatTurn(id: string, messageId: string): Promise<EditJob> {
  const job = await getJob(id);
  const turn = job.chat.find((message) => message.id === messageId && message.params);
  if (!turn?.params) throw new AppError("chat_turn_not_found", 404, "That version is no longer available.");
  return startRender(id, turn.params, { followEffect: true });
}

/** Every edit made on a clip, newest first: what a project attaches when it is first saved. */
export async function jobsForVideo(videoId: string): Promise<EditJob[]> {
  const names = await readdir(jobsDir()).catch(() => [] as string[]);
  const jobs: EditJob[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const job = await getJob(name.slice(0, -5)).catch(() => null);
    if (job?.videoId === videoId) jobs.push(job);
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function resultFile(id: string, kind: "output" | "compare", version?: string): Promise<{ path: string; downloadName: string }> {
  const job = await getJob(id);
  if (version === undefined && (job.status !== "completed" || !job.render)) throw new AppError("result_not_ready", 409, "Your edited video isn’t ready yet.");
  const key = version ?? job.render!.key;
  if (!/^r-[0-9a-f]{16}$/.test(key)) throw new AppError("media_not_found", 404, "This file is no longer available.");
  // A version is resolved only inside this job's video. A committed metadata
  // file proves the render completed; an in-flight directory is never served.
  const dir = path.join(videoDir(job.videoId), "renders", key);
  const render = await readFile(path.join(dir, "meta.json"), "utf8")
    .then((raw) => RenderResultSchema.parse(JSON.parse(raw))).catch(() => null);
  if (!render || render.key !== key) throw new AppError("media_not_found", 404, "This file is no longer available.");
  const file = path.join(dir, `${kind}.mp4`);
  const base = (await getVideo(job.videoId)).originalName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "video";
  const effect = render.params.effect.replace(/_/g, "-");
  return { path: file, downloadName: `focus-${effect}-${base}.mp4` };
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
  assertEffectEnabled(job.request.effect);
  if (!["awaiting_selection", "ready_to_render", "completed"].includes(job.status)) {
    throw new AppError("selection_not_allowed", 409, "This edit isn’t waiting for a subject selection.");
  }
  const known = new Set(job.objects.map((object) => object.id));
  const unique = [...new Set(objectIds)];
  if (unique.some((objectId) => !known.has(objectId))) throw new AppError("unknown_object", 400, "That subject wasn’t found in the tracking data.");
  await withJobLock(id, () => saveJob({ ...job, selection: unique, status: "ready_to_render", detail: null }));
  return startRender(id);
}

/** Re-opens selection without any API call. */
export async function reopenSelection(id: string): Promise<EditJob> {
  const job = await getJob(id);
  assertEffectEnabled(job.request.effect);
  if (!["ready_to_render", "completed"].includes(job.status)) throw new AppError("selection_not_allowed", 409, "Your selection can’t be changed right now.");
  return saveJob({ ...job, status: "awaiting_selection", detail: "Pick what stands out." });
}

/**
 * A click on the preview. If an existing mask already covers the point, that
 * object is selected for free; only an uncovered point costs a SAM pass.
 */
export async function refineWithPoint(id: string, refine: RefineRequest, gate?: PaidWorkGate): Promise<EditJob> {
  const job = await getJob(id);
  assertEffectEnabled(job.request.effect);
  if (!["awaiting_selection", "ready_to_render", "completed"].includes(job.status) || !job.segmentationId) {
    throw new AppError("refine_not_allowed", 409, "This edit doesn’t support selecting a subject by point right now.");
  }
  const video = await getVideo(job.videoId);
  const { width, height, frameCount } = video.normalized;
  if (refine.frameIndex >= frameCount || refine.point.x >= width || refine.point.y >= height) {
    throw new AppError("invalid_point", 400, "Choose a point inside the video.");
  }
  const base = await readTracking(video, job.segmentationId);
  if (!base) throw new AppError("tracking_not_found", 404, "Your saved subject tracking is no longer available.");

  const hit = hitTest(frameAt(base, refine.frameIndex), refine.point.x, refine.point.y);
  if (hit) return saveJob({ ...job, selection: [hit], status: "awaiting_selection", detail: null });

  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: frameCount });
  const pointObjects = base.objects.filter((object) => object.source === "point").length;
  const objectId = 100 + pointObjects;
  const pointId = `p-${hash(`${refine.frameIndex}:${refine.point.x}:${refine.point.y}`)}`;
  const previous = job.segmentationId;
  const updated = await saveJob({ ...job, status: "segmenting", detail: "Finding the subject at that point with SAM 3.1", phase: "finding", progress: 0.2 });

  start(id, async (signal) => {
    const { tracking: extra } = await trackingFor(
      video,
      pointId,
      { kind: "point", objectId, frameIndex: refine.frameIndex, point: refine.point },
      signal,
      (fraction) => void patchProgress(id, { progress: 0.2 + fraction * 0.75, phase: "tracking" }),
    );
    if (signal.aborted) return;
    if (extra.objects.length === 0) {
      await patchJob(id, { status: "awaiting_selection", detail: "SAM 3.1 found nothing at that point. Try another spot.", progress: 1 });
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
      // Adds to what was already chosen: a click means "this one too".
      selection: [...new Set([...job.selection, ...extra.objects.map((object) => object.id)])],
    });
  });
  return updated;
}

/**
 * Completes tracking for the selected objects on frames the concept pass
 * missed: one SAM 3.1 pass prompted with each object's own box on its first
 * tracked frame, propagated both ways. Only missing frames are filled; it is a
 * paid call, so it only runs when the user asks.
 */
export async function fillGaps(id: string, gate?: PaidWorkGate): Promise<EditJob> {
  const job = await getJob(id);
  assertEffectEnabled(job.request.effect);
  if (!["awaiting_selection", "ready_to_render", "completed"].includes(job.status) || !job.segmentationId || job.selection.length === 0) {
    throw new AppError("fill_not_allowed", 409, "Choose your subject first.");
  }
  const video = await getVideo(job.videoId);
  const base = await readTracking(video, job.segmentationId);
  if (!base) throw new AppError("tracking_not_found", 404, "Your saved subject tracking is no longer available.");
  const { frameCount } = video.normalized;
  const targets = job.selection
    .map((objectId) => base.objects.find((object) => object.id === objectId))
    .filter((object): object is NonNullable<typeof object> => Boolean(object) && object!.framesPresent < frameCount && /^\d+$/.test(object!.id))
    .map((object) => {
      const frame = frameAt(base, object.firstFrame)!;
      const box = frame.objects.find((entry) => entry.objectId === object.id)!.box;
      return { id: Number(object.id), frameIndex: object.firstFrame, box };
    });
  if (targets.length === 0) throw new AppError("nothing_to_fill", 409, "Your subject is already tracked throughout the clip.");
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: frameCount });

  const wasCompleted = job.status === "completed";
  const previousStatus = job.status;
  const extraId = `g-${hash(`${job.segmentationId}|${JSON.stringify(targets)}`)}`;
  const mergedId = `${job.segmentationId.split("+")[0]}+${extraId}`;
  const updated = await withJobLock(id, () => saveJob({ ...job, status: "segmenting", detail: "Completing the tracking with SAM 3.1", phase: "finding", progress: 0.15, error: null }));

  start(id, async (signal) => {
    const { tracking: extra } = await trackingFor(
      video,
      extraId,
      { kind: "box", objects: targets },
      signal,
      (fraction) => void patchProgress(id, { progress: 0.15 + fraction * 0.8, phase: "tracking", detail: `Completing the tracking · ${Math.round(fraction * frameCount)}/${frameCount} frames` }),
    );
    if (signal.aborted) return;
    const merged = fillTracking(base, extra, targets.map((target) => String(target.id)));
    await writeJson(segmentationFile(video, mergedId), { ...merged, id: mergedId });
    await patchJob(id, {
      status: wasCompleted ? "rendering" : previousStatus,
      detail: wasCompleted ? "Preparing the render" : null,
      phase: wasCompleted ? "applying" : null,
      progress: wasCompleted ? 0 : 1,
      segmentationId: mergedId,
      objects: merged.objects,
    });
    if (wasCompleted) await renderJob(id, video, null, signal);
  });
  return updated;
}

/** Removes videos (with their masks and renders) untouched for a day, and orphaned render temp dirs. Saved projects keep theirs. */
export async function cleanupVideos(): Promise<void> {
  const root = path.join(dataRoot(), "videos");
  const ids = await readdir(root).catch(() => [] as string[]);
  const busy = new Set<string>((await retainedIds()).videos);
  for (const jobId of running.keys()) {
    const job = await readJob(jobId).catch(() => null);
    if (job) busy.add(job.videoId);
  }
  for (const id of ids) {
    if (busy.has(id)) continue;
    const dir = path.join(root, id);
    const info = await stat(path.join(dir, VIDEO_FILES.asset)).catch(() => null);
    // Uploads have no asset.json until probing and normalization finish.
    // Give incomplete directories the same retention window as ready clips.
    const touched = info ?? await stat(dir).catch(() => null);
    if (!touched) continue;
    if (Date.now() - touched.mtimeMs > JOB_TTL_MS) {
      await rm(dir, { recursive: true, force: true });
      continue;
    }
    if (!info) continue;
    const renders = await readdir(path.join(dir, "renders")).catch(() => [] as string[]);
    for (const name of renders.filter((entry) => entry.includes(".tmp-"))) {
      if (inflightRenders.size === 0) await rm(path.join(dir, "renders", name), { recursive: true, force: true });
    }
  }
}

/** Removes jobs older than a day, and jobs whose video is gone. Jobs in a saved project stay. */
export async function cleanupJobs(): Promise<void> {
  await cleanupVideos();
  const retained = (await retainedIds()).jobs;
  const names = await readdir(jobsDir()).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of names) {
    const file = path.join(jobsDir(), name);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    // A temp file is a write in progress unless it is old: only stale ones go.
    if (name.endsWith(".tmp")) {
      if (now - info.mtimeMs > 60_000) await rm(file, { force: true });
      continue;
    }
    const id = name.replace(/\.json$/, "");
    if (running.has(id) || retained.has(id)) continue;
    const job = await readJob(id).catch(() => null);
    const videoExists = job ? await stat(videoDir(job.videoId)).then(() => true, () => false) : false;
    if (!job || !videoExists || now - info.mtimeMs > JOB_TTL_MS) await rm(file, { force: true });
  }
}
