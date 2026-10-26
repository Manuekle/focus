import type { EffectId } from "./schemas";

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
    summary: "Keep your subject in color. Let everything else fade or blur.",
    examples: ["Keep the skater in color", "Blur everything but the dog"],
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
];
