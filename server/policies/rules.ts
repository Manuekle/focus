import type { Pose } from "../rotoscope/pose-match";
import type { BonePlan, DeformResult } from "../mapping/deform";
import { angleDiff, angleOf, dist } from "../mapping/geometry";
import { boneVector, LIMB_BONES, torsoLength, type JointName, type Skeleton } from "../mapping/skeleton";

// The animation-principles skills as executable rules. Each rule cites the
// SKILL.md section it implements (checked against the file at load) and is
// one of two kinds:
//   constraint — deterministic geometry; a failure rejects the frame (or, at
//                planning, changes what the engine does).
//   advisory   — a measurement reported as a warning, or one short line of
//                guidance for a generator's prompt; never rejects a frame.
// The skills are written mostly for UI motion; only what applies to
// rotoscoping a character onto a source video is used, and nothing here may
// retime the source: its movement and timing are the reference.

export type PolicyStage = "pose-planning" | "frame-preparation" | "rendering" | "validation";
export type PolicyKind = "constraint" | "advisory";

export type PolicyOutcome = {
  readonly id: string;
  readonly skill: string;
  readonly section: string;
  readonly kind: PolicyKind;
  readonly stage: PolicyStage;
  readonly passed: boolean;
  readonly detail: string;
  /** One line for a generator's prompt (advisory rules only). */
  readonly hint?: string;
  readonly value?: number;
};

/** A drawing the engine can deform from. */
export type BaseCandidate = {
  readonly id: string;
  /** Run frame index; null for the character sheet. */
  readonly index: number | null;
  readonly skeleton: Skeleton;
  /** How many deformations deep it is: 0 for a drawing made by a generator or a person. */
  readonly depth: number;
};

export type PlanningContext = {
  readonly stage: "pose-planning";
  readonly index: number;
  readonly target: Skeleton;
  readonly candidates: readonly BaseCandidate[];
  /** Frame times the run will output and the source's, seconds. */
  readonly times?: { readonly expected: readonly number[]; readonly actual: readonly number[] };
  /** The raw and stabilized source tracks (same frames), for the smoothing check. */
  readonly track?: { readonly raw: readonly Pose[]; readonly stabilized: readonly Pose[]; readonly fps: number };
};

export type PreparationContext = { readonly stage: "frame-preparation"; readonly plan: BonePlan };
export type RenderingContext = { readonly stage: "rendering"; readonly result: DeformResult; readonly baseArea: number };
export type ValidationContext = {
  readonly stage: "validation";
  readonly index: number;
  readonly target: Skeleton;
  /** The pose measured on the finished drawing; null when none was found. */
  readonly generated: Skeleton | null;
  /** The previous frame's target and measured drawing, when it is approved. */
  readonly previous: { readonly target: Skeleton; readonly generated: Skeleton | null } | null;
};

export type PolicyContext = PlanningContext | PreparationContext | RenderingContext | ValidationContext;

export type PlanDecision = { readonly base: BaseCandidate | null; readonly mode: "straight-ahead" | "pose-to-pose" | "none"; readonly distance: number | null };

export type Policy<C extends PolicyContext = PolicyContext> = {
  readonly id: string;
  readonly skill: string;
  /** The SKILL.md heading this rule implements. */
  readonly section: string;
  readonly kind: PolicyKind;
  readonly stage: C["stage"];
  readonly summary: string;
  /** One line for a generator's prompt at this stage (advisory rules only). */
  readonly hint?: string;
  readonly evaluate: (context: C) => (Omit<PolicyOutcome, "id" | "skill" | "section" | "kind" | "stage"> & { readonly decision?: PlanDecision }) | null;
};

const EXTREMITIES: readonly JointName[] = ["head", "leftWrist", "rightWrist", "leftAnkle", "rightAnkle"];

