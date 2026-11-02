import { z } from "zod";

// Rotoscope: a video is cut into frames at a fixed rate and every frame is
// redrawn with the user's character, in order, behind a firewall that stops
// on the first frame that fails its checks (server/rotoscope/run-state.ts).

export const RotoscopeIdSchema = z.string().uuid();

/** The canvas every drawing, video frame and pose guide is cut to (server/rotoscope/draw.ts CANVAS). */
export const FRAME_SIZE = { width: 1024, height: 1536 } as const;
export const FRAME_RATIO = FRAME_SIZE.width / FRAME_SIZE.height;

export const ROTOSCOPE_LIMITS = {
  minFps: 1,
  maxFps: 24,
  defaultFps: 9,
  /** Longest stretch one run may cover, and most frames it may hold. */
  maxSeconds: 60,
  maxFrames: 600,
  /** New runs draw each frame once; `attempts` on a generate call may raise it up to maxAttempts. */
  defaultAttempts: 1,
  maxAttempts: 3,
  /** A pencil note: the comment's length and the marks image's size. */
  maxCommentLength: 600,
  maxMarkBytes: 8 * 1024 * 1024,
} as const;

/**
 * How frames are drawn: "auto" deforms an approved drawing onto the pose first (the character
 * rig) and falls back to the generators; "rig" only deforms; "muse" only generates.
 */
export const RendererSchema = z.enum(["auto", "rig", "muse"]);
export type Renderer = z.infer<typeof RendererSchema>;

/**
 * The character's real body, given before it is analysed: every drawing keeps its height and weight (the
 * identity line and each prompt say them). With the video person's height too, the character is drawn that
 * much taller or shorter than the person; without it, exactly as tall.
 */
export const MEASURE_LIMITS = { heightCm: { min: 50, max: 250 }, weightKg: { min: 10, max: 300 } } as const;
export const CharacterMeasuresSchema = z.object({
  heightCm: z.number().min(MEASURE_LIMITS.heightCm.min).max(MEASURE_LIMITS.heightCm.max).nullable().default(null),
  weightKg: z.number().min(MEASURE_LIMITS.weightKg.min).max(MEASURE_LIMITS.weightKg.max).nullable().default(null),
  personHeightCm: z.number().min(MEASURE_LIMITS.heightCm.min).max(MEASURE_LIMITS.heightCm.max).nullable().default(null),
});
export type CharacterMeasures = z.infer<typeof CharacterMeasuresSchema>;

/** The measures in a few words for a prompt ("1.60 m tall, 54 kg (BMI 21.1)"); null when none was given. */
export function measuresText(measures: Pick<CharacterMeasures, "heightCm" | "weightKg"> | null): string | null {
  if (!measures?.heightCm && !measures?.weightKg) return null;
  const height = measures.heightCm ? `${(measures.heightCm / 100).toFixed(2)} m tall` : null;
  const weight = measures.weightKg ? `${Math.round(measures.weightKg)} kg` : null;
  const bmi = measures.heightCm && measures.weightKg ? ` (BMI ${(measures.weightKg / (measures.heightCm / 100) ** 2).toFixed(1)})` : "";
  return [height, weight && `${weight}${bmi}`].filter(Boolean).join(", ");
}

/** extending: the next seconds of the video are being cut and measured (pipeline.ts extendRun). */
export const RotoscopePhaseSchema = z.enum(["preparing", "ready", "extending", "generating", "stopping", "failed"]);
export type RotoscopePhase = z.infer<typeof RotoscopePhaseSchema>;

/** Where the drawing of the current frame is, while a run draws. */
export const LIVE_STAGES = ["drawing", "measuring", "checking", "reviewing", "approved", "rejected"] as const;
export const RotoscopeLiveSchema = z.object({
  frame: z.number().int().min(1),
  attempt: z.number().int().min(1),
  /** This frame's try in the current run, 1 to maxAttempts. */
  tries: z.number().int().min(1),
  /** Tries this run gives the frame when it isn't the run's maxAttempts (a redraw's). */
  of: z.number().int().min(1).nullish(),
  stage: z.enum(LIVE_STAGES),
  /** The attempt's cut-out drawing can be fetched (stage checking onwards). */
  image: z.boolean(),
  at: z.string(),
});
export type RotoscopeLive = z.infer<typeof RotoscopeLiveSchema>;

