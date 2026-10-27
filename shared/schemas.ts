import { z } from "zod";
import { FinishPatchSchema, RenderParamsSchema, RenderResultSchema, type RenderParamsOf } from "./render";
import { EchoSchema, FreezeDurationSchema, TEMPORAL_BOUNDS, TriggerEventSchema, TriggerSchema, triggerProblem } from "./temporal";
import { TemporalSuggestionSchema } from "./temporal-events";

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

/** The creative effects, in delivery order. "time-freeze" is behind NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS. */
export const EffectIdSchema = z.enum(["reality-shift", "break-the-frame", "motion-echo", "time-freeze"]);
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

export const PlanEffectSchema = z.enum(["selective_color", "background_blur", "spotlight", "break_frame", "motion_echo", "time_freeze_echo"]);
export type PlanEffect = z.infer<typeof PlanEffectSchema>;

/** Which plan effects each editor effect may resolve to. */
export const EFFECT_PLAN_EFFECTS: Record<EffectId, readonly PlanEffect[]> = {
  "reality-shift": ["selective_color", "background_blur", "spotlight"],
  "break-the-frame": ["break_frame"],
  "motion-echo": ["motion_echo"],
  "time-freeze": ["time_freeze_echo"],
};

/** The editor effect family a plan effect belongs to. */
export function effectFamily(effect: PlanEffect): EffectId {
  return (Object.keys(EFFECT_PLAN_EFFECTS) as EffectId[]).find((id) => EFFECT_PLAN_EFFECTS[id].includes(effect)) ?? "reality-shift";
}

/**
 * What the planner model may return. Constrained to supported operations; the
 * compositor never receives free-form arguments from a model.
 */
export const EditPlanSchema = z.object({
  supported: z.boolean(),
  unsupportedReason: z.string().max(240).optional(),
  target: z.object({
    concept: ConceptSchema,
    /**
     * single: one instance. all: every instance of the concept. several: more
     * than one subject of different kinds; the user adds the rest by clicking.
     */
    selection: z.enum(["single", "all", "several"]),
    description: z.string().max(240).optional(),
  }),
  effect: PlanEffectSchema,
  parameters: z.object({
    intensity: z.number().min(0).max(1).optional(),
    trailCount: z.number().int().min(2).max(8).optional(),
    trailSpacingMs: z.number().int().min(40).max(1000).optional(),
    /** Finishing touches named in the instruction ("cinematic", "gold glow"). */
    finish: FinishPatchSchema.optional(),
    /**
     * Time Freeze only. The event says when to freeze; finding its frame is
     * the motion detector's job, so a plan never carries a timestamp.
     */
    triggerEvent: TriggerEventSchema.optional(),
    echoCount: z.number().int().min(TEMPORAL_BOUNDS.echoCount[0]).max(TEMPORAL_BOUNDS.echoCount[1]).optional(),
    echoSpacingMs: z.number().int().min(TEMPORAL_BOUNDS.echoSpacingMs[0]).max(TEMPORAL_BOUNDS.echoSpacingMs[1]).optional(),
    freezeDurationMs: FreezeDurationSchema.optional(),
  }),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().max(240).optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

/**
 * The structured temporal edit: what to freeze, when, and how the echoes
 * look. Bounds are fixed here; the trigger's range depends on the clip, so
 * `parseTemporalEdit` checks it against the normalized media. Unknown keys
 * are rejected: nothing outside this shape can ride along.
 */
export const TemporalEditSchema = z.strictObject({
  type: z.literal("time_freeze_echo"),
  target: ConceptSchema,
  trigger: TriggerSchema,
  freezeDurationMs: FreezeDurationSchema,
  echo: EchoSchema,
  resume: z.boolean(),
});
export type TemporalEdit = z.infer<typeof TemporalEditSchema>;

export function parseTemporalEdit(input: unknown, media: Pick<NormalizedMedia, "fps" | "frameCount" | "durationSeconds">) {
  return TemporalEditSchema.superRefine((edit, context) => {
    const problem = triggerProblem(edit.trigger, media);
    if (problem) context.addIssue({ code: "custom", path: ["trigger", "timestampMs"], message: problem });
  }).safeParse(input);
}

/** The temporal edit a set of render params describes, for a tracked concept. */
export function temporalEditOf(params: RenderParamsOf<"time_freeze_echo">, target: string): TemporalEdit {
  return TemporalEditSchema.parse({
    type: "time_freeze_echo",
    target,
    trigger: params.trigger,
    freezeDurationMs: params.freezeDurationMs,
    echo: params.echo,
    resume: params.resume,
  });
}

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

export const CHAT_MESSAGE_MAX_LENGTH = 300;
export const CHAT_HISTORY_MAX = 40;

/** One turn of the AI editor conversation, stored with the job. */
export const ChatMessageSchema = z.object({
  id: z.string().max(40),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(600),
  at: z.iso.datetime(),
  /** Assistant only: what changed, in short labels. */
  changes: z.array(z.string().max(80)).max(16).optional(),
  /** Assistant only: the parameters this turn rendered, so it can be restored for free. */
  params: RenderParamsSchema.optional(),
  /** Assistant only: an instruction for a new edit (another subject needs new masks). */
  suggestion: z.string().max(PROMPT_MAX_LENGTH).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

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
  /** Geometric event suggestion for the current automatic freeze; manual choices keep this null. */
  temporalSuggestion: TemporalSuggestionSchema.nullable().default(null),
  render: RenderResultSchema.nullable().default(null),
  resultUrl: z.string().nullable(),
  /** The AI editor conversation about this result. */
  chat: z.array(ChatMessageSchema).max(CHAT_HISTORY_MAX).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type EditJob = z.infer<typeof EditJobSchema>;

export const SelectionRequestSchema = z.object({
  objectIds: z.array(z.string().max(16)).min(1).max(16),
});

export const RenderRequestSchema = z.object({ params: RenderParamsSchema.optional() });

export const ChatRequestSchema = z.union([
  z.object({ message: z.string().trim().min(2).max(CHAT_MESSAGE_MAX_LENGTH) }),
  /** Brings back the render of an earlier assistant turn; no AI call. */
  z.object({ restore: z.string().max(40) }),
]);

export const RefineRequestSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  point: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
});
export type RefineRequest = z.infer<typeof RefineRequestSchema>;

/**
 * Ideas for the composer, read from the clip's first frame: the subjects in
 * view and a few ready-to-use instructions per effect, all in English.
 */
export const SuggestionsSchema = z.object({
  subjects: z.array(z.string().trim().min(1).max(40)).max(6),
  ideas: z.object({
    "reality-shift": z.array(z.string().trim().min(3).max(90)).max(4),
    "break-the-frame": z.array(z.string().trim().min(3).max(90)).max(4),
    "motion-echo": z.array(z.string().trim().min(3).max(90)).max(4),
    "time-freeze": z.array(z.string().trim().min(3).max(90)).max(4).default([]),
  }),
});
export type Suggestions = z.infer<typeof SuggestionsSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    detail: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
