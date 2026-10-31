import { MOTION_SNAP, motionSignature, orderedFrames, playbackCycle, type DrawingId, type Flipbook, type FrameId, type MotionSnap } from "../../shared/flipbook";

// The motion check. Every drawing of the played loop is compared with the
// next by outline: a smooth step changes little, a jump changes a lot. Where
// the loop jumps, the measurements go to Muse Spark, which picks the key
// poses that break the flow and rewrites them; the person approves before
// anything is redrawn. A rewritten key is kept only if it now sits closer to
// its neighbors (`keyFit`), so a correction never leaves a worse drawing.

/** A drawing's cut-out sprite on the shared cell. */
export type SpriteOf = (drawingId: DrawingId) => Promise<Buffer>;
/** Outline change between two sprites: 0 same, 1 no overlap. */
export type OutlineChange = (a: Buffer, b: Buffer) => Promise<number>;

export type LoopMeasure = { readonly signature: string; readonly mean: number; readonly worst: number; readonly snaps: MotionSnap[] };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Each played step's outline change, and the ones that read as jumps. */
export async function measureLoop(flipbook: Flipbook, sprite: SpriteOf, change: OutlineChange): Promise<LoopMeasure> {
  const cycle = playbackCycle(flipbook, true);
  const gapOf = (drawingId: DrawingId): FrameId => (flipbook.inbetweens.find((entry) => entry.id === drawingId)?.from ?? drawingId) as FrameId;
  const steps: { from: DrawingId; to: DrawingId; change: number }[] = [];
  for (const [index, drawing] of cycle.entries()) {
    const next = cycle[(index + 1) % cycle.length];
    steps.push({ from: drawing.id, to: next.id, change: round(await change(await sprite(drawing.id), await sprite(next.id))) });
  }
  const values = steps.map((step) => step.change);
  return {
    signature: motionSignature(flipbook),
    mean: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
    worst: Math.max(0, ...values),
    snaps: steps.filter((step) => step.change >= MOTION_SNAP).sort((a, b) => b.change - a.change).map((step) => ({ ...step, gap: gapOf(step.from) })),
  };
}

/** How far a key sits from its neighbors: the larger outline change to the key before or after it. Lower fits better. */
export async function keyFit(flipbook: Flipbook, frameId: FrameId, sprite: SpriteOf, change: OutlineChange): Promise<number> {
  const order = orderedFrames(flipbook).map((frame) => frame.id);
  const at = order.indexOf(frameId);
  const before = order[(at - 1 + order.length) % order.length];
  const after = order[(at + 1) % order.length];
  const own = await sprite(frameId);
  return round(Math.max(await change(await sprite(before), own), await change(own, await sprite(after))));
}

/**
 * What Muse Spark reads to correct the jumps: where they are, how much each
 * key changes into the next, and how much it would change if one key were
 * skipped, which shows the key that doesn't sit between its neighbors.
 */
export async function motionFixRequest(flipbook: Flipbook, measure: LoopMeasure, sprite: SpriteOf, change: OutlineChange): Promise<string> {
  const frames = orderedFrames(flipbook);
  const position = new Map(frames.map((frame, index) => [frame.id, index + 1] as const));
  const name = (drawingId: DrawingId) => {
    const key = position.get(drawingId as FrameId);
    if (key) return `frame ${key}`;
    const entry = flipbook.inbetweens.find((candidate) => candidate.id === drawingId);
    return entry ? `an in-between of ${position.get(entry.from)} → ${position.get(entry.to)}` : drawingId;
  };
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const lines: string[] = [];
  for (const [index, frame] of frames.entries()) {
    const next = frames[(index + 1) % frames.length];
    const after = frames[(index + 2) % frames.length];
    const own = await sprite(frame.id);
    lines.push(`${index + 1} → ${(index + 1) % frames.length + 1}: ${percent(await change(own, await sprite(next.id)))} (skipping ${(index + 1) % frames.length + 1}, ${index + 1} → ${(index + 2) % frames.length + 1}: ${percent(await change(own, await sprite(after.id)))})`);
  }
  const jumps = measure.snaps.slice(0, 4).map((snap) => `${name(snap.from)} → ${name(snap.to)}, in the part ${position.get(snap.gap)} → ${((position.get(snap.gap) ?? 0) % frames.length) + 1}: ${percent(snap.change)} in one step`);
  return [
    `The motion check of the played loop found ${measure.snaps.length === 1 ? "a visible jump" : `${measure.snaps.length} visible jumps`}: ${jumps.join("; ")}. A smooth step changes the outline about ${percent(measure.mean)}; a jump is ${percent(MOTION_SNAP)} or more.`,
    `Outline change from each key drawing to the next, and to the one after if the next were skipped:\n${lines.join("\n")}`,
    "Fix the jumps by rewriting the key pose or poses that break the flow. Usually one key does not sit between its neighbors: its pose is much wider, higher or further along than the keys around it (a small change when that key is skipped points to it). Rewrite only those keys so each sits naturally between the key before and after it, with the same phase, side and action, as the same kind of movement as its neighbors. Change as few frames as possible and keep every other frame as it is. If nothing in the key poses explains the jump, propose no change and say so.",
  ].join("\n\n");
}
