import { describe, expect, it } from "vitest";
import {
  ACTION_SPECS,
  ANIMATION_ACTIONS,
  ZOOM_DEPTH,
  backgroundMoves,
  backgroundScrolls,
  backgroundZoomAt,
  FlipbookPlanSchema,
  FlipbookSchema,
  DrawingIdSchema,
  FrameIdSchema,
  MAX_FRAMES,
  beatPhase,
  ensembleDrawings,
  frameIdAt,
  WALK_PHASES,
  WALK_POSES,
  backgroundShiftAt,
  cellLeftAt,
  cellTopAt,
  drawingAtFrame,
  exposureSheet,
  exposures,
  frameAtTick,
  holdFrames,
  outputFrameCount,
  stageClock,
  stageSize,
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
  const phases = (action: (typeof ANIMATION_ACTIONS)[number]) => ACTION_SPECS[action].poses.map((pose) => pose.phase);

  it("holds an even cycle on threes at 8 drawings/s and on twos at 12", () => {
    expect(holdFrames(8)).toBe(3);
    expect(holdFrames(12)).toBe(2);
    const walk = exposures(phases("walk"), 8);
    expect(walk).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect([0, 1, 2, 3, 23, 24].map((frame) => drawingAtFrame(frame, walk).tick)).toEqual([0, 0, 0, 1, 7, 8]);
    expect([0, 1, 2, 3].map((frame) => drawingAtFrame(frame, exposures(phases("walk"), 12)).tick)).toEqual([0, 0, 1, 1]);
  });

  it("times a fight like anime: the hits and the guard hold, the loads go by on ones", () => {
    const fight = exposures(phases("fight"), 12);
    expect(fight).toEqual([3, 1, 3, 1, 1, 3, 2, 2]);
    expect(exposures(phases("fight"), 8)).toEqual([4, 2, 4, 2, 2, 4, 3, 3]);
    // Frame 4 is the jab: one frame of load, then three of the hit.
    expect([0, 3, 4, 5, 7].map((frame) => drawingAtFrame(frame, fight).index)).toEqual([0, 1, 2, 2, 3]);
    expect(frameAtTick(2, fight)).toBe(4);
    expect(frameAtTick(9, fight)).toBe(16 + 3);
  });

  it("gives each in-between one frame of the key before it, so the cycle keeps its length", () => {
    const withInbetweens = (action: (typeof ANIMATION_ACTIONS)[number]) => phases(action).flatMap((phase) => [{ phase, inbetween: false }, { phase, inbetween: true }]);
    // At 8/s every key has room: the keys hold, the in-betweens go by on ones.
    const fight = exposureSheet(withInbetweens("fight"), 8);
    expect(fight.holds).toEqual([3, 1, 1, 1, 3, 1, 1, 1, 1, 1, 3, 1, 2, 1, 2, 1]);
    expect(fight.drawings).toHaveLength(16);
    // At 12/s a key already on ones leaves none: its in-between isn't shown.
    const brisk = exposureSheet(withInbetweens("fight"), 12);
    expect(brisk.holds.reduce((sum, hold) => sum + hold, 0)).toBe(16);
    expect(brisk.drawings.filter((drawing) => drawing.inbetween)).toHaveLength(5);
    expect(exposureSheet(withInbetweens("walk"), 8).holds).toEqual([2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1]);
    // Without in-betweens it is the plain exposure sheet.
    expect(exposureSheet(phases("jump").map((phase) => ({ phase })), 8).holds).toEqual(exposures(phases("jump"), 8));
  });

  it("falls back to even holds when a cycle's anime timing doesn't add up", () => {
    expect(exposures(["guard", "jab_hit", "left_contact"], 8)).toEqual([3, 3, 3]);
  });

  it("makes every supported length a whole number of cycles for every action", () => {
    for (const duration of [2, 4, 6] as const) {
      expect(outputFrameCount(duration)).toBe(duration * 24);
      for (const fps of [8, 12] as const) {
        expect(tickCount(duration, fps) % 8).toBe(0);
        for (const action of ANIMATION_ACTIONS) {
          const holds = exposures(phases(action), fps);
          expect(holds.reduce((sum, hold) => sum + hold, 0)).toBe(8 * holdFrames(fps));
          // The last output frame shows the last drawing of a cycle: the loop restarts cleanly on frame 1.
          expect(drawingAtFrame(outputFrameCount(duration) - 1, holds).index).toBe(7);
        }
      }
    }
  });

  it("runs the camera clock on every output frame", () => {
    expect(stageClock(1, 8)).toBeCloseTo(1 / 3, 6);
    expect(stageClock(24, 12)).toBe(12);
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
    // Between drawings it keeps moving: a third of a drawing is a third of the step.
    expect(backgroundShiftAt(1 / 3, inPlace, cell, 8, "right")).toBe(17);
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

describe("a scene of several characters", () => {
  const scenePlan = (seconds: number, overrides: Record<string, unknown> = {}) => ({
    action: "ensemble",
    direction: "right",
    view: "side",
    motion: "in_place",
    drawingFps: 8,
    durationSeconds: seconds,
    loop: true,
    poses: Array.from({ length: ensembleDrawings(seconds) }, (_, index) => ({ index, phase: beatPhase(index), label: `Beat ${index + 1}`, description: "Character 1 punches.", relativeRootY: 0, lift: 0 })),
    ...overrides,
  });

  it("has one drawing per beat: the duration at eight a second, up to 48", () => {
    expect(ensembleDrawings(1)).toBe(8);
    expect(ensembleDrawings(6)).toBe(MAX_FRAMES);
    for (const seconds of [1, 2, 3, 4, 5, 6]) expect(FlipbookPlanSchema.safeParse(scenePlan(seconds)).success).toBe(true);
    expect(FlipbookPlanSchema.safeParse(scenePlan(7)).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse(scenePlan(0)).success).toBe(false);
  });

  it("rejects a plan whose drawings don't match its length, pace or order", () => {
    const short = scenePlan(2);
    expect(FlipbookPlanSchema.safeParse({ ...short, poses: short.poses.slice(0, 15) }).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse(scenePlan(2, { drawingFps: 12 })).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse(scenePlan(2, { motion: "left" })).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse({ ...short, poses: [...short.poses.slice(1), short.poses[0]] }).success).toBe(false);
  });

  it("keeps cycles strict: eight drawings, and 2, 4 or 6 seconds", () => {
    const walk = { action: "walk", direction: "right", motion: "in_place", drawingFps: 8, durationSeconds: 4, loop: true, poses: ACTION_SPECS.walk.poses.map((pose, index) => ({ index, phase: pose.phase, label: pose.label, description: pose.constraints, relativeRootY: pose.relativeRootY, lift: pose.lift })) };
    expect(FlipbookPlanSchema.safeParse(walk).success).toBe(true);
    expect(FlipbookPlanSchema.safeParse({ ...walk, durationSeconds: 3 }).success).toBe(false);
    expect(FlipbookPlanSchema.safeParse({ ...walk, poses: [...walk.poses, { ...walk.poses[0], index: 8 }] }).success).toBe(false);
  });

  it("names drawings f0 to f47 and refuses anything else", () => {
    expect(FrameIdSchema.safeParse(frameIdAt(0)).success).toBe(true);
    expect(FrameIdSchema.safeParse(frameIdAt(47)).success).toBe(true);
    for (const bad of ["f48", "f-1", "f01", "i3", "f", "x1"]) expect(FrameIdSchema.safeParse(bad).success).toBe(false);
    expect(DrawingIdSchema.safeParse("i7").success).toBe(true);
    expect(DrawingIdSchema.safeParse("f47").success).toBe(true);
    expect(DrawingIdSchema.safeParse("g1").success).toBe(false);
  });

  it("holds every drawing for three frames, so a scene lasts exactly as long as its drawings", () => {
    for (const seconds of [1, 3, 6]) {
      const phases = Array.from({ length: ensembleDrawings(seconds) }, (_, index) => beatPhase(index));
      const holds = exposures(phases, 8);
      expect(new Set(holds)).toEqual(new Set([3]));
      expect(holds.reduce((sum, hold) => sum + hold, 0)).toBe(outputFrameCount(seconds));
      expect(drawingAtFrame(outputFrameCount(seconds) - 1, holds)).toEqual({ tick: phases.length - 1, index: phases.length - 1 });
      expect(frameAtTick(phases.length - 1, holds)).toBe(outputFrameCount(seconds) - 3);
    }
    expect(ACTION_SPECS.ensemble).toMatchObject({ travels: false, drawingFps: 8, subtle: true, stride: null });
  });

  it("opens animations saved before scenes existed, without a cast", () => {
    const parsed = FlipbookSchema.shape.cast.parse(undefined);
    expect(parsed).toEqual([]);
  });
});
