import { z } from "zod";
import { SEQUENCE_CLOCK } from "./sequence";

// Pose-to-pose timing, the way a cel animator plans it: key poses and
// breakdowns first, then a timing chart between each pair of keys (how many
// in-betweens, which ease, on ones or twos), and the in-betweens last, each
// drawn halfway between two drawings that already exist. Time is counted in
// ticks of the 24 fps clock; a drawing "on twos" stays on screen two ticks.

/**
 * What a key does in the action. Breakdowns are drawn with the keys: they
 * carry the arc or the change of shape (legs straightening before take-off)
 * the in-betweens can't guess from the keys alone. `extreme` is any other
 * key: a point where the motion changes direction.
 */
export const KEY_ROLES = ["idle", "anticipation", "breakdown", "action", "overshoot", "recoil", "settle", "extreme"] as const;
export const KeyRoleSchema = z.enum(KEY_ROLES);
export type KeyRole = z.infer<typeof KeyRoleSchema>;

/**
 * Spacing between two keys, in the animator's sense: `in` eases into the
 * next key (fast start, drawings bunch up toward the end), `out` eases out
 * of this key (slow start, bunched near it), `in_out` both, `none` even.
 */
export const EaseSchema = z.enum(["none", "in", "out", "in_out"]);
export type Ease = z.infer<typeof EaseSchema>;

/** Ticks one drawing stays on screen: on ones, twos or threes. */
export const ExposureSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Exposure = z.infer<typeof ExposureSchema>;

/** Squash or stretch of the body at a key, as a share of its height; volume stays the same. */
export const DeformSchema = z.object({ kind: z.enum(["none", "squash", "stretch"]), amount: z.number().min(0).max(0.35) });
export type Deform = z.infer<typeof DeformSchema>;

export const MAX_KEYS = 24;
export const MAX_INBETWEENS = 12;
export const MAX_HOLD_TICKS = 48;

export const TimingKeySchema = z.object({
  role: KeyRoleSchema,
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(900),
  /** Extra ticks the key stays still before moving on (a held pose). */
  hold: z.number().int().min(0).max(MAX_HOLD_TICKS),
  deform: DeformSchema,
  /** Feet above the ground, as a share of the standing height: 0.6 at a jump's apex. */
  lift: z.number().min(0).max(2).default(0),
});
export type TimingKey = z.infer<typeof TimingKeySchema>;

/** The timing chart from one key to the next. */
export const TimingSegmentSchema = z.object({
  ease: EaseSchema,
  inbetweens: z.number().int().min(0).max(MAX_INBETWEENS),
  exposure: ExposureSchema,
});
export type TimingSegment = z.infer<typeof TimingSegmentSchema>;

export const TimingChartSchema = z
  .object({
    durationSeconds: z.number().int().min(1).max(20),
    keys: z.array(TimingKeySchema).min(2).max(MAX_KEYS),
    segments: z.array(TimingSegmentSchema),
  })
  .superRefine((chart, context) => {
    if (chart.segments.length !== chart.keys.length - 1) {
      context.addIssue({ code: "custom", path: ["segments"], message: "Every pair of neighboring keys needs exactly one timing segment." });
      return;
    }
    const last = keyTicks(chart).at(-1)!;
    if (last >= chart.durationSeconds * SEQUENCE_CLOCK) context.addIssue({ code: "custom", path: ["segments"], message: "The last key must start before the clip ends." });
  });
export type TimingChart = z.infer<typeof TimingChartSchema>;

/** Ticks one segment lasts: the key's own exposure and hold, then one exposure per in-between. */
export function segmentTicks(key: Pick<TimingKey, "hold">, segment: TimingSegment): number {
  return key.hold + segment.exposure * (segment.inbetweens + 1);
}

/** The tick at which every key appears. */
export function keyTicks(chart: Pick<TimingChart, "keys" | "segments">): number[] {
  const ticks = [0];
  chart.segments.forEach((segment, index) => ticks.push(ticks[index] + segmentTicks(chart.keys[index], segment)));
  return ticks;
}

/**
 * Where the in-betweens of one segment sit between its keys, 0 at the first
 * key and 1 at the next, from evenly spaced drawing times passed through the
 * ease. One in-between of an eased segment is favored toward the slow key
 * rather than drawn at the exact middle, as an animator would.
 */
export function inbetweenPositions(ease: Ease, count: number): number[] {
  const curve = (t: number) => {
    if (ease === "in") return 1 - (1 - t) ** 2;
    if (ease === "out") return t ** 2;
    if (ease === "in_out") return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2;
    return t;
  };
  return Array.from({ length: count }, (_, index) => curve((index + 1) / (count + 1)));
}