/** Mean limb-direction difference between two skeletons, degrees; null when fewer than four limbs compare. */
export function poseDistance(a: Skeleton, b: Skeleton): number | null {
  const diffs = LIMB_BONES.flatMap((bone) => {
    const [u, v] = [boneVector(a, bone), boneVector(b, bone)];
    return u && v ? [angleDiff(angleOf(u), angleOf(v))] : [];
  });
  return diffs.length >= 4 ? diffs.reduce((sum, d) => sum + d, 0) / diffs.length : null;
}

/** Straight ahead from the previous drawing while the pose stays close; re-key from a drawn pose when it doesn't or the chain gets long. */
export const STRAIGHT_AHEAD = { maxDistance: 30, maxChain: 4 } as const;

const baseSelection: Policy<PlanningContext> = {
  id: "straight-ahead-pose/base-selection",
  skill: "straight-ahead-pose-mastery",
  section: "The Hybrid Approach",
  kind: "constraint",
  stage: "pose-planning",
  summary: "Deform straight ahead from the previous drawing while its pose is close and the chain is short; otherwise go pose to pose from the closest drawn key, so deformation drift can't accumulate.",
  evaluate: ({ index, target, candidates }) => {
    const scored = candidates.map((candidate) => ({ candidate, distance: poseDistance(candidate.skeleton, target) }))
      .filter((entry): entry is { candidate: BaseCandidate; distance: number } => entry.distance !== null);
    const previous = scored.find((entry) => entry.candidate.index === index - 1);
    if (previous && previous.distance <= STRAIGHT_AHEAD.maxDistance && previous.candidate.depth < STRAIGHT_AHEAD.maxChain) {
      return { passed: true, detail: `straight ahead from ${previous.candidate.id} (${previous.distance.toFixed(1)}°, chain ${previous.candidate.depth + 1})`, value: previous.distance, decision: { base: previous.candidate, mode: "straight-ahead", distance: previous.distance } };
    }
    const keys = scored.filter((entry) => entry.candidate.depth === 0);
    const pool = keys.length ? keys : scored;
    const best = pool.sort((a, b) => a.distance - b.distance || Math.abs((a.candidate.index ?? 0) - index) - Math.abs((b.candidate.index ?? 0) - index))[0];
    if (!best) return { passed: false, detail: "no drawing to deform from (no approved frame or character sheet with a full pose)", decision: { base: null, mode: "none", distance: null } };
    const why = !previous ? "no previous drawing" : previous.distance > STRAIGHT_AHEAD.maxDistance ? `previous is ${previous.distance.toFixed(0)}° away` : `chain of ${previous.candidate.depth} deformations`;
    return { passed: true, detail: `pose to pose from ${best.candidate.id} (${best.distance.toFixed(1)}°; ${why})`, value: best.distance, decision: { base: best.candidate, mode: "pose-to-pose", distance: best.distance } };
  },
};

const frameTimes: Policy<PlanningContext> = {
  id: "timing/source-timing",
  skill: "timing-principle-mastery",
  section: "The Weight of Time",
  kind: "constraint",
  stage: "pose-planning",
  summary: "Timing is the source's: one output frame per source frame, at the source's times. Nothing is added, dropped or eased.",
  evaluate: ({ times }) => {
    if (!times) return null;
    const off = times.expected.findIndex((t, i) => Math.abs(t - (times.actual[i] ?? Infinity)) > 1e-3);
    const same = times.expected.length === times.actual.length && off < 0;
    return { passed: same, detail: same ? `${times.expected.length} frames at the source's times` : `frame ${off + 1} is at ${times.actual[off]?.toFixed(3)} s, the source at ${times.expected[off]?.toFixed(3)} s` };
  },
};

/** How much the stabilizer may trail a fast-moving extremity, as a share of that frame's travel. */
export const MAX_SMOOTHING_LAG = 0.35;

