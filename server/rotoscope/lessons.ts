import type { Check, FrameState } from "./run-state";

// What the generator keeps getting wrong in this run, learned from every
// rejected attempt in the manifest: each failed check becomes a general rule
// (not tied to one frame's coordinates), counted across frames, and the most
// frequent ones go into every new drawing's prompt. Nothing is stored apart:
// the manifest's attempts are the memory, so a resume, a redraw or an
// extension all see the same lessons.

export type Lesson = {
  /** Stable key: one lesson per kind of mistake. */
  readonly key: string;
  /** Said to the generator, in screen terms. */
  readonly rule: string;
  /** Rejected attempts that made this mistake. */
  readonly count: number;
  /** The frames it happened on, ascending. */
  readonly frames: readonly number[];
};

/** The reviewer names the subject's own sides; facing the camera, their right is on the viewer's left. */
const SCREEN: Record<string, { key: string; part: string }> = {
  "right arm (upper arm and forearm)": { key: "arm:screen-left", part: "the arm and hand on the LEFT of the image" },
  "right hand": { key: "arm:screen-left", part: "the arm and hand on the LEFT of the image" },
  "left arm (upper arm and forearm)": { key: "arm:screen-right", part: "the arm and hand on the RIGHT of the image" },
  "left hand": { key: "arm:screen-right", part: "the arm and hand on the RIGHT of the image" },
  "legs and feet": { key: "legs", part: "the legs and feet" },
  "head and torso": { key: "head", part: "the head tilt and the torso lean" },
};

/** The general mistakes one failed check stands for. */
export function mistakes(check: Check): { key: string; rule: string }[] {
  if (check.passed) return [];
  const { name, detail } = check;
  if (name === "pose") {
    if (detail.startsWith("MIRRORED")) return [{ key: "pose:mirrored", rule: "Do not mirror the pose: every limb stays on the same side of the image as in the pose photo." }];
    if (/no full body/.test(detail)) return [{ key: "pose:body", rule: "Draw the whole character, head to feet, facing the camera." }];
    const worst = detail.match(/worst (?:right|left) (upper arm|forearm|thigh|shin)/)?.[1];
    return [{ key: `pose:${worst ?? "angles"}`, rule: worst ? `Copy the exact angle of each ${worst} from the skeleton of Image 2; they came out at the wrong angle.` : "Copy every limb angle from the skeleton of Image 2." }];
  }
  if (name === "scale") {
    const head = Number(detail.match(/head ([+-]?\d+) %/)?.[1]);
    if (Number.isFinite(head) && head < 0) return [{ key: "scale:big", rule: "The figure came out too big: the top of the hair must touch its grid line, even with a hand raised on or over the head. Never fill the canvas." }];
    if (Number.isFinite(head) && head > 0) return [{ key: "scale:small", rule: "The figure came out too small: the top of the hair must reach its grid line." }];
    return [{ key: "scale:feet", rule: "The soles must stand exactly on their grid line, the hips on the green vertical line." }];
  }
  if (name === "proportions") {
    const out: { key: string; rule: string }[] = [];
    const limb = detail.match(/worst (?:left|right)-of-image (upper arm|forearm|thigh|shin) ([+-]\d+) %/);
    if (limb && Number(limb[2]) > 0) out.push({ key: `long:${limb[1]}`, rule: `Each ${limb[1]} came out too long: never longer than its length in the measurements.` });
    if (limb && Number(limb[2]) < 0) out.push({ key: `short:${limb[1]}`, rule: `Each ${limb[1]} came out too short: give it its full length from the measurements.` });
    const head = Number(detail.match(/head ([+-]\d+) %/)?.[1]);
    if (Math.abs(head) > 16) out.push({ key: head > 0 ? "head:big" : "head:small", rule: `The head came out too ${head > 0 ? "big" : "small"}: keep the character sheet's head-to-body ratio.` });
    return out;
  }
  if (name === "alpha") return [{ key: "alpha", rule: "Keep the background one flat magenta with nothing else on it, and the whole figure inside the frame." }];
  if (name === "review") {
    const found = detail.split(" | ").flatMap((part) => {
      const label = part.split(":")[0];
      const screen = SCREEN[label];
      if (screen) return [{ key: `review:${screen.key}`, rule: `${screen.part[0].toUpperCase()}${screen.part.slice(1)} did not match the pose photo: copy them from Image 3 before anything else.` }];
      if (label === "identity") return [{ key: "review:identity", rule: "The character changed: copy hair, face and every clothing item from Image 1, nothing from the person in the pose photo." }];
      if (label.startsWith("style")) return [{ key: "review:style", rule: "The style drifted: same line art and flat colours as Image 1." }];
      if (label === "anatomy") return [{ key: "review:anatomy", rule: "Anatomy was broken: no missing, extra or merged limbs, hands or fingers." }];
      return [];
    });
    // An arm and its hand are one lesson.
    return found.filter((entry, i) => found.findIndex((other) => other.key === entry.key) === i);
  }
  return [];
}

/**
 * Only the latest rejections teach: a mistake the generator stopped making (or one a changed
 * check no longer counts) drops out once this many newer rejections have come in.
 */
export const RECENT_REJECTIONS = 15;

/** The mistakes in the run's latest rejected attempts, most frequent first (ties: most recent first). */
export function learn(frames: readonly FrameState[]): Lesson[] {
  const seen = new Map<string, { rule: string; count: number; frames: Set<number>; last: number }>();
  // Frames are drawn in order, but a redraw adds attempts to an earlier frame: order by time.
  const rejected = frames.flatMap((frame) => frame.attempts.filter((attempt) => !attempt.passed).map((attempt) => ({ frame: frame.index, attempt })))
    .sort((a, b) => a.attempt.at.localeCompare(b.attempt.at))
    .slice(-RECENT_REJECTIONS);
  for (const [order, { frame, attempt }] of rejected.entries()) {
    for (const check of attempt.checks) {
      for (const { key, rule } of mistakes(check)) {
        const entry = seen.get(key) ?? { rule, count: 0, frames: new Set<number>(), last: 0 };
        entry.count++;
        entry.frames.add(frame);
        entry.last = order;
        seen.set(key, entry);
      }
    }
  }
  return [...seen.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.last - a.last)
    .map(([key, entry]) => ({ key, rule: entry.rule, count: entry.count, frames: [...entry.frames].sort((x, y) => x - y) }));
}

/** How many lessons a prompt carries: the generator follows a few rules, not a list. */
export const PROMPT_LESSONS = 5;

/**
 * The prompt lines: the most frequent mistakes of this run, and this frame's own last rejection
 * when the current run has no feedback for it yet (a resume or a redraw starts fresh otherwise).
 */
export function lessonLines(frames: readonly FrameState[], index: number, withEarlier = true): string[] {
  const lessons = learn(frames).slice(0, PROMPT_LESSONS);
  const frame = frames.find((entry) => entry.index === index);
  const last = !withEarlier ? undefined : frame?.attempts.filter((attempt) => !attempt.passed).at(-1);
  const earlier = last ? last.checks.filter((check) => !check.passed).map((check) => check.feedback ?? check.detail).join(" ") : "";
  return [
    ...(lessons.length ? [`Mistakes already made in this animation, do not repeat them:\n${lessons.map((lesson) => `- ${lesson.rule}`).join("\n")}`] : []),
    ...(earlier ? [`An earlier drawing of this same frame was rejected for: ${earlier}`] : []),
  ];
}