export const RotoscopeCheckSchema = z.object({ name: z.string(), passed: z.boolean(), detail: z.string() });

export const RotoscopeAttemptSchema = z.object({
  attempt: z.number().int(),
  at: z.string(),
  passed: z.boolean(),
  checks: z.array(RotoscopeCheckSchema),
});
export type RotoscopeAttempt = z.infer<typeof RotoscopeAttemptSchema>;

export const RotoscopeFrameSchema = z.object({
  index: z.number().int().min(1),
  status: z.enum(["pending", "approved", "failed"]),
  attempts: z.array(RotoscopeAttemptSchema),
  approvedAttempt: z.number().int().nullable(),
  manual: z.boolean(),
  /** A pencil note waiting for this frame's next drawing. */
  correction: z.object({ comment: z.string(), attempt: z.number().int(), at: z.string() }).nullable().default(null),
  /** How Muse Spark read this video frame before drawing it (null until its first drawing). */
  reading: z.string().nullable().default(null),
});
export type RotoscopeFrame = z.infer<typeof RotoscopeFrameSchema>;

export const RotoscopeRunSummarySchema = z.object({
  id: RotoscopeIdSchema,
  name: z.string(),
  createdAt: z.string(),
  phase: RotoscopePhaseSchema,
  total: z.number().int(),
  approved: z.number().int(),
});
export type RotoscopeRunSummary = z.infer<typeof RotoscopeRunSummarySchema>;

export const RotoscopeRunSchema = RotoscopeRunSummarySchema.extend({
  fps: z.number(),
  start: z.number(),
  seconds: z.number().nullable(),
  /** The whole video's length, when known: how much is left after the run's last frame. */
  videoSeconds: z.number().nullable().default(null),
  maxAttempts: z.number().int(),
  error: z.string().nullable(),
  halted: z.object({ frame: z.number().int(), reason: z.string() }).nullable(),
  live: RotoscopeLiveSchema.nullable(),
  log: z.array(z.string()),
  frames: z.array(RotoscopeFrameSchema),
  /** Each attempt is drawn by Muse Image and Higgsfield; the closer match is kept. */
  dual: z.boolean().default(false),
  /** Higgsfield is configured on this server. */
  dualAvailable: z.boolean().default(false),
  /** What the run's latest rejected attempts taught; the most frequent go into every new drawing's prompt. */
  lessons: z.array(z.object({ rule: z.string(), count: z.number().int(), frames: z.array(z.number().int()), inPrompt: z.boolean() })).default([]),
  /** Changes when the pose guides are redrawn: their images are cached by URL. */
  guidesVersion: z.string().default(""),
  /** The reference video has a sound track: it can be heard in the preview and carried into Flipbook. */
  hasAudio: z.boolean().default(false),
  renderer: RendererSchema.default("auto"),
  /** The character's height and weight and the video person's height, as given. */
  measures: CharacterMeasuresSchema.default({ heightCm: null, weightKg: null, personHeightCm: null }),
  /** The drawings stand on the video person's own figure (hair top to soles); false for a run laid out before, until refitted. */
  fitsPerson: z.boolean().default(true),
  /** The character was drawn in other poses for this run (kind=posesheet). */
  poseSheet: z.boolean().default(false),
  /** The test batch this run was made in: several characters on one video, first frames only. */
  batch: z.string().nullable().default(null),
  /** How many first frames each round of its batch draws. */
  batchFrames: z.number().int().nullable().default(null),
});
export type RotoscopeRun = z.infer<typeof RotoscopeRunSchema>;

export const ApproveAttemptSchema = z.object({ frame: z.number().int().min(1), attempt: z.number().int().min(1) });

/** A run's name, as typed in the header, or its measures; at least one. */
export const UpdateRunSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), measures: CharacterMeasuresSchema.optional() })
  .refine((value) => value.name !== undefined || value.measures !== undefined);

/** The longest prompt a person may send from the debug panel. */
export const MAX_PROMPT_LENGTH = 8000;

