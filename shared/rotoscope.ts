import { z } from "zod";

// Rotoscope: a video is cut into frames at a fixed rate and every frame is
// redrawn with the user's character, in order, behind a firewall that stops
// on the first frame that fails its checks (server/rotoscope/run-state.ts).

export const RotoscopeIdSchema = z.string().uuid();

export const ROTOSCOPE_LIMITS = {
  minFps: 1,
  maxFps: 24,
  defaultFps: 9,
  /** Longest stretch one run may cover, and most frames it may hold. */
  maxSeconds: 60,
  maxFrames: 600,
  maxAttempts: 3,
  /** A pencil note: the comment's length and the marks image's size. */
  maxCommentLength: 600,
  maxMarkBytes: 8 * 1024 * 1024,
} as const;

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
});
export type RotoscopeRun = z.infer<typeof RotoscopeRunSchema>;

export const ApproveAttemptSchema = z.object({ frame: z.number().int().min(1), attempt: z.number().int().min(1) });

/** `frame` redraws that one frame (approved or not) instead of drawing what is still open. */
/** A run's name, as typed in the header. */
export const RenameRunSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const GenerateOptionsSchema = z.object({ dual: z.boolean().optional(), frame: z.number().int().min(1).optional() });

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

export type RotoscopeMedia = "source" | "guide" | "attempt" | "frame" | "character" | "correction" | "audio";

export const rotoscopeUrls = {
  media: (id: string, kind: RotoscopeMedia, frame?: number, attempt?: number) =>
    `/api/rotoscope/runs/${id}/media?kind=${kind}${frame ? `&frame=${frame}` : ""}${attempt ? `&attempt=${attempt}` : ""}`,
  /** The reference video's sound from the run's start, as AAC. */
  audio: (id: string) => `/api/rotoscope/runs/${id}/media?kind=audio`,
  zip: (id: string) => `/api/rotoscope/runs/${id}/export`,
  /** A frame's pose guide, at the run's current guides. */
  guide: (run: { readonly id: string; readonly guidesVersion: string }, frame: number) => `/api/rotoscope/runs/${run.id}/media?kind=guide&frame=${frame}${run.guidesVersion ? `&v=${encodeURIComponent(run.guidesVersion)}` : ""}`,
};

/** Frames left to draw: the first open one, or null when every frame is approved. */
export function nextOpenFrame(run: Pick<RotoscopeRun, "frames">): number | null {
  return run.frames.find((frame) => frame.status !== "approved")?.index ?? null;
}