export type TimelineDrawing = {
  /** `k3` for the fourth key, `k3.1` for the second in-between after it. */
  readonly id: string;
  readonly kind: "key" | "inbetween";
  readonly role?: KeyRole;
  /** Key index, or the key the in-between follows. */
  readonly key: number;
  readonly tick: number;
  /** Ticks on screen. */
  readonly ticks: number;
  /** Along the segment from `key` to `key + 1`; 0 for a key. */
  readonly position: number;
};

/** Every drawing in playback order with its exposure; the last key holds to the end of the clip. */
export function timeline(chart: TimingChart): TimelineDrawing[] {
  const starts = keyTicks(chart);
  const total = chart.durationSeconds * SEQUENCE_CLOCK;
  const drawings: TimelineDrawing[] = [];
  chart.keys.forEach((key, index) => {
    const segment = chart.segments[index];
    if (!segment) {
      drawings.push({ id: `k${index}`, kind: "key", role: key.role, key: index, tick: starts[index], ticks: total - starts[index], position: 0 });
      return;
    }
    drawings.push({ id: `k${index}`, kind: "key", role: key.role, key: index, tick: starts[index], ticks: key.hold + segment.exposure, position: 0 });
    inbetweenPositions(segment.ease, segment.inbetweens).forEach((position, step) => {
      drawings.push({ id: `k${index}.${step}`, kind: "inbetween", key: index, tick: starts[index] + key.hold + segment.exposure * (step + 1), ticks: segment.exposure, position });
    });
  });
  return drawings;
}

export type InbetweenTask = {
  readonly id: string;
  /** The drawings it is drawn between: keys or in-betweens drawn before it. */
  readonly from: string;
  readonly to: string;
  /** Where it sits between `from` and `to`, near 0.5 when the spacing is smooth. */
  readonly position: number;
  /** Halving round: tasks of one round only need keys and earlier rounds. */
  readonly depth: number;
};

/**
 * The order to draw a segment's in-betweens by halves: the middle one first,
 * between the two keys, then the middle of each half between the drawings
 * already made, so every in-between is drawn between two finished neighbors.
 */
export function inbetweenOrder(chart: TimingChart, key: number): InbetweenTask[] {
  const segment = chart.segments[key];
  if (!segment) return [];
  const points = [{ id: `k${key}`, position: 0 }, ...inbetweenPositions(segment.ease, segment.inbetweens).map((position, step) => ({ id: `k${key}.${step}`, position })), { id: `k${key + 1}`, position: 1 }];
  const tasks: InbetweenTask[] = [];
  const queue: [number, number, number][] = [[0, points.length - 1, 0]];
  while (queue.length) {
    const [low, high, depth] = queue.shift()!;
    if (high - low < 2) continue;
    const middle = Math.floor((low + high) / 2);
    const from = points[low], to = points[high], at = points[middle];
    tasks.push({ id: at.id, from: from.id, to: to.id, position: (at.position - from.position) / (to.position - from.position), depth });
    queue.push([low, middle, depth + 1], [middle, high, depth + 1]);
  }
  return tasks;
}

/** Every in-between of the chart on timeline indexes (the plan's pose indexes), round by round across segments. */
export function inbetweenTasks(chart: TimingChart): { index: number; from: number; to: number; position: number; depth: number }[] {
  const indexOf = new Map(timeline(chart).map((drawing, index) => [drawing.id, index]));
  return chart.segments
    .flatMap((_, key) => inbetweenOrder(chart, key))
    .map((task) => ({ index: indexOf.get(task.id)!, from: indexOf.get(task.from)!, to: indexOf.get(task.to)!, position: task.position, depth: task.depth }))
    .sort((a, b) => a.depth - b.depth);
}

/** Timeline indexes of the keys and breakdowns: drawn first, from their own poses. */
export function keyIndexes(chart: TimingChart): number[] {
  return timeline(chart).flatMap((drawing, index) => drawing.kind === "key" ? [index] : []);
}

/**
 * How far the feet are off the ground at every drawing: a key's own, an
 * in-between's along its segment at its eased position, so a jump rises
 * slowing toward the apex and falls speeding up as its spacing does.
 */
export function liftTrack(chart: TimingChart): number[] {
  return timeline(chart).map((drawing) => {
    const from = chart.keys[drawing.key], to = chart.keys[drawing.key + 1] ?? from;
    return from.lift + (to.lift - from.lift) * drawing.position;
  });
}

/** Squash or stretch as a drawing instruction; the body keeps its volume. */
export function deformInstruction(deform: Deform): string {
  if (deform.kind === "none" || deform.amount === 0) return "";
  const percent = Math.round(deform.amount * 100);
  return deform.kind === "squash"
    ? `Squash the body about ${percent}% shorter and as much wider, keeping the same volume; the feet stay planted.`
    : `Stretch the body about ${percent}% taller and as much narrower along the direction of motion, keeping the same volume.`;
}
