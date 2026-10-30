import { z } from "zod";

// Reference Motion: a character image follows the movement of a driving video.
// The temporal generation runs on an external GPU worker
// (services/animation-worker); these schemas are the contract on both sides
// of Focus (browser ↔ API) and between Focus and the worker.

export const ENGINES = ["steadydancer", "wan-animate", "wan-zerogpu", "fake"] as const;
export const EngineSchema = z.enum(ENGINES);
export type Engine = z.infer<typeof EngineSchema>;

export const ENGINE_LABELS: Record<Engine, string> = {
  steadydancer: "SteadyDancer",
  "wan-animate": "Wan2.2-Animate",
  "wan-zerogpu": "Wan2.2 · HF ZeroGPU demo (experimental)",
  fake: "Test engine (no AI)",
};

/** Shortest segment each engine renders (the ZeroGPU demo starts at 2 s). */
export const ENGINE_MIN_SECONDS: Record<Engine, number> = { steadydancer: 1, "wan-animate": 1, "wan-zerogpu": 2, fake: 1 };

/** Engines that send the uploads to a third party's service instead of Focus's own worker. */
export const THIRD_PARTY_ENGINES: readonly Engine[] = ["wan-zerogpu"];

/** MVP: short segments only, until quality and VRAM are measured. */
export const MAX_SEGMENT_SECONDS = 3;
export const RESOLUTIONS = ["480p", "720p"] as const;
export const OUTPUT_FPS = [16, 24] as const;