/**
 * `frame` redraws that one frame (approved or not) instead of drawing what is still open. `prompt` draws it with
 * these exact words instead of the frame's own (Muse Image only), and `attempts` caps its tries (1: one test drawing).
 */
export const GenerateOptionsSchema = z.object({
  dual: z.boolean().optional(),
  frame: z.number().int().min(1).optional(),
  renderer: RendererSchema.optional(),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH).optional(),
  attempts: z.number().int().min(1).max(ROTOSCOPE_LIMITS.maxAttempts).optional(),
}).refine((value) => value.prompt === undefined || value.frame !== undefined, { message: "A prompt is tested on one frame." });

/** A frame's Muse Image prompt: the one an attempt was drawn with (`sent`), or the one its next drawing would get. */
export const FramePromptSchema = z.object({ prompt: z.string(), images: z.array(z.string()), sent: z.boolean() });
export type FramePrompt = z.infer<typeof FramePromptSchema>;

export const AnalyzePromptSchema = z.object({ frame: z.number().int().min(1), attempt: z.number().int().min(1).nullable(), prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH) });

/** Muse Spark's reading of a prompt under test: what is wrong, why, and the prompt rewritten. */
export const PromptAnalysisSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({ problem: z.string(), cause: z.string(), fix: z.string() })),
  prompt: z.string(),
});
export type PromptAnalysis = z.infer<typeof PromptAnalysisSchema>;

/** A test batch: one video, up to this many characters, each drawing only its first frames, once each per round. */
export const MAX_BATCH_CHARACTERS = 4;
export const BATCH_FRAME_CHOICES = [1, 2, 4] as const;
export const MAX_BATCH_FRAMES = 4;
export const BatchSchema = z.object({ id: z.string().uuid(), runs: z.array(RotoscopeRunSchema) });
export type RotoscopeBatch = z.infer<typeof BatchSchema>;

/** Adds the next `seconds` of the video after the run's last frame as open frames. */
export const EXTEND_STEPS = [1, 2, 5] as const;
export const ExtendOptionsSchema = z.object({ seconds: z.number().min(0.5).max(ROTOSCOPE_LIMITS.maxSeconds) });

/** Seconds of video after the run's last frame (0 when unknown or used up). */
export function videoLeft(run: Pick<RotoscopeRun, "start" | "fps" | "total" | "videoSeconds">): number {
  return run.videoSeconds === null ? 0 : Math.max(0, run.videoSeconds - (run.start + run.total / run.fps));
}

/** The text half of a pencil note; the marks travel as a PNG in the same form. */
export const CorrectionSchema = z.object({
  frame: z.coerce.number().int().min(1),
  attempt: z.coerce.number().int().min(1),
  comment: z.string().trim().min(1).max(ROTOSCOPE_LIMITS.maxCommentLength),
});

/** `sound` carries the reference video's audio (the run's first seconds) into the new Flipbook. */
export const OpenFlipbookOptionsSchema = z.object({ sound: z.boolean().optional() });

/** The new Flipbook a finished run opens as. */
export const RotoscopeFlipbookSchema = z.object({ flipbookId: z.uuid() });

/**
 * The comparison clip: the video and its drawings in one file, one beside the other (`side`) or one above the
 * other (`stack`). `first` is the left or top one; `background` is what the drawings sit on (a clip has no
 * transparency); `size` is the clip's longest side.
 */
