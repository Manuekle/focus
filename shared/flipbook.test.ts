import { describe, expect, it } from "vitest";
import {
  ACTION_SPECS,
  ANIMATION_ACTIONS,
  ZOOM_DEPTH,
  backgroundMoves,
  backgroundImageRect,
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
  drawingAtOutputFrame,
  exposureFrameCount,
  exposureSheet,
  exposures,
  frameAtTick,
  holdFrames,
  inbetweenAt,
  outputClock,
  playbackClock,
  poseSmoothingAt,
  outputFrameAtTick,
  outputFrameCount,
  stageClock,
  stageSize,
  tickClock,
  tickCount,
} from "./flipbook";

const cell = { width: 600, height: 768, strideX: 400 };

describe("independent cycle tempo and light smoothing", () => {
  it("fits all four image edges in either aspect, including the full-image zoom range", () => {
    for (const stage of [{ width: 514, height: 912 }, { width: 1366, height: 768 }]) {
      for (const image of [{ width: 1600, height: 900 }, { width: 736, height: 1227 }]) {
        for (const zoom of [1 / (1 + ZOOM_DEPTH), 1]) {
          const rect = backgroundImageRect(stage, image, undefined, zoom);
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.top).toBeGreaterThanOrEqual(0);
          expect(rect.left + rect.width).toBeLessThanOrEqual(stage.width);
          expect(rect.top + rect.height).toBeLessThanOrEqual(stage.height);
        }
      }
    }
    expect(backgroundImageRect({ width: 64, height: 114 }, { width: 160, height: 90 })).toEqual({ left: 0, top: 39, width: 64, height: 36 });
  });
  const drawings = WALK_PHASES.flatMap((phase) => [
    { phase },
    ...[1, 2, 3, 4, 5].map((step) => ({ phase, inbetween: true, position: step / 6 })),
  ]);

  it("plays all 48 drawings in four seconds: 12 drawings/s, five output frames each, five cycles in 20 s", () => {
    for (const sourceRate of [4, 8, 12, 24] as const) {
      const sheet = exposureSheet(drawings, sourceRate, 4);
      expect(sheet.drawings).toEqual(drawings);
      expect(sheet.holds.reduce((sum, hold) => sum + hold, 0)).toBeCloseTo(96);
      for (let frame = 0; frame < 1200; frame++) {
        expect(drawingAtOutputFrame(frame, sheet.holds)).toEqual({ tick: Math.floor(frame / 5), index: Math.floor((frame % 240) / 5) });
      }
      expect(outputFrameAtTick(48, sheet.holds)).toBe(240);
      expect(outputFrameAtTick(240, sheet.holds)).toBe(1200);
    }
  });

  it("keeps every generated pose when only the cycle duration changes", () => {
    for (const seconds of [1, 2, 4]) {
      const sheet = exposureSheet(drawings, 12, seconds);
      const shown = new Set(Array.from({ length: seconds * 60 }, (_, frame) => drawingAtOutputFrame(frame, sheet.holds).index));
      expect(shown.size).toBe(48);
      expect(sheet.holds.reduce((sum, hold) => sum + hold, 0) / 24).toBeCloseTo(seconds);
    }
  });

  it("fades the previous pose from 12% to zero in two output frames, without stretching the cycle", () => {
    const { holds } = exposureSheet(drawings, 4, 4);
    expect(poseSmoothingAt(0, holds, 0.12)).toMatchObject({ index: 0, previousIndex: 47, previousWeight: 0.12 });
    expect(poseSmoothingAt(1, holds, 0.12).previousWeight).toBe(0.06);
    for (const frame of [2, 3, 4]) expect(poseSmoothingAt(frame, holds, 0.12).previousWeight).toBe(0);
    expect(poseSmoothingAt(240, holds, 0.12)).toMatchObject({ tick: 48, index: 0, previousWeight: 0.12 });
    expect(poseSmoothingAt(5, holds, 1).previousWeight).toBe(0.2);
    expect(poseSmoothingAt(5, holds, -1).previousWeight).toBe(0);
    expect(poseSmoothingAt(5, holds).previousWeight).toBe(0);
  });

  it("keeps travel and background zoom synchronized with the retimed cycle", () => {
    const settings = { drawingFps: 12 as const, cycleSeconds: 4, durationSeconds: 20 };
    expect(playbackClock(240, settings, 8)).toBe(8);
    expect(playbackClock(1200, settings, 8)).toBe(40);
    expect(backgroundZoomAt(playbackClock(1200, settings, 8), settings, 8)).toBe(1);
    expect(backgroundZoomAt(playbackClock(600, settings, 8), settings, 8)).toBeCloseTo(1 + ZOOM_DEPTH);
  });
});

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

  it("reuses the same intermediate drawing at equivalent fractions of a slow dance", () => {
    expect(inbetweenAt("f0", 1, 6)).toBe("i0-1of6");
    expect(inbetweenAt("f0", 2, 6)).toBe("i0-1of3");
    expect(inbetweenAt("f0", 3, 6)).toBe("i0");
    expect(inbetweenAt("f0", 4, 6)).toBe("i0-2of3");
    expect(inbetweenAt("f0", 5, 6)).toBe("i0-5of6");
    for (const divisions of [2, 3, 4, 6, 8]) {
      for (let step = 1; step < divisions; step++) expect(DrawingIdSchema.safeParse(inbetweenAt("f7", step, divisions)).success).toBe(true);
    }
  });

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
    for (const duration of [2, 4, 6, 20] as const) {
      expect(exposureFrameCount(duration)).toBe(duration * 24);
      expect(outputFrameCount(duration)).toBe(duration * 60);
      for (const fps of [4, 8, 12] as const) {
        expect(tickCount(duration, fps) % 8).toBe(0);
        for (const action of ANIMATION_ACTIONS) {
          const holds = exposures(phases(action), fps);
          expect(holds.reduce((sum, hold) => sum + hold, 0)).toBe(8 * holdFrames(fps));
          // The last output frame shows the last drawing of a cycle: the loop restarts cleanly on frame 1.
          expect(drawingAtOutputFrame(outputFrameCount(duration) - 1, holds).index).toBe(7);
        }
      }
    }
  });

  it.each([4, 8, 12] as const)("fills every exposure slot at %i key poses/s without changing the cycle length", (fps) => {
    for (const action of ANIMATION_ACTIONS) {
      const keys = phases(action);
      const holds = exposures(keys, fps);
      const dense = keys.flatMap((phase, index) => [
        { phase, inbetween: false, position: 0 },
        ...Array.from({ length: holds[index] - 1 }, (_, offset) => ({ phase, inbetween: true, position: (offset + 1) / holds[index] })),
      ]);
      const sheet = exposureSheet(dense, fps);
      const duration = holds.reduce((sum, hold) => sum + hold, 0);
      expect(sheet.drawings).toHaveLength(duration);
      expect(sheet.holds).toEqual(Array(duration).fill(1));
      expect(outputFrameAtTick(duration, sheet.holds)).toBe(outputFrameAtTick(keys.length, holds));
    }
  });

  it("selects one pose per time slot when saved densities overlap", () => {
    const sheet = exposureSheet([
      { phase: "left_contact", inbetween: false, position: 0 },
      { phase: "left_contact", inbetween: true, position: 1 / 3 },
      { phase: "left_contact", inbetween: true, position: 0.5 },
      { phase: "left_contact", inbetween: true, position: 2 / 3 },
    ], 8);
    expect(sheet.drawings.map((drawing) => drawing.position)).toEqual([0, 1 / 3, 2 / 3]);
    expect(sheet.holds).toEqual([1, 1, 1]);
  });

  it("maps the 60 fps clock onto the 24 fps exposure sheet without blending", () => {
    const walk = exposures(phases("walk"), 8);
    // Every drawing holds for three exposure frames, so at 60 fps it holds for
    // seven or eight frames (7.5 on average): the same 125 ms, no in-betweens.
    expect(exposureFrameCount(1)).toBe(24);
    expect(outputFrameCount(1)).toBe(60);
    expect([0, 7, 8, 14, 15, 59].map((frame) => drawingAtOutputFrame(frame, walk).index)).toEqual([0, 0, 1, 1, 2, 7]);
    expect(outputFrameAtTick(1, walk)).toBe(8);
    expect(outputFrameAtTick(8, walk)).toBe(60);
    // The camera clock advances on every 60 fps frame.
    expect(outputClock(0, 8)).toBe(0);
    expect(outputClock(1, 8)).toBeCloseTo(8 / 60, 6);
    expect(outputClock(60, 8)).toBe(8);
    expect(tickClock(1, walk, 8)).toBeCloseTo(1, 6);
    expect(tickClock(8, walk, 8)).toBeCloseTo(8, 6);
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
    expect(DrawingIdSchema.safeParse("i7-2of3").success).toBe(true);
    expect(DrawingIdSchema.safeParse("i0-3of4").success).toBe(true);
    for (const invalid of ["i8-1of3", "i0-4of4", "i0-1of60", "i0/../../secret"]) expect(DrawingIdSchema.safeParse(invalid).success).toBe(false);
    expect(DrawingIdSchema.safeParse("f47").success).toBe(true);
    expect(DrawingIdSchema.safeParse("g1").success).toBe(false);
  });

  it("holds every drawing for three frames, so a scene lasts exactly as long as its drawings", () => {
    for (const seconds of [1, 3, 6]) {
      const phases = Array.from({ length: ensembleDrawings(seconds) }, (_, index) => beatPhase(index));
      const holds = exposures(phases, 8);
      expect(new Set(holds)).toEqual(new Set([3]));
      expect(holds.reduce((sum, hold) => sum + hold, 0)).toBe(exposureFrameCount(seconds));
      expect(drawingAtOutputFrame(outputFrameCount(seconds) - 1, holds)).toEqual({ tick: phases.length - 1, index: phases.length - 1 });
      expect(frameAtTick(phases.length - 1, holds)).toBe(exposureFrameCount(seconds) - 3);
    }
    expect(ACTION_SPECS.ensemble).toMatchObject({ travels: false, drawingFps: 8, subtle: true, stride: null });
  });

  it("opens animations saved before scenes existed, without a cast", () => {
    const parsed = FlipbookSchema.shape.cast.parse(undefined);
    expect(parsed).toEqual([]);
  });
});
