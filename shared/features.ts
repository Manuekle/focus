import type { EffectId } from "./schemas";

// Release switches. Public by design: a boolean, never a secret. Next inlines
// NEXT_PUBLIC_* at build time in both browser and server bundles. Changing
// this flag in production requires a rebuild, including for Docker images.

/** Time Freeze + Echo. Off unless explicitly "true". */
export function temporalEffectsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS === "true";
}

/** Whether an editor effect may be offered and requested. */
export function effectEnabled(effect: EffectId): boolean {
  return effect !== "time-freeze" || temporalEffectsEnabled();
}

/**
 * Focus Flipbook: frame-by-frame character animation from one illustration.
 * Off unless explicitly "true"; like the temporal flag it is compiled in.
 */
export function flipbookEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK === "true";
}

/**
 * Reference Motion: a character image follows a driving video, rendered by an
 * external GPU worker. Off unless explicitly "true"; compiled in like the others.
 */
export function referenceMotionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_REFERENCE_MOTION === "true";
}

/**
 * Pose to pose: a described sequence is planned as keys, breakdowns and a
 * timing chart, and its in-betweens are drawn by halves. Off unless "true";
 * compiled in like the others.
 */
export function poseToPoseEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_POSE_TO_POSE === "true";
}

/**
 * Rotoscope: a video redrawn frame by frame with the user's character,
 * validated frame by frame. Off unless "true"; compiled in like the others.
 */
export function rotoscopeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_ROTOSCOPE === "true";
}
