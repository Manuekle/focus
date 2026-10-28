import { describe, expect, it } from "vitest";
import { FlipbookPlanSchema, FrameIdSchema } from "./flipbook";
import { sequenceTicks, sequenceFrameId, sequenceIndexAt, SequenceSettingsSchema } from "./sequence";

describe("continuous sequence", () => {
  it("allocates the complete chosen duration rather than eight looping poses", () => {
    expect(sequenceTicks({ durationSeconds: 4, drawingFps: 24 })).toHaveLength(96);
    expect(sequenceTicks({ durationSeconds: 20, drawingFps: 24 })).toEqual(Array.from({ length: 480 }, (_, i) => i));
  });
  it("preserves time when adding drawings at a denser rate", () => {
    const dense = new Set(sequenceTicks({ durationSeconds: 4, drawingFps: 24 }));
    for (const fps of [8, 12] as const) {
      const ticks = sequenceTicks({ durationSeconds: 4, drawingFps: fps });
      expect(ticks.every((tick) => dense.has(tick))).toBe(true);
      expect(ticks[1] / 24).toBe(1 / fps);
    }
  });
  it("stops at the last drawing without wrapping to the first", () => {
    expect(sequenceIndexAt(3.99, { durationSeconds: 4, drawingFps: 24 })).toBe(95);
    expect(sequenceIndexAt(4, { durationSeconds: 4, drawingFps: 24 })).toBe(95);
    expect(sequenceIndexAt(-1, { durationSeconds: 4, drawingFps: 24 })).toBe(0);
  });
  it("bounds inputs and keeps legacy frame IDs separate", () => {
    expect(SequenceSettingsSchema.safeParse({ durationSeconds: 21, drawingFps: 24 }).success).toBe(false);
    expect(SequenceSettingsSchema.safeParse({ durationSeconds: 4, drawingFps: 4 }).success).toBe(false);
    expect(FrameIdSchema.safeParse(sequenceFrameId(479)).success).toBe(true);
    for (const id of ["s480", "s01", "s-1", "f48"]) expect(FrameIdSchema.safeParse(id).success).toBe(false);
  });
  it("validates every sequence timestamp and rejects an eight-frame substitute", () => {
    const poses = sequenceTicks({ durationSeconds: 4, drawingFps: 24 }).map((tick, index) => ({ index, phase: `sample_${tick}`, label: "Movement", description: "Raise the arm gradually.", relativeRootY: 0, lift: 0 }));
    const plan = { mode: "sequence", action: "dance", direction: "right", motion: "in_place", drawingFps: 24, durationSeconds: 4, loop: false, poses };
    expect(FlipbookPlanSchema.safeParse(plan).success).toBe(true);
    expect(FlipbookPlanSchema.safeParse({ ...plan, poses: poses.slice(0, 8) }).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse({ ...plan, poses: poses.map((pose, i) => i === 95 ? { ...pose, phase: "sample_0" } : pose) }).success).toBe(false);
  });
});
