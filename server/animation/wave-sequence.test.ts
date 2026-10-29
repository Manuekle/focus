import { describe, expect, it } from "vitest";
import { drawingAtOutputFrame, exposureSheet } from "../../shared/flipbook";
import { planWaveSequence, waveAnchorIndexes, waveMotionAt } from "./wave-sequence";

describe("one natural greeting", () => {
  it("uses the whole four seconds to raise, wave gently, and lower once", () => {
    expect(waveMotionAt(0, 4)).toMatchObject({ lift: 0, stage: "Raise the hand" });
    expect(waveMotionAt(1, 4).lift).toBe(1);
    expect(waveMotionAt(3, 4).lift).toBe(1);
    expect(waveMotionAt(4, 4)).toMatchObject({ lift: 0, stage: "Lower the hand" });
    expect([1.25, 1.75, 2.25, 2.75].map((time) => waveMotionAt(time, 4).wristDegrees)).toEqual([12, -12, 12, -12]);
  });
  it("keeps 48 drawings and 240 output frames on the same four-second clock", () => {
    const plan = planWaveSequence({ drawingFps: 12, durationSeconds: 4 }, "front", "Wave hello");
    expect(plan.poses).toHaveLength(48);
    const sheet = exposureSheet(plan.poses, 12);
    expect(sheet.holds).toEqual(Array(48).fill(2));
    expect(sheet.holds.reduce((sum, hold) => sum + hold, 0)).toBe(96);
    expect(Array.from({ length: 240 }, (_, frame) => drawingAtOutputFrame(frame, sheet.holds).index)).toEqual(Array.from({ length: 240 }, (_, frame) => Math.floor(frame / 5)));
    expect(plan.poses.at(-1)?.description).toContain("down beside the thigh");
  });
  it("anchors every change of direction rather than interpolating through a reversal", () => {
    const plan = planWaveSequence({ drawingFps: 12, durationSeconds: 4 }, "front", "Wave with the left hand");
    expect(waveAnchorIndexes(plan)).toEqual([0, 6, 12, 15, 21, 27, 33, 36, 42, 47]);
    expect(plan.poses.every((pose) => pose.description.includes("character's left arm"))).toBe(true);
    expect(plan.poses.every((pose) => pose.description.includes("viewer's right"))).toBe(true);
  });
  it("does not turn the resting-arm instruction into the waving-arm choice", () => {
    const plan = planWaveSequence({ drawingFps: 12, durationSeconds: 4 }, "front", "Raise the right hand. The left arm stays still.");
    expect(plan.poses[0].description).toContain("character's right arm");
    expect(plan.poses[0].description).toContain("viewer's left");
  });
});
