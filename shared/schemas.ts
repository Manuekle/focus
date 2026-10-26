import { z } from "zod";

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
 * What the planner model may return. Constrained to supported operations; the
 * compositor never receives free-form arguments from a model.
 */
export const EditPlanSchema = z.object({
  target: z.object({
    concept: z.string().trim().min(1).max(80),
    selection: z.enum(["single", "all"]),
    description: z.string().max(240).optional(),
  }),
  effect: z.enum(["selective_color", "background_blur", "break_frame", "motion_echo"]),
  parameters: z.object({
    intensity: z.number().min(0).max(1).optional(),
    trailCount: z.number().int().min(2).max(8).optional(),
    trailSpacingMs: z.number().int().min(40).max(1000).optional(),
  }),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().max(240).optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

/** Pipeline stages after upload, in order. Upload and Describe happen in the client. */
export const PipelineStageSchema = z.enum(["identify", "track", "transform", "preview", "export"]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const JobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const EditJobSchema = z.object({
  id: z.uuid(),
  videoId: VideoIdSchema,
  request: EditRequestSchema,
  status: JobStatusSchema,
  stage: PipelineStageSchema.nullable(),
  /** 0–1 across the whole job. */
  progress: z.number().min(0).max(1),
  plan: EditPlanSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  resultUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type EditJob = z.infer<typeof EditJobSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
