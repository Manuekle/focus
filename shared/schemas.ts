import { z } from "zod";
import { RenderParamsSchema, RenderResultSchema } from "./render";

// Contracts shared by the editor, the API routes and the processing services.
// Everything that crosses the network or comes back from a model is parsed
// with these schemas; nothing is trusted by shape alone.

export const VideoIdSchema = z.uuid();
export type VideoId = z.infer<typeof VideoIdSchema>;

export const SourceMediaSchema = z.object({
  sizeBytes: z.number().int().nonnegative(),
  container: z.string(),
  codec: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Degrees from the display matrix. Width/height above are already rotated. */
  rotation: z.number(),
  durationSeconds: z.number().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
});
export type SourceMedia = z.infer<typeof SourceMediaSchema>;

/** The exact frames that segmentation and the compositor will both use. */
export const NormalizedMediaSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  frameCount: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  codec: z.literal("h264"),
  hasAudio: z.boolean(),
});
export type NormalizedMedia = z.infer<typeof NormalizedMediaSchema>;

export const VideoAssetSchema = z.object({
  id: VideoIdSchema,
  originalName: z.string().min(1).max(255),
  createdAt: z.iso.datetime(),
  source: SourceMediaSchema,
  normalized: NormalizedMediaSchema,
  urls: z.object({
    preview: z.string(),
    poster: z.string(),
    source: z.string(),
  }),
});
export type VideoAsset = z.infer<typeof VideoAssetSchema>;

/** The three creative effects, in delivery order. */
export const EffectIdSchema = z.enum(["reality-shift", "break-the-frame", "motion-echo"]);
export type EffectId = z.infer<typeof EffectIdSchema>;

export const PROMPT_MIN_LENGTH = 3;
export const PROMPT_MAX_LENGTH = 500;

export const EditRequestSchema = z.object({
  videoId: VideoIdSchema,
  effect: EffectIdSchema,
  prompt: z.string().trim().min(PROMPT_MIN_LENGTH).max(PROMPT_MAX_LENGTH),
});
export type EditRequest = z.infer<typeof EditRequestSchema>;

/**
 * A SAM concept prompt: one short noun phrase, never an instruction. Letters,
 * digits, spaces, hyphens and apostrophes only, at most six words.
 */
export const ConceptSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(60)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u, "Concept must be a plain noun phrase")
  .refine((value) => value.split(/\s+/).length <= 6, "Concept must be at most six words");

export const PlanEffectSchema = z.enum(["selective_color", "background_blur", "break_frame", "motion_echo"]);
export type PlanEffect = z.infer<typeof PlanEffectSchema>;

/** Which plan effects each editor effect may resolve to. */
export const EFFECT_PLAN_EFFECTS: Record<EffectId, readonly PlanEffect[]> = {
  "reality-shift": ["selective_color", "background_blur"],
  "break-the-frame": ["break_frame"],
  "motion-echo": ["motion_echo"],
};

/**
 * What the planner model may return. Constrained to supported operations; the
 * compositor never receives free-form arguments from a model.
 */
export const EditPlanSchema = z.object({
  supported: z.boolean(),
  unsupportedReason: z.string().max(240).optional(),
  target: z.object({
    concept: ConceptSchema,
    selection: z.enum(["single", "all"]),
    description: z.string().max(240).optional(),
  }),
  effect: PlanEffectSchema,
  parameters: z.object({
    intensity: z.number().min(0).max(1).optional(),
    trailCount: z.number().int().min(2).max(8).optional(),
    trailSpacingMs: z.number().int().min(40).max(1000).optional(),
  }),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().max(240).optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const JobStatusSchema = z.enum([
  "uploaded",
  "validating",
  "preparing",
  "interpreting",
  "segmenting",
  "awaiting_clarification",
  "awaiting_selection",
  "ready_to_render",
  "rendering",
  "completed",
  "failed",
  "canceled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/**
 * understanding: Muse Spark is reading the instruction.
 * finding:       SAM request sent, no frame back yet.
 * tracking:      SAM is streaming tracked frames.
 * applying:      frames are being composited.
 * encoding:      all frames written; encoder flush, verification, comparison.
 */
export const JobPhaseSchema = z.enum(["understanding", "finding", "tracking", "applying", "encoding"]);
export type JobPhase = z.infer<typeof JobPhaseSchema>;

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["uploaded", "validating", "preparing", "interpreting", "segmenting", "rendering"];

export const TrackedObjectSummarySchema = z.object({
  id: z.string(),
  framesPresent: z.number().int().nonnegative(),
  firstFrame: z.number().int().nonnegative(),
  lastFrame: z.number().int().nonnegative(),
  meanConfidence: z.number().min(0).max(1).nullable(),
  meanArea: z.number().nonnegative(),
  source: z.enum(["concept", "point"]),
});
export type TrackedObjectSummary = z.infer<typeof TrackedObjectSummarySchema>;

export const EditJobSchema = z.object({
  id: z.uuid(),
  videoId: VideoIdSchema,
  request: EditRequestSchema,
  status: JobStatusSchema,
  /** Human-readable step currently running, for the processing panel. */
  detail: z.string().nullable(),
  /** Which real stage is running, from actual processing signals. */
  phase: JobPhaseSchema.nullable().default(null),
  /** 0–1 across the whole job. */
  progress: z.number().min(0).max(1),
  plan: EditPlanSchema.nullable(),
  segmentationId: z.string().nullable(),
  objects: z.array(TrackedObjectSummarySchema),
  selection: z.array(z.string()),
  /** True when plan and/or masks came from cache instead of a new API call. */
  reused: z.object({ plan: z.boolean(), segmentation: z.boolean() }),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** Effect parameters of the current or last render. */
  params: RenderParamsSchema.nullable().default(null),
  render: RenderResultSchema.nullable().default(null),
  resultUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type EditJob = z.infer<typeof EditJobSchema>;

export const SelectionRequestSchema = z.object({
  objectIds: z.array(z.string().max(16)).min(1).max(16),
});

export const RenderRequestSchema = z.object({ params: RenderParamsSchema.optional() });

export const RefineRequestSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  point: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
});
export type RefineRequest = z.infer<typeof RefineRequestSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