const smoothingLag: Policy<PlanningContext> = {
  id: "follow-through/keep-overlap",
  skill: "follow-through-overlapping",
  section: "The Drag Hierarchy",
  kind: "constraint",
  stage: "pose-planning",
  summary: "Extremities (hands, feet, head) carry the most drag and overlap; stabilizing the source must not delay or flatten them.",
  evaluate: ({ track }) => {
    if (!track) return null;
    let [lag, travel] = [0, 0];
    for (let t = 1; t < track.raw.length; t++) {
      for (const index of [0, 9, 10, 15, 16]) {
        const [a, b, s] = [track.raw[t - 1].keypoints[index], track.raw[t].keypoints[index], track.stabilized[t].keypoints[index]];
        if (a[0] === null || a[1] === null || b[0] === null || b[1] === null || s[0] === null || s[1] === null) continue;
        const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
        lag += Math.hypot(s[0] - b[0], s[1] - b[1]);
        travel += step;
      }
    }
    if (travel <= 0) return { passed: true, detail: "no extremity moves" };
    const share = lag / travel;
    return { passed: share <= MAX_SMOOTHING_LAG, detail: `stabilized extremities trail the source by ${(share * 100).toFixed(0)} % of their travel`, value: Math.round(share * 1000) / 1000 };
  },
};

const volume: Policy<PreparationContext> = {
  id: "solid-drawing/limb-volume",
  skill: "solid-drawing-mastery",
  section: "Core Theory",
  kind: "constraint",
  stage: "frame-preparation",
  summary: "Construction consistency: limbs stretch only within limits along their own axis and keep their width; head, hands and feet keep their drawn shape.",
  evaluate: ({ plan }) => ({
    passed: plan.clamped.length === 0,
    detail: plan.clamped.length ? `would need to stretch past the limits: ${plan.clamped.join(", ")}` : `every limb within its length limits (size ×${plan.scale.toFixed(2)})`,
  }),
};

/** Folded triangles and badly stretched area allowed in one deformed drawing. */
export const STRUCTURE = { distortedShare: 0.03, areaChange: [0.8, 1.25] as const };

const structure: Policy<RenderingContext> = {
  id: "solid-drawing/structure",
  skill: "solid-drawing-mastery",
  section: "The Three-Dimensional Challenge",
  kind: "constraint",
  stage: "rendering",
  summary: "Structural integrity and volume consistency: no folded mesh, little over-stretched area, and the figure's area changes only with its size.",
  evaluate: ({ result, baseArea }) => {
    const { flipped, collapsed = 0, foldedBy = {}, distortedArea, coverageArea } = result.stats;
    const share = coverageArea ? distortedArea / coverageArea : 1;
    const change = baseArea ? (coverageArea + result.stats.exposedArea) / (baseArea * result.plan.scale ** 2) : 1;
    const passed = flipped === 0 && collapsed === 0 && share <= STRUCTURE.distortedShare && change >= STRUCTURE.areaChange[0] && change <= STRUCTURE.areaChange[1];
    const where = Object.entries(foldedBy).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([bone, count]) => `${bone} ${count}`).join(", ");
    const torso = result.plan.torsoFit === "similarity" ? "; torso placed on its centre line only (its corners couldn't be fitted)" : "";
    return { passed, detail: `${flipped} folded${collapsed ? ` and ${collapsed} collapsed` : ""} triangles${where ? ` (${where})` : ""}, ${(share * 100).toFixed(1)} % over-stretched, area ×${change.toFixed(2)}${torso}`, value: Math.round(share * 1000) / 1000 };
  },
};

const solidHint: Policy<RenderingContext> = {
  id: "solid-drawing/repair-hint",
  skill: "solid-drawing-mastery",
  section: "Elements of Solidity",
  kind: "advisory",
  stage: "rendering",
  summary: "Repairs continue the existing forms in volume and light.",
  hint: "Continue the existing forms: same volumes, line weight and light direction; never change the size of the head, hands or limbs.",
  evaluate: () => null,
};

