import { describe, expect, it } from "vitest";
import {
  FlipbookPlanSchema,
  WALK_PHASES,
  WALK_POSES,
  cellLeftAt,
  holdFrames,
  outputFrameCount,
  stageSize,
  tickAtOutputFrame,
  tickCount,
} from "./flipbook";

const cell = { width: 600, height: 768, strideX: 400 };

describe("walk cycle library", () => {
  it("is eight distinct phases in stride order, each half mirroring only the gait", () => {
    expect(WALK_POSES.map((pose) => pose.phase)).toEqual([...WALK_PHASES]);
    expect(new Set(WALK_POSES.map((pose) => pose.constraints)).size).toBe(8);
    for (let index = 0; index < 4; index++) {
      expect(WALK_POSES[index].relativeRootY).toBe(WALK_POSES[index + 4].relativeRootY);
      expect(WALK_POSES[index + 4].constraints).toBe(WALK_POSES[index].constraints.replace(/\b(left|right)\b/g, (side) => (side === "left" ? "right" : "left")));
    }
    // Bob chart: down is lowest, up is highest.
    expect(Math.min(...WALK_POSES.map((pose) => pose.relativeRootY))).toBe(WALK_POSES[1].relativeRootY);
    expect(Math.max(...WALK_POSES.map((pose) => pose.relativeRootY))).toBe(WALK_POSES[3].relativeRootY);
  });

  it("rejects a plan whose poses are out of order", () => {
    const poses = WALK_POSES.map((pose, index) => ({ index, phase: pose.phase, label: pose.label, description: pose.constraints, relativeRootY: pose.relativeRootY }));
    const plan = { action: "walk", direction: "right", motion: "in_place", drawingFps: 8, durationSeconds: 4, loop: true, poses };
    expect(FlipbookPlanSchema.safeParse(plan).success).toBe(true);
    expect(FlipbookPlanSchema.safeParse({ ...plan, poses: [poses[1], poses[0], ...poses.slice(2)] }).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse({ ...plan, poses: poses.slice(0, 7) }).success).toBe(false);
  });
});

describe("timing", () => {
  it("holds 8 drawings/s on threes and 12 on twos at 24 fps", () => {
    expect(holdFrames(8)).toBe(3);
    expect(holdFrames(12)).toBe(2);
    expect([0, 1, 2, 3, 23, 24].map((frame) => tickAtOutputFrame(frame, 8))).toEqual([0, 0, 0, 1, 7, 8]);
    expect([0, 1, 2, 3].map((frame) => tickAtOutputFrame(frame, 12))).toEqual([0, 0, 1, 1]);
  });

  it("makes every supported length a whole number of 8-drawing cycles", () => {
    for (const duration of [2, 4, 6] as const) {
      expect(outputFrameCount(duration)).toBe(duration * 24);
      for (const fps of [8, 12] as const) {
        expect(tickCount(duration, fps) % 8).toBe(0);
        // The last output frame shows the last drawing of a cycle: the loop restarts cleanly on frame 1.
        expect(tickAtOutputFrame(outputFrameCount(duration) - 1, fps) % 8).toBe(7);
      }
    }
  });
});

describe("placement", () => {
  it("keeps a walk in place centered on its cell", () => {
    expect(stageSize("in_place", cell)).toEqual({ width: 600, height: 768 });
    for (let tick = 0; tick < 16; tick++) expect(cellLeftAt(tick, { motion: "in_place", speed: 1 }, cell, 8)).toBe(0);
  });

  it("moves one stride per cycle, stepping once per drawing, in the walking direction", () => {
    const stage = stageSize("right", cell);
    expect(stage.height).toBe(768);
    expect(stage.width % 2).toBe(0);
    const start = cellLeftAt(0, { motion: "right", speed: 1 }, cell, 8);
    expect(start).toBe(Math.round((stage.width - cell.width) / 2));
    expect(cellLeftAt(8, { motion: "right", speed: 1 }, cell, 8) - start).toBe(400);
    expect(cellLeftAt(1, { motion: "right", speed: 1 }, cell, 8) - start).toBe(50);
    expect(cellLeftAt(1, { motion: "left", speed: 1 }, cell, 8) - start).toBe(-50);
    expect(cellLeftAt(1, { motion: "right", speed: 1.5 }, cell, 8) - start).toBe(75);
  });

  it("wraps around the stage instead of walking off forever", () => {
    const stage = stageSize("right", cell);
    for (let tick = 0; tick < 200; tick++) {
      const left = cellLeftAt(tick, { motion: "right", speed: 1.5 }, cell, 8);
      expect(left).toBeGreaterThanOrEqual(-cell.width);
      expect(left).toBeLessThan(stage.width + 1);
    }
  });
});