export const COMPARE_LAYOUTS = ["side", "stack"] as const;
export const COMPARE_ORDERS = ["video", "drawing"] as const;
export const COMPARE_BACKGROUNDS = ["white", "dark"] as const;
export const COMPARE_FORMATS = ["mp4", "mov", "webm", "gif"] as const;
export const COMPARE_SIZES = { small: 640, medium: 1080, large: 1920 } as const;
export type CompareSize = keyof typeof COMPARE_SIZES;
export const CompareOptionsSchema = z.object({
  layout: z.enum(COMPARE_LAYOUTS).default("side"),
  first: z.enum(COMPARE_ORDERS).default("video"),
  background: z.enum(COMPARE_BACKGROUNDS).default("white"),
  format: z.enum(COMPARE_FORMATS).default("mp4"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  /** The reference video's sound (MP4, MOV and WebM only). */
  sound: z.boolean().default(false),
});
export type CompareOptions = z.infer<typeof CompareOptionsSchema>;

/** A rendered comparison clip: `file` is what `rotoscopeUrls.compare` serves. */
export const CompareResultSchema = z.object({
  file: z.string(),
  name: z.string(),
  format: z.enum(COMPARE_FORMATS),
  bytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  frames: z.number().int(),
  fps: z.number(),
  seconds: z.number(),
  sound: z.boolean(),
});
export type CompareResult = z.infer<typeof CompareResultSchema>;

/** overlay: an attempt's drawing ghosted over its video frame on the grid, as Muse Spark reviewed it; build: the character and the drawing at one scale; scan: the pose error map (joints, vectors, bad cells); exposed: an attempt's repaint regions; labels: the body regions of the drawing it was deformed from; mask: the character's silhouette; scaled: the character sheet as tall as the video person; work: one of an attempt's pipeline pictures (WORK_PICTURES). */
export type RotoscopeMedia = "source" | "guide" | "attempt" | "frame" | "character" | "scaled" | "posesheet" | "correction" | "audio" | "exposed" | "labels" | "mask" | "overlay" | "build" | "scan" | "drawn" | "work";

/** The pictures an attempt's pipeline keeps in work/, by name: what the generator got and what each step made. */
export const WORK_PICTURES = ["raw", "draft", "keyed", "mannequin", "continuity", "fidelity", "person"] as const;
export type WorkPicture = (typeof WORK_PICTURES)[number];

// ── Pipeline trace (server/rotoscope/trace.ts) ─────────────────────────────

/** Every step a drawing goes through, in order: what the Pipeline view draws as nodes. */
export const TRACE_STEPS = ["inputs", "diagnosis", "prompt", "generate", "measure", "fidelity", "review", "decision"] as const;
export type TraceStepId = (typeof TRACE_STEPS)[number];
export const TRACE_STEP_LABEL: Record<TraceStepId, string> = {
  inputs: "Inputs & guardrails",
  diagnosis: "Why it failed · Muse Spark",
  prompt: "Prompt",
  generate: "Drawing · Muse Image",
  measure: "Cut-out & measures",
  fidelity: "Fidelity · Python",
  review: "Review · Muse Spark",
  decision: "Decision",
};

export const TraceImageSchema = z.object({
  label: z.string(),
  kind: z.string(),
  frame: z.number().int().optional(),
  attempt: z.number().int().optional(),
  name: z.enum(WORK_PICTURES).optional(),
});
export type TraceImage = z.infer<typeof TraceImageSchema>;

export const TraceGuardrailSchema = z.object({ name: z.string(), passed: z.boolean(), detail: z.string(), blocking: z.boolean().optional() });
export type TraceGuardrail = z.infer<typeof TraceGuardrailSchema>;

export const TraceStepSchema = z.object({
  id: z.enum(TRACE_STEPS),
  status: z.enum(["running", "done", "warn", "failed", "skipped"]),
  startedAt: z.string(),
  ms: z.number().nullable().default(null),
  /** One line under the node's title. */
  summary: z.string(),
  /** The model or tool the step ran on ("muse-image-1.0", "DWPose", "OpenCV"). */
  model: z.string().nullable().default(null),
  /** Long text shown when the node is opened: the exact prompt, the review's notes. */
  detail: z.string().nullable().default(null),
  images: z.array(TraceImageSchema).default([]),
  guardrails: z.array(TraceGuardrailSchema).default([]),
  /** Named measures, 0–100 unless said otherwise. */
  metrics: z.record(z.string(), z.number().nullable()).default({}),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), status: z.string().optional(), detail: z.string() })).default([]),
  score: z.number().nullable().default(null),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const AttemptTraceSchema = z.object({
  frame: z.number().int(),
  attempt: z.number().int(),
  /** This frame's try in the run that drew it. */
  tries: z.number().int(),
  startedAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(TraceStepSchema),
  /** The fidelity bar the attempt was held to. */
  bar: z.number().nullable().default(null),
});
export type AttemptTrace = z.infer<typeof AttemptTraceSchema>;