const followHint: Policy<RenderingContext> = {
  id: "follow-through/repair-hint",
  skill: "follow-through-overlapping",
  section: "Core Theory: Two Related Concepts",
  kind: "advisory",
  stage: "rendering",
  summary: "Repaired hair or cloth may trail the motion; limbs don't move.",
  hint: "Hair and loose clothing in a repaired area may trail the movement a little; no limb, hand or head may move.",
  evaluate: () => null,
};

/** Below this travel (torso lengths) a joint is holding still. */
export const HOLD = { still: 0.03, drift: 0.07 } as const;

const holds: Policy<ValidationContext> = {
  id: "timing/hold",
  skill: "timing-principle-mastery",
  section: "The Hold",
  kind: "constraint",
  stage: "validation",
  summary: "Where the source holds still, the drawing holds still: no boiling or drift on a held pose.",
  evaluate: ({ target, generated, previous }) => {
    if (!previous?.generated || !generated) return null;
    const unit = torsoLength(target) ?? 1;
    const held = EXTREMITIES.filter((name) => target[name] && previous.target[name] && dist(target[name]!.p, previous.target[name]!.p) / unit < HOLD.still);
    if (held.length < 2) return null;
    // Moving onto the target is a correction (the previous drawing was off), not drift: only a joint that
    // moves and lands away from where the source has it is boiling.
    const drifting = held.filter((name) => generated[name] && previous.generated![name]
      && dist(generated[name]!.p, previous.generated![name]!.p) / unit > HOLD.drift
      && dist(generated[name]!.p, target[name]!.p) / unit > HOLD.drift);
    return { passed: drifting.length === 0, detail: drifting.length ? `held in the source but moving in the drawing: ${drifting.join(", ")}` : `${held.length} held joints stay still` };
  },
};

const arcs: Policy<ValidationContext> = {
  id: "arc/path",
  skill: "arc-mastery",
  section: "The Pivot Chain",
  kind: "advisory",
  stage: "validation",
  summary: "Hands, feet and head follow the source's arcs: each lands near where the source path puts it, relative to how far it travelled.",
  evaluate: ({ target, generated, previous }) => {
    if (!previous || !generated) return null;
    const unit = torsoLength(target) ?? 1;
    const off: string[] = [];
    let worst = 0;
    for (const name of EXTREMITIES) {
      const [t, p, g] = [target[name], previous.target[name], generated[name]];
      if (!t || !p || !g) continue;
      const travel = dist(t.p, p.p) / unit;
      if (travel < 0.1) continue;
      const miss = dist(g.p, t.p) / unit / travel;
      worst = Math.max(worst, miss);
      if (miss > 0.5) off.push(`${name} ${(miss * 100).toFixed(0)} % of its travel off the path`);
    }
    return { passed: off.length === 0, detail: off.length ? off.join("; ") : "moving extremities on the source's path", value: Math.round(worst * 100) / 100 };
  },
};

const spacing: Policy<ValidationContext> = {
  id: "slow-in-out/spacing",
  skill: "slow-in-out-mastery",
  section: "The Spacing Principle",
  kind: "advisory",
  stage: "validation",
  summary: "Spacing follows the source: each extremity travels about as far between drawings as in the source, so eases in and out survive.",
  evaluate: ({ target, generated, previous }) => {
    if (!previous?.generated || !generated) return null;
    const unit = torsoLength(target) ?? 1;
    const off: string[] = [];
    for (const name of EXTREMITIES) {
      const [t, p, g, q] = [target[name], previous.target[name], generated[name], previous.generated[name]];
      if (!t || !p || !g || !q) continue;
      const want = dist(t.p, p.p) / unit;
      if (want < 0.05) continue;
      const ratio = dist(g.p, q.p) / unit / want;
      if (ratio < 0.6 || ratio > 1.6) off.push(`${name} spacing ×${ratio.toFixed(2)}`);
    }
    return { passed: off.length === 0, detail: off.length ? off.join("; ") : "spacing matches the source" };
  },
};

export const RULES: readonly Policy[] = [baseSelection, frameTimes, smoothingLag, volume, structure, solidHint, followHint, holds, arcs, spacing] as Policy[];
