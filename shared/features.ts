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