export const FrameTraceSchema = z.object({
  frame: z.number().int(),
  attempts: z.array(AttemptTraceSchema),
  /** The environment's guardrails right now (Python tools, Meta API, Muse models). */
  preflight: z.array(TraceGuardrailSchema),
});
export type FrameTrace = z.infer<typeof FrameTraceSchema>;

/** The generators an attempt can be drawn by; with two, each one's cut-out is kept (kind=drawn). */
export const GENERATORS = ["muse", "higgsfield"] as const;
export type GeneratorName = (typeof GENERATORS)[number];
export const GENERATOR_LABEL: Record<GeneratorName, string> = { muse: "Muse Image", higgsfield: "Higgsfield" };

/** Which generator's drawing an attempt kept, read off its alpha check ("Muse Image kept over Higgsfield …"); null for one generator. */
export function keptGenerator(checks: readonly { readonly name: string; readonly detail: string }[]): { readonly kept: GeneratorName; readonly over: string } | null {
  const match = checks.find((check) => check.name === "alpha")?.detail.match(/(Muse Image|Higgsfield) kept over (?:Muse Image|Higgsfield) ([^;]+)/);
  return match ? { kept: match[1] === "Higgsfield" ? "higgsfield" : "muse", over: match[2].trim() } : null;
}

export const rotoscopeUrls = {
  media: (id: string, kind: RotoscopeMedia, frame?: number, attempt?: number) =>
    `/api/rotoscope/runs/${id}/media?kind=${kind}${frame ? `&frame=${frame}` : ""}${attempt ? `&attempt=${attempt}` : ""}`,
  /** The reference video's sound from the run's start, as AAC. */
  audio: (id: string) => `/api/rotoscope/runs/${id}/media?kind=audio`,
  zip: (id: string) => `/api/rotoscope/runs/${id}/export`,
  /** A rendered comparison clip (`CompareResult.file`); a `download` name turns it into an attachment with that name. */
  compare: (id: string, file: string, download?: string) => `/api/rotoscope/runs/${id}/compare?file=${file}${download ? `&download=${encodeURIComponent(download)}` : ""}`,
  /** A frame's Muse Image prompt (an attempt's, or the next drawing's); POST analyses an edited one. */
  prompt: (id: string, frame: number, attempt?: number | null) => `/api/rotoscope/runs/${id}/prompt?frame=${frame}${attempt ? `&attempt=${attempt}` : ""}`,
  batch: (id: string) => `/api/rotoscope/batches/${id}`,
  /** One generator's cut-out of an attempt drawn by two, before registration. */
  drawn: (id: string, frame: number, attempt: number, by: GeneratorName) => `/api/rotoscope/runs/${id}/media?kind=drawn&frame=${frame}&attempt=${attempt}&by=${by}`,
  /** An attempt's character-mapping diagnostics. */
  mapping: (id: string, frame: number, attempt: number) => `/api/rotoscope/runs/${id}/mapping?frame=${frame}&attempt=${attempt}`,
  /** Every attempt's pipeline trace for a frame, and the environment's guardrails. */
  trace: (id: string, frame: number) => `/api/rotoscope/runs/${id}/trace?frame=${frame}`,
  /** One of an attempt's pipeline pictures (or the frame's own, for `person`). */
  work: (id: string, frame: number, attempt: number | undefined, name: WorkPicture) => `/api/rotoscope/runs/${id}/media?kind=work&frame=${frame}${attempt ? `&attempt=${attempt}` : ""}&name=${name}`,
  /** A frame's pose guide, at the run's current guides. */
  guide: (run: { readonly id: string; readonly guidesVersion: string }, frame: number) => `/api/rotoscope/runs/${run.id}/media?kind=guide&frame=${frame}${run.guidesVersion ? `&v=${encodeURIComponent(run.guidesVersion)}` : ""}`,
};

/** Frames left to draw: the first open one, or null when every frame is approved. */
export function nextOpenFrame(run: Pick<RotoscopeRun, "frames">): number | null {
  return run.frames.find((frame) => frame.status !== "approved")?.index ?? null;
}

// ── Character mapping (server/mapping) ─────────────────────────────────────