export const JOB_STATUSES = [
  "queued",
  "validating",
  "awaiting_gpu",
  "preprocessing",
  "generating",
  "postprocessing",
  "uploading",
  "verifying",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ACTIVE_STATUSES: readonly JobStatus[] = ["queued", "validating", "awaiting_gpu", "preprocessing", "generating", "postprocessing", "uploading", "verifying", "cancel_requested"];
export const isActiveStatus = (status: JobStatus) => ACTIVE_STATUSES.includes(status);

/**
 * Stages that count toward measured progress, in order. Focus validates and
 * trims (validating), waits for the worker (awaiting_gpu, cold starts
 * included), the worker extracts poses (preprocessing), renders, encodes and
 * uploads; Focus verifies the file before calling it complete.
 */
export const PROGRESS_STAGES: readonly JobStatus[] = ["validating", "awaiting_gpu", "preprocessing", "generating", "postprocessing", "uploading", "verifying"];

export const ERROR_CODES = [
  "INPUT_INVALID",
  "POSE_NOT_FOUND",
  "GPU_UNAVAILABLE",
  "MODEL_OOM",
  "GENERATION_FAILED",
  "CANCELLED",
  "OUTPUT_INVALID",
  "TIMEOUT",
  "INTERRUPTED",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INPUT_INVALID: "The image or video can’t be used. Check the format, size and duration.",
  POSE_NOT_FOUND: "No person could be followed in the selected segment. Choose a segment where the whole body is visible.",
  GPU_UNAVAILABLE: "The animation engine isn’t available right now. Try again in a few minutes.",
  MODEL_OOM: "The engine ran out of GPU memory. Try a lower resolution or a shorter segment.",
  GENERATION_FAILED: "The engine couldn’t generate this animation.",
  CANCELLED: "Cancelled.",
  OUTPUT_INVALID: "The engine returned a video that didn’t pass verification, so it isn’t offered.",
  TIMEOUT: "The engine took too long and the job was stopped.",
  INTERRUPTED: "Processing was interrupted by a server restart.",
};

export const AssetIdSchema = z.uuid();
export const JobIdSchema = z.uuid();

export const AssetKindSchema = z.enum(["character", "driving"]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AnimationAssetSchema = z.object({
  id: AssetIdSchema,
  ownerId: z.string(),
  kind: AssetKindSchema,
  originalName: z.string().max(200),
  mime: z.string(),
  bytes: z.number().int().positive(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  createdAt: z.iso.datetime(),
});
export type AnimationAsset = z.infer<typeof AnimationAssetSchema>;

export const JobConfigSchema = z.object({
  startSeconds: z.number().min(0),
  durationSeconds: z.number().min(1).max(MAX_SEGMENT_SECONDS),
  resolution: z.enum(RESOLUTIONS).default("480p"),
  outputFps: z.union([z.literal(16), z.literal(24)]).default(24),
  interpolation: z.boolean().default(false),
  useAudio: z.boolean().default(false),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
});
export type JobConfig = z.infer<typeof JobConfigSchema>;

export const CreateJobRequestSchema = z.object({
  characterAssetId: AssetIdSchema,
  drivingVideoAssetId: AssetIdSchema,
  engine: EngineSchema.optional(),
  startSeconds: z.number().min(0),
  durationSeconds: z.number().min(1).max(MAX_SEGMENT_SECONDS).default(MAX_SEGMENT_SECONDS),
  resolution: z.enum(RESOLUTIONS).default("480p"),
  outputFps: z.union([z.literal(16), z.literal(24)]).default(24),
  interpolation: z.boolean().default(false),
  useAudio: z.boolean().default(false),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  idempotencyKey: z.string().min(8).max(80).regex(/^[\w-]+$/),
});
export type CreateJobRequest = z.input<typeof CreateJobRequestSchema>;

/** Files the worker may upload, and the only ones Focus serves back. */
export const OUTPUT_FILES = {
  "animation.mp4": { type: "video/mp4", maxBytes: 200 * 1024 * 1024 },
  "animation_rife.mp4": { type: "video/mp4", maxBytes: 200 * 1024 * 1024 },
  "pose_overlay.mp4": { type: "video/mp4", maxBytes: 100 * 1024 * 1024 },
  "retargeted_pose_preview.mp4": { type: "video/mp4", maxBytes: 100 * 1024 * 1024 },
  "preview.webp": { type: "image/webp", maxBytes: 20 * 1024 * 1024 },
  "frames.zip": { type: "application/zip", maxBytes: 300 * 1024 * 1024 },
  "poses.json": { type: "application/json", maxBytes: 20 * 1024 * 1024 },
  "retargeted_poses.json": { type: "application/json", maxBytes: 20 * 1024 * 1024 },
  "pose_confidence.json": { type: "application/json", maxBytes: 5 * 1024 * 1024 },
  "quality_report.json": { type: "application/json", maxBytes: 5 * 1024 * 1024 },
  "render_report.json": { type: "application/json", maxBytes: 5 * 1024 * 1024 },
} as const;
export type OutputName = keyof typeof OUTPUT_FILES;
export const OutputNameSchema = z.enum(Object.keys(OUTPUT_FILES) as [OutputName, ...OutputName[]]);
export const INPUT_FILES = { "character.png": "image/png", "driving.mp4": "video/mp4" } as const;
export type InputName = keyof typeof INPUT_FILES;
export const InputNameSchema = z.enum(["character.png", "driving.mp4"]);

export const OutputAssetSchema = z.object({ name: OutputNameSchema, type: z.string(), bytes: z.number().int().nonnegative() });

export const GpuProfileSchema = z.object({
  name: z.string().max(120).nullable(),
  vramTotalMb: z.number().nonnegative().nullable(),
  peakVramMb: z.number().nonnegative().nullable(),
});

export const VerificationSchema = z.object({
  codec: z.string(),
  pixelFormat: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number(),
  durationSeconds: z.number(),
  frames: z.number().int().nullable(),
  hasAudio: z.boolean(),
  blackRatio: z.number().min(0).max(1),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const JobEventSchema = z.object({ at: z.iso.datetime(), stage: JobStatusSchema, event: z.string().max(80), detail: z.string().max(400).optional() });

export const AnimationJobSchema = z.object({
  id: JobIdSchema,
  ownerId: z.string(),
  status: JobStatusSchema,
  /** Completed measured stages / all measured stages. Never animated. */
  progress: z.number().min(0).max(1),
  stageStartedAt: z.iso.datetime(),
  attempt: z.number().int().min(1),
  idempotencyKey: z.string(),
  retryKeys: z.array(z.string()).default([]),
  characterAssetId: AssetIdSchema,
  drivingVideoAssetId: AssetIdSchema,
  engine: EngineSchema,
  mode: z.literal("animation"),
  config: JobConfigSchema,
  inputFps: z.number().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  error: z.object({ code: ErrorCodeSchema, message: z.string(), recoverable: z.boolean() }).nullable(),
  workerRunId: z.string().nullable(),
  workerDetail: z.string().max(200).nullable(),
  timings: z.record(z.string(), z.number().nonnegative()),
  /** Seconds per stage as the worker measured them; short stages can fall between two polls. */
  workerTimings: z.record(z.string(), z.number().nonnegative()).default({}),
  gpu: GpuProfileSchema.nullable(),
  gpuSeconds: z.number().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  outputs: z.array(OutputAssetSchema),
  verification: VerificationSchema.nullable(),
  /** Produced by the test engine: a pipeline check, not an animation. */
  synthetic: z.boolean(),
  /** The flipbook this render was last opened in, and how (see ImportMethodSchema). */
  flipbookId: z.uuid().nullable().default(null),
  flipbookImport: z.enum(["muse", "background", "sam"]).nullable().default(null),
  events: z.array(JobEventSchema),
});
export type AnimationJob = z.infer<typeof AnimationJobSchema>;

export type EngineAvailability = {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly ready: boolean;
  readonly engines: readonly Engine[];
  readonly defaultEngine: Engine | null;
  readonly gpu: { readonly name: string | null; readonly vramTotalMb: number | null } | null;
  readonly gpuHourlyUsd: number | null;
  readonly maxSegmentSeconds: number;
  readonly detail: string | null;
};

// ── Focus ↔ worker ─────────────────────────────────────────────────────────

export const WorkerManifestSchema = z.object({
  jobId: JobIdSchema,
  attempt: z.number().int().min(1),
  engine: EngineSchema,
  mode: z.literal("animation"),
  seed: z.number().int(),
  resolution: z.enum(RESOLUTIONS),
  outputFps: z.number().int(),
  durationSeconds: z.number(),
  interpolation: z.boolean(),
  keepAudio: z.boolean(),
  inputs: z.object({
    character: z.object({ url: z.url(), sha256: z.string() }),
    driving: z.object({ url: z.url(), sha256: z.string() }),
  }),
  uploads: z.record(OutputNameSchema, z.url()),
  deadlineSeconds: z.number().int().positive(),
});
export type WorkerManifest = z.infer<typeof WorkerManifestSchema>;

export const WORKER_STAGES = ["queued", "validating", "preprocessing", "generating", "postprocessing", "uploading", "completed", "failed", "cancelled"] as const;

export const WorkerStatusSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  stage: z.enum(WORKER_STAGES),
  detail: z.string().max(200).nullable().optional(),
  error: z.object({ code: ErrorCodeSchema, message: z.string().max(400) }).nullable().optional(),
  uploaded: z.array(OutputNameSchema).default([]),
  timings: z.record(z.string(), z.number()).default({}),
  gpu: GpuProfileSchema.nullable().optional(),
  gpuSeconds: z.number().nullable().optional(),
  gpuHourlyUsd: z.number().nullable().optional(),
  synthetic: z.boolean().default(false),
}).loose();
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const WorkerReadySchema = z.object({
  ready: z.boolean(),
  engines: z.array(EngineSchema),
  gpu: z.object({ name: z.string().nullable(), vramTotalMb: z.number().nullable() }).nullable().optional(),
  gpuHourlyUsd: z.number().nullable().optional(),
  detail: z.string().nullable().optional(),
}).loose();

/**
 * How a render opens in Flipbook. "muse": the render is the movement guide and
 * Muse Image draws every frame from the character, tick by tick (the Flipbook
 * video-movement path). "background" / "sam": the render's own frames, cut
 * out by their flat background (free) or one SAM 3.1 video pass (paid).
 */
export const ImportMethodSchema = z.enum(["muse", "background", "sam"]);
export type ImportMethod = z.infer<typeof ImportMethodSchema>;

/** Muse drawings per second of a render: animation "on twos", half the cost of one per tick. Flipbook can change it. */
export const MUSE_DRAWING_FPS = 12;

export const referenceMotionUrls = {
  asset: (id: string) => `/api/animations/uploads/${id}/media`,
  output: (jobId: string, name: OutputName, download = false) => `/api/animations/jobs/${jobId}/results?file=${encodeURIComponent(name)}${download ? "&download=1" : ""}`,
};
