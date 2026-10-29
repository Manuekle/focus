import type { FlipbookPlan } from "../../shared/flipbook";
import { waveAnchorIndexes } from "./wave-sequence";

/** Shared by planning and drawing, including repairs and in-betweens. */
export const MOTION_CONTINUITY_RULES = [
  "Plan anticipation, action, follow-through and settling as one continuous performance. Preserve the same anatomical left/right limbs throughout; an occluded limb stays occluded until its planned path reveals it.",
  "Specify which body parts move and which stay still. Preserve bone lengths, joint connections, body volume and head-to-body proportions. Hands retain their established anatomy; never add fingers, limbs or faces to fill an uncertain view.",
  "Track the supporting foot or other contact point. A planted contact stays fixed on the ground until its explicit lift-off; transfer weight before a step and keep balance over the support. No foot sliding, teleporting or unexplained changes of heading.",
  "Use joint arcs, gradual acceleration and deceleration, clear direction reversals and small overlapping follow-through in hair or loose cloth. Spacing follows the speed of the action, not a new random pose at every timestamp. Keep stationary contours stable; do not add whole-body wobble or line jitter to fake movement.",
  "At each timestamp describe support/contact, pelvis and torso orientation, head direction, each moving limb and its progression toward the next pose. Use the established camera and perspective. If evidence is unclear, keep the established pose and occlusion rather than inventing unseen anatomy or a new action.",
  "One drawing may be held for at most 125 ms (three 24-fps ticks). Advance the intended movement before that limit; a subtle blink or breathing change is valid only when requested. Never duplicate a pose for longer to fill time, and never add random noise or color changes to disguise a duplicate.",
].join("\n");

export function drawingContinuityPrompt(plan: FlipbookPlan, index: number): string {
  const previous = plan.poses[index - 1];
  const current = plan.poses[index];
  const next = plan.poses[index + 1];
  return [
    "Animation continuity contract:",
    MOTION_CONTINUITY_RULES,
    "Keep each character's identity, outfit, palette, markings, line weight and shading fixed to its own immutable character reference. Generated neighbors establish motion, never new design details. A clean intermediate drawing is required, without crossfades, ghosting or blended anatomy.",
    "During repair, retain the parts of the current pose that match the plan. If an overlong hold was flagged, the duplicated pose is itself the error: advance to this timestamp's planned pose along the established path instead of preserving that duplicate or inventing a different gesture.",
    plan.motionOutline ? `Full action: ${plan.motionOutline}` : "",
    previous ? `Previous planned pose (${previous.phase}): ${previous.description}` : "This is the first pose: establish the camera, proportions and support for the entire action.",
    `Draw this planned pose (${current.phase}): ${current.description}`,
    next ? `Next planned pose (${next.phase}): ${next.description}` : plan.loop ? "Finish with continuous motion into the first pose." : "This is the finite clip's final pose; do not restart the action.",
    "Before returning the drawing, check silhouette, left/right limb identity, joints, hands, support contacts, camera and the unchanged character design against the supplied references. Correct visible inconsistencies rather than passing them to the next drawing.",
  ].filter(Boolean).join("\n");
}

/** Sparse keys bracket every sequence drawing; no additional drawings are charged. */
export function sequenceAnchorIndexes(plan: FlipbookPlan, hasMotionReference = false): number[] {
  if (plan.mode !== "sequence") return [];
  if (plan.action === "wave" && !hasMotionReference) return waveAnchorIndexes(plan);
  const step = Math.max(1, Math.round(plan.drawingFps / 4));
  return [...new Set([...plan.poses.flatMap((_, index) => index % step === 0 ? [index] : []), plan.poses.length - 1])];
}
