import type { EffectId } from "./schemas";
import { effectEnabled } from "./features";

/** Upload → Describe → Identify → Track → Transform → Preview → Export */
export const FLOW_STEPS = [
  { id: "upload", label: "Upload" },
  { id: "describe", label: "Describe" },
  { id: "identify", label: "Identify" },
  { id: "track", label: "Track" },
  { id: "transform", label: "Transform" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
] as const;
export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export const EFFECTS: readonly {
  readonly id: EffectId;
  readonly name: string;
  readonly summary: string;
  /** Short, real instructions this effect handles well. */
  readonly examples: readonly string[];
}[] = [
  {
    id: "reality-shift",
    name: "Reality Shift",
    summary: "Keep your subject in color, in focus or in the spotlight.",
    examples: ["Keep the skater in color", "Blur everything but the dog", "Put the singer in a spotlight"],
  },
  {
    id: "break-the-frame",
    name: "Break the Frame",
    summary: "Give your clip a frame. Let your subject step beyond it.",
    examples: ["Let the dancer step out of the frame", "Make the runner break the frame"],
  },
  {
    id: "motion-echo",
    name: "Motion Echo",
    summary: "Turn movement into a trail of echoes. Best with a still camera.",
    examples: ["Add motion trails to the cyclist", "Give the dancer a cinematic echo"],
  },
  {
    id: "time-freeze",
    name: "Time Freeze",
    summary: "Freeze a moment. Multiply the motion.",
    examples: ["Freeze the skater at the top of the jump with five echoes", "Freeze a moment and create four echoes of the dancer"],
  },
];

/** Keep unfinished effects out of the composer unless their release switch is on. */
export function availableEffects() {
  return EFFECTS.filter((effect) => effectEnabled(effect.id));
}
