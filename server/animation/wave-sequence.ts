import { FlipbookPlanSchema, type FlipbookPlan } from "../../shared/flipbook";
import { sequenceTicks, type SequenceSettings } from "../../shared/sequence";
import type { CameraView } from "../../shared/animation-view";

const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** One greeting across the entire clip: raise, two small waves, lower. */
export function waveMotionAt(seconds: number, duration: number) {
  const progress = Math.max(0, Math.min(1, seconds / duration));
  const lift = progress < 0.25 ? ease(progress / 0.25) : progress > 0.75 ? 1 - ease((progress - 0.75) / 0.25) : 1;
  const wrist = progress >= 0.25 && progress <= 0.75 ? 12 * Math.sin((progress - 0.25) * 8 * Math.PI) : 0;
  return { lift, wristDegrees: Math.round(wrist * 100) / 100, stage: progress < 0.25 ? "Raise the hand" : progress <= 0.75 ? "Wave gently" : "Lower the hand" };
}

export function planWaveSequence(settings: SequenceSettings, view: CameraView, prompt: string): FlipbookPlan {
  // Prefer the first requested hand; a later "left arm stays still" must not
  // override an earlier "raise the right hand" instruction.
  const side = prompt.match(/\b(left|right)\s+(?:hand|arm)\b|\b(?:mano|brazo)\s+(izquierd\w*|derech\w*)/i);
  const left = Boolean(side && /^(?:left|izquierd)/i.test(side[1] ?? side[2]));
  const hand = left ? "left" : "right", other = left ? "right" : "left";
  const screenSide = view === "front" || view === "three_quarter" ? (left ? "right" : "left") : view === "back" ? hand : null;
  const sideLock = screenSide ? `The waving arm stays on the viewer's ${screenSide} side of the image throughout. Never swap arms or mirror the gesture.` : "Use the same waving arm throughout; never swap arms or mirror the gesture.";
  return FlipbookPlanSchema.parse({
    mode: "sequence", action: "wave", direction: "right", view, motion: "in_place", ...settings, loop: false,
    motionOutline: `ONE calm greeting across ${settings.durationSeconds} seconds: first quarter raise the ${hand} hand, middle half make two small wrist waves, final quarter lower it. Feet, hips, torso, camera and the other arm stay still.`,
    poses: sequenceTicks(settings).map((tick, index) => {
      const motion = waveMotionAt(tick / 24, settings.durationSeconds);
      const shoulder = (65 * motion.lift).toFixed(1), elbow = (110 * motion.lift).toFixed(1);
      const placement = motion.lift < 0.05 ? "The waving hand is down beside the thigh, with the arm relaxed." : motion.lift > 0.95 ? "The open waving hand is beside the cheek, below the crown, palm toward the viewer." : `The hand travels smoothly between the thigh and the cheek, ${Math.round(motion.lift * 100)}% of the way up.`;
      return { index, phase: `sample_${tick}`, label: motion.stage,
        description: `A single calm greeting, ${tick / 24} seconds into the ${settings.durationSeconds}-second clip. ${motion.stage}. The character's ${hand} arm is ${Math.round(motion.lift * 100)}% raised: shoulder angle ${shoulder} degrees from hanging down, elbow bent ${elbow} degrees. ${sideLock} ${placement} Wrist tilt ${motion.wristDegrees} degrees from vertical; only this small wrist motion waves. The ${other} arm stays relaxed at the side. Keep exactly the same planted feet, hips, upright torso, head position, face expression, size and camera. No stepping, bouncing, dancing, shoulder shaking or new gesture.`,
        relativeRootY: 0, lift: 0 };
    }),
  });
}

/** Pose landmarks include each reversal, so intermediates cannot shortcut a wave. */
export function waveAnchorIndexes(plan: FlipbookPlan): number[] {
  const count = plan.poses.length;
  return [...new Set([0, 0.125, 0.25, 0.3125, 0.4375, 0.5625, 0.6875, 0.75, 0.875, 1].map((fraction) => Math.min(count - 1, Math.round(fraction * count))))].sort((a, b) => a - b);
}
