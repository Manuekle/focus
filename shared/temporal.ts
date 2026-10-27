import { z } from "zod";

// Time Freeze + Echo: the one temporal operation. The footage holds on a
// trigger frame while real-mask cutouts of the subject from nearby frames
// appear over it, then playback resumes. Everything here is bounded data; no
// model output or client value ever becomes an FFmpeg argument directly.

export const TEMPORAL_BOUNDS = {
  freezeDurationMs: [500, 3000],
  echoCount: [2, 6],
  echoSpacingMs: [80, 400],
  echoOpacity: [0, 1],
} as const;

export const TriggerEventSchema = z.enum(["jump_apex", "peak_motion"]);
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

/**
 * Where the freeze happens. `mode` records who placed the timestamp:
 * manual = the user, auto = the motion detector's suggestion. A language
 * model only ever names the event; it never supplies the timestamp.
 */
export const TriggerSchema = z
  .object({
    mode: z.enum(["manual", "auto"]),
    timestampMs: z.number().int().nonnegative().optional(),
    event: TriggerEventSchema.optional(),
  })
  .refine((trigger) => trigger.mode === "manual" || trigger.event !== undefined, "An automatic trigger names its event");
export type Trigger = z.infer<typeof TriggerSchema>;

export const FreezeDurationSchema = z.number().int().min(TEMPORAL_BOUNDS.freezeDurationMs[0]).max(TEMPORAL_BOUNDS.freezeDurationMs[1]);

export const EchoSchema = z.object({
  count: z.number().int().min(TEMPORAL_BOUNDS.echoCount[0]).max(TEMPORAL_BOUNDS.echoCount[1]).default(4),
  spacingMs: z.number().int().min(TEMPORAL_BOUNDS.echoSpacingMs[0]).max(TEMPORAL_BOUNDS.echoSpacingMs[1]).default(160),
  /** Opacity of the newest echo; older echoes fade from it. */
  opacity: z.number().min(TEMPORAL_BOUNDS.echoOpacity[0]).max(TEMPORAL_BOUNDS.echoOpacity[1]).default(0.85),
});
export type Echo = z.infer<typeof EchoSchema>;

type Timing = { readonly fps: number; readonly frameCount: number; readonly durationSeconds: number };

/** Time of the last decodable frame, in whole milliseconds. */
export function lastFrameMs(media: Timing): number {
  return Math.min(Math.floor(((media.frameCount - 1) * 1000) / media.fps), Math.floor(media.durationSeconds * 1000));
}

/** The normalized-video frame a timestamp lands on. */
export function triggerFrame(timestampMs: number, media: Pick<Timing, "fps" | "frameCount">): number {
  return Math.min(media.frameCount - 1, Math.max(0, Math.round((timestampMs * media.fps) / 1000)));
}

/** Inserted frames for a freeze duration, at least one. */
export function freezeFrameCount(freezeDurationMs: number, fps: number): number {
  return Math.max(1, Math.round((freezeDurationMs * fps) / 1000));
}

/**
 * Why a trigger cannot be rendered on this clip, or null. An automatic
 * trigger may still lack its timestamp: detection fills it before rendering.
 */
export function triggerProblem(trigger: Trigger, media: Timing): string | null {
  if (trigger.timestampMs === undefined) return trigger.mode === "manual" ? "Choose the freeze point on the timeline." : null;
  if (trigger.timestampMs > lastFrameMs(media)) return "The freeze point is past the end of the clip.";
  return null;
}

/** The output timeline of one freeze, in normalized-video frames. */
export type FreezePlan = {
  readonly triggerFrame: number;
  readonly freezeFrames: number;
  readonly spacingFrames: number;
  /** Echo moments before the trigger, oldest first. Mask checks may drop some. */
  readonly requestedSamples: readonly number[];
  /** Output index of the first inserted (frozen) frame: right after the trigger frame plays. */
  readonly freezeStart: number;
  readonly outputFrameCount: number;
};

type FreezeInput = {
  readonly trigger: { readonly timestampMs?: number };
  readonly freezeDurationMs: number;
  readonly echo: Pick<Echo, "count" | "spacingMs">;
  readonly resume: boolean;
};

/**
 * Output = source frames 0…T, then F copies of frame T with echoes, then (when
 * resuming) source frames T+1…N−1. Echoes come from T − k·spacing, k = count…1.
 */
export function planFreeze(params: FreezeInput, media: Pick<Timing, "fps" | "frameCount">): FreezePlan {
  if (params.trigger.timestampMs === undefined) throw new Error("planFreeze needs a timestamp");
  const triggerIndex = triggerFrame(params.trigger.timestampMs, media);
  const freezeFrames = freezeFrameCount(params.freezeDurationMs, media.fps);
  const spacingFrames = Math.max(1, Math.round((params.echo.spacingMs * media.fps) / 1000));
  const requestedSamples: number[] = [];
  for (let k = params.echo.count; k >= 1; k--) {
    const frame = triggerIndex - k * spacingFrames;
    if (frame >= 0) requestedSamples.push(frame);
  }
  const freezeStart = triggerIndex + 1;
  return {
    triggerFrame: triggerIndex,
    freezeFrames,
    spacingFrames,
    requestedSamples,
    freezeStart,
    outputFrameCount: freezeStart + freezeFrames + (params.resume ? media.frameCount - freezeStart : 0),
  };
}

/** The source frame an output frame shows, or "freeze" for an inserted frame. */
export function sourceFrameOf(outputIndex: number, plan: FreezePlan): number | "freeze" {
  if (outputIndex < plan.freezeStart) return outputIndex;
  if (outputIndex < plan.freezeStart + plan.freezeFrames) return "freeze";
  return outputIndex - plan.freezeFrames;
}

/** Share of the freeze spent revealing echoes; the rest holds the full composition. */
export const REVEAL_SHARE = 0.6;

/**
 * How far echo `rank` (0 = oldest of `count`) has faded in on freeze frame `f`
 * (0-based within the freeze): 0 before its turn, rising to 1 over a short fade.
 * Echoes appear one after another, oldest first.
 */
export function echoReveal(f: number, rank: number, count: number, freezeFrames: number, fps: number): number {
  const span = Math.max(count, Math.round(freezeFrames * REVEAL_SHARE));
  const start = Math.floor((rank * span) / count);
  const fade = Math.max(1, Math.min(Math.round(fps * 0.15), Math.floor(span / count)));
  return Math.min(1, Math.max(0, (f - start + 1) / fade));
}

/** Final opacity of echo `rank`: the oldest at half of `opacity`, the newest at full. */
export function echoOpacity(rank: number, count: number, opacity: number): number {
  return opacity * (count <= 1 ? 1 : 0.5 + (0.5 * rank) / (count - 1));
}
