import { describe, expect, it } from "vitest";
import {
  ACTION_SPECS,
  ANIMATION_ACTIONS,
  ZOOM_DEPTH,
  backgroundMoves,
  backgroundScrolls,
  backgroundZoomAt,
  FlipbookPlanSchema,
  WALK_PHASES,
  WALK_POSES,
  backgroundShiftAt,
  cellLeftAt,
  cellTopAt,
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
  it("keeps a walk in place centered on a landscape stage", () => {
    const landscape = { motion: "in_place" as const, aspect: "16:9" as const, speed: 1 };
    const stage = stageSize(landscape, cell);
    expect(stage).toEqual({ width: 1366, height: 768 });
    expect(cellTopAt(landscape, cell)).toBe(0);
    for (let tick = 0; tick < 16; tick++) expect(cellLeftAt(tick, landscape, cell, 8)).toBe(Math.round((stage.width - cell.width) / 2));
  });

  it("holds the whole cell in a portrait stage, standing on the bottom", () => {
    const portrait = { motion: "in_place" as const, aspect: "9:16" as const, speed: 1 };
    const stage = stageSize(portrait, cell);
    expect(stage.width).toBeGreaterThanOrEqual(cell.width);
    expect(stage.height).toBeGreaterThanOrEqual(cell.height);
    expect(stage.width % 2).toBe(0);
    expect(stage.height % 2).toBe(0);
    expect(Math.abs(stage.width / stage.height - 9 / 16)).toBeLessThan(0.002);
    expect(cellTopAt(portrait, cell)).toBe(stage.height - cell.height);
    // A cell wider than a tall portrait would be still gets a stage that fits it.
    const wide = stageSize(portrait, { width: 900, height: 300 });
    expect(wide.width).toBeGreaterThanOrEqual(900);
    expect(Math.abs(wide.width / wide.height - 9 / 16)).toBeLessThan(0.002);
  });

  it("moves one stride per cycle, stepping once per drawing, in the walking direction", () => {
    const stage = stageSize({ aspect: "16:9" }, cell);
    expect(stage.height).toBe(768);
    expect(stage.width % 2).toBe(0);
    const start = cellLeftAt(0, { motion: "right", aspect: "16:9", speed: 1 }, cell, 8);
    expect(start).toBe(Math.round((stage.width - cell.width) / 2));
    expect(cellLeftAt(8, { motion: "right", aspect: "16:9", speed: 1 }, cell, 8) - start).toBe(400);
    expect(cellLeftAt(1, { motion: "right", aspect: "16:9", speed: 1 }, cell, 8) - start).toBe(50);
    expect(cellLeftAt(1, { motion: "left", aspect: "16:9", speed: 1 }, cell, 8) - start).toBe(-50);
    expect(cellLeftAt(1, { motion: "right", aspect: "16:9", speed: 1.5 }, cell, 8) - start).toBe(75);
  });

  it("wraps around the stage instead of walking off forever", () => {
    const stage = stageSize({ aspect: "16:9" }, cell);
    for (let tick = 0; tick < 200; tick++) {
      const left = cellLeftAt(tick, { motion: "right", aspect: "16:9", speed: 1.5 }, cell, 8);
      expect(left).toBeGreaterThanOrEqual(-cell.width);
      expect(left).toBeLessThan(stage.width + 1);
    }
  });
});

describe("moving backgrounds", () => {
  it("slide back by exactly one stride per cycle in place, against the facing", () => {
    const inPlace = { motion: "in_place" as const, speed: 1.4 };
    expect(backgroundShiftAt(0, inPlace, cell, 8, "right")).toBe(0);
    // The speed slider only applies to travel: in place the feet stay planted.
    expect(backgroundShiftAt(8, inPlace, cell, 8, "right")).toBe(400);
    expect(backgroundShiftAt(8, inPlace, cell, 8, "left")).toBe(-400);
  });

  it("pan slowly in the travel direction, and drift when there is no stride", () => {
    expect(backgroundShiftAt(8, { motion: "left", speed: 1 }, cell, 8, "right")).toBe(-140);
    expect(backgroundShiftAt(10, { motion: "in_place", speed: 1 }, { ...cell, strideX: 0 }, 8, "right")).toBe(180);
  });
});

describe("action library", () => {
  it("gives every action eight distinct phases that no other action uses", () => {
    const all = ANIMATION_ACTIONS.flatMap((action) => ACTION_SPECS[action].poses.map((pose) => pose.phase));
    expect(new Set(all).size).toBe(all.length);
    for (const action of ANIMATION_ACTIONS) expect(ACTION_SPECS[action].poses).toHaveLength(8);
  });

  it("keeps the jump inside the cell and draws its crouches shorter", () => {
    const jump = ACTION_SPECS.jump;
    expect(jump.travels).toBe(false);
    expect(Math.max(...jump.poses.map((pose) => pose.lift))).toBeLessThanOrEqual(0.15);
    expect(jump.poses.find((pose) => pose.phase === "jump_crouch")!.relativeRootY).toBeLessThan(-0.15);
    expect(jump.poses.filter((pose) => pose.lift > 0).map((pose) => pose.phase)).toEqual(["jump_rise", "jump_apex", "jump_fall"]);
  });

  it("marks the quiet motions as subtle", () => {
    expect(ANIMATION_ACTIONS.filter((action) => ACTION_SPECS[action].subtle)).toEqual(["wave", "idle"]);
  });
});

describe("scene motion", () => {
  it("zooms in and back out once over the length, so the export loops", () => {
    const pace = { durationSeconds: 2 as const, drawingFps: 8 as const };
    expect(backgroundZoomAt(0, pace)).toBe(1);
    expect(backgroundZoomAt(8, pace)).toBeCloseTo(1 + ZOOM_DEPTH, 6);
    expect(backgroundZoomAt(16, pace)).toBe(1);
    expect(backgroundZoomAt(4, pace)).toBeCloseTo(backgroundZoomAt(12, pace), 6);
  });

  it("knows which backgrounds slide and which move at all", () => {
    expect(backgroundScrolls({ kind: "scene", motion: "parallax" })).toBe(true);
    expect(backgroundScrolls({ kind: "scene", motion: "zoom" })).toBe(false);
    expect(backgroundMoves({ kind: "generated", motion: "zoom" })).toBe(true);
    expect(backgroundMoves({ kind: "scene" })).toBe(false);
    expect(backgroundMoves({ kind: "color", color: "#ffffff" })).toBe(false);
  });
});