export const MAPPING_JOINTS = [
  "pelvis", "neck", "head",
  "leftShoulder", "leftElbow", "leftWrist", "leftHand",
  "rightShoulder", "rightElbow", "rightWrist", "rightHand",
  "leftHip", "leftKnee", "leftAnkle", "leftToe",
  "rightHip", "rightKnee", "rightAnkle", "rightToe",
] as const;
export type MappingJoint = (typeof MAPPING_JOINTS)[number];

/** Pairs of joints drawn as the skeleton's bones. */
export const MAPPING_BONES: readonly (readonly [MappingJoint, MappingJoint])[] = [
  ["pelvis", "neck"], ["neck", "head"],
  ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"], ["leftWrist", "leftHand"],
  ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"], ["rightWrist", "rightHand"],
  ["leftShoulder", "rightShoulder"], ["leftHip", "rightHip"],
  ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"], ["leftAnkle", "leftToe"],
  ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"], ["rightAnkle", "rightToe"],
];

const JointMapSchema = z.record(z.string(), z.tuple([z.number(), z.number(), z.number()]));
const PolicyOutcomeSchema = z.object({
  id: z.string(), skill: z.string(), section: z.string(), kind: z.enum(["constraint", "advisory"]), stage: z.string(),
  passed: z.boolean(), detail: z.string(), value: z.number().optional(),
});

/** What the inspector reads of server/mapping/diagnostics.ts FrameDiagnostics. */
export const MappingDiagnosticsSchema = z.object({
  frame: z.number().int(),
  attempt: z.number().int(),
  method: z.enum(["rig-deform", "rig-deform+muse-repair", "muse-image", "higgsfield"]),
  base: z.object({ id: z.string(), index: z.number().int().nullable(), mode: z.string(), distance: z.number().nullable(), depth: z.number().int() }).nullable(),
  source: z.object({ joints: JointMapSchema, raw: JointMapSchema, swapped: z.boolean(), occluded: z.array(z.string()), bridged: z.array(z.string()), offSubject: z.array(z.string()) }),
  rig: z.object({ joints: JointMapSchema, bones: z.array(z.object({ name: z.string(), z: z.number() })) }).nullable(),
  masks: z.object({ character: z.string().nullable(), segmentation: z.string(), subjectTracked: z.boolean(), exposed: z.string().nullable(), labels: z.string().nullable() }),
  target: z.object({ joints: JointMapSchema, rotations: z.array(z.object({ bone: z.string(), absolute: z.number(), local: z.number().nullable(), shortening: z.number() })), unseen: z.array(z.string()) }),
  generated: z.object({ joints: JointMapSchema, estimator: z.string() }).nullable(),
  jointError: z.record(z.string(), z.number()),
  boneError: z.record(z.string(), z.number()),
  meanJointError: z.number().nullable(),
  silhouette: z.number().nullable(),
  missing: z.array(z.string()),
  occluded: z.array(z.string()),
  consistency: z.number().nullable(),
  exposedArea: z.number(),
  repair: z.object({ applied: z.boolean(), kept: z.boolean(), note: z.string() }).nullable(),
  policies: z.array(PolicyOutcomeSchema),
});
export type MappingDiagnostics = z.infer<typeof MappingDiagnosticsSchema>;

export const MappingViewSchema = z.object({
  diagnostics: MappingDiagnosticsSchema.nullable(),
  /** Target joints a person moved for this frame (canvas pixels). */
  overrides: z.record(z.string(), z.tuple([z.number(), z.number()])),
  /** The canvas every drawing is on. */
  canvas: z.object({ width: z.number(), height: z.number() }),
  /** Which review pictures this attempt has: what Muse Spark was shown, and the pose error map. */
  review: z.object({ overlay: z.boolean(), build: z.boolean(), scan: z.boolean() }).default({ overlay: false, build: false, scan: false }),
});
export type MappingView = z.infer<typeof MappingViewSchema>;

/** A person's correction of a frame's mapping: moved target joints (canvas pixels), or none to clear them. */
export const MappingCorrectionSchema = z.object({
  frame: z.number().int().min(1),
  joints: z.partialRecord(z.enum(MAPPING_JOINTS), z.tuple([z.number().min(-512).max(4096), z.number().min(-512).max(4096)])),
});
