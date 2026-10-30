import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WALK_PHASES } from "../../shared/flipbook";
import { walkerPng } from "./__fixtures__/walker";
import { CELL_HEIGHT, segmentation, type Measure } from "./frame-alignment";
import { computeGuidedAlignment, guideTrack, motionWarnings, smoothTrack, type GuideTrack } from "./motion-registration";

// Registration on the movement guide, on deterministic tracks and drawings.
// SAM is switched off: the guide is always cut out by its flat background.

segmentation.segment = null;

const body = (x: number, foot = 1400, height = 1200) => ({ x, foot, height });

function measure(crop: Measure["crop"], topY: number, footY: number, torsoX: number): Measure {
  return { rawWidth: 1024, rawHeight: 1536, crop, topY, footY, torsoX, lowerSpan: 100, coverage: 0.2, touchesEdge: false, histogram: Array.from({ length: 64 }, (_, index) => index === 0 ? 1 : 0), method: "key", multiple: false, backgroundUniformity: 1 };
}

/** A 96×96 sprite (the silhouette grid, so nothing is resampled) with one opaque box. */
async function box(left: number, top: number, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width, height, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }, left, top }])
    .png()
    .toBuffer();
}

describe("smoothTrack", () => {
  const ramp = Array.from({ length: 10 }, (_, tick) => body(100 + tick * 10));

  it("keeps steady travel", () => {
    const smoothed = smoothTrack(ramp);
    expect(smoothed).toHaveLength(10);
    // A straight line goes through the median and the blur unchanged, ends included.
    for (let tick = 0; tick < 10; tick++) expect(smoothed[tick].x).toBeCloseTo(100 + tick * 10, 6);
  });

  it("fills gaps from the neighbors", () => {
    const gapped = ramp.map((entry, tick) => tick === 4 || tick === 5 ? null : entry);
    expect(smoothTrack(gapped)).toEqual(smoothTrack(ramp));
    const leading = smoothTrack([null, null, body(300), body(300), body(300)]);
    expect(leading.every((entry) => entry.x === 300)).toBe(true);
  });

  it("removes a single-tick spike", () => {
    const spiked = ramp.map((entry, tick) => tick === 5 ? body(900, 1400, 1500) : entry);
    const smoothed = smoothTrack(spiked);
    // The median of what's left sits within one tick's travel of the line.
    expect(Math.abs(smoothed[5].x - 150)).toBeLessThanOrEqual(10);
    expect(smoothed[5].height).toBeCloseTo(1200, 6);
  });

  it("keeps the bobbing of a walk", () => {
    const bobbing = Array.from({ length: 24 }, (_, tick) => body(500, 1400 + 20 * Math.sin((tick / 8) * 2 * Math.PI)));
    const feet = smoothTrack(bobbing).slice(4, 20).map((entry) => entry.foot);
    expect(Math.max(...feet) - Math.min(...feet)).toBeGreaterThan(20);
  });

  it("has nothing to smooth without a single body", () => {
    expect(smoothTrack([null, null])).toEqual([]);
  });
});

describe("computeGuidedAlignment", () => {
  // k = CELL_HEIGHT / 1536 = 0.5.
  const track: GuideTrack = { width: 1024, height: 1536, measured: [], smoothed: [body(400, 1400, 1200), body(420, 1390, 1180), body(440, 1380, 1160)], measures: [] };
  const k = CELL_HEIGHT / track.height;
  // The same body drawn at two sizes and places, as separate generations do.
  const small = measure({ left: 300, top: 400, width: 300, height: 700 }, 10, 690, 150);
  const large = measure({ left: 50, top: 100, width: 500, height: 1300 }, 0, 1290, 260);

  const placed = (transform: { scale: number; left: number; top: number }, drawn: Measure) => ({
    height: (drawn.footY - drawn.topY + 1) * transform.scale,
    torso: transform.left + drawn.torsoX * transform.scale,
    foot: transform.top + (drawn.footY + 1) * transform.scale,
  });

  it("puts every drawing's torso, feet and height on the guide at its tick", () => {
    const alignment = computeGuidedAlignment([
      { frameId: "frame_1", version: "a", phase: "sample_0000", relativeRootY: 0, measure: small, tick: 0 },
      { frameId: "frame_2", version: "b", phase: "sample_0001", relativeRootY: 0, measure: large, tick: 1 },
    ], track);
    expect(alignment.cellHeight).toBe(CELL_HEIGHT);
    expect(alignment.cellWidth).toBe(512);
    for (const [frameId, drawn, guide] of [["frame_1", small, track.smoothed[0]], ["frame_2", large, track.smoothed[1]]] as const) {
      const at = placed(alignment.transforms[frameId]!, drawn);
      expect(at.height).toBeCloseTo(guide.height * k, 3);
      expect(Math.abs(at.torso - guide.x * k)).toBeLessThanOrEqual(1);
      expect(Math.abs(at.foot - (guide.foot + 1) * k)).toBeLessThanOrEqual(1);
    }
  });

  it("rounds an in-between's tick and keeps ticks past the end on the last body", () => {
    const alignment = computeGuidedAlignment([
      { frameId: "between_1", version: "a", phase: "inbetween", relativeRootY: 0, measure: small, tick: 1.4 },
      { frameId: "frame_9", version: "a", phase: "sample_0009", relativeRootY: 0, measure: small, tick: 9 },
    ], track);
    expect(Math.abs(placed(alignment.transforms.between_1!, small).torso - track.smoothed[1].x * k)).toBeLessThanOrEqual(1);
    expect(Math.abs(placed(alignment.transforms.frame_9!, small).torso - track.smoothed[2].x * k)).toBeLessThanOrEqual(1);
  });

  it("gives a new version a new sprite key", () => {
    const entry = { frameId: "frame_1" as const, phase: "sample_0000", relativeRootY: 0, measure: small, tick: 0 };
    const a = computeGuidedAlignment([{ ...entry, version: "a" }], track).transforms.frame_1!;
    const b = computeGuidedAlignment([{ ...entry, version: "b" }], track).transforms.frame_1!;
    expect(a.key).not.toBe(b.key);
    expect({ ...a, key: "", version: "" }).toEqual({ ...b, key: "", version: "" });
  });
});

describe("motionWarnings", () => {
  // A body that steps 2px right every tick.
  const guides = () => Promise.all(Array.from({ length: 8 }, (_, tick) => box(20 + tick * 2, 20, 24, 56)));
  const codes = (warnings: Map<string, { code: string }[]>, frameId: string) => (warnings.get(frameId) ?? []).map((warning) => warning.code).sort();

  it("passes drawings that follow the guide", async () => {
    const guide = await guides();
    const warnings = await motionWarnings(guide.map((sprite, tick) => ({ frameId: `frame_${tick}`, sprite, guide: sprite })));
    expect(warnings.size).toBe(0);
  });

  it("flags a drawing in another pose, and not the one after it", async () => {
    const guide = await guides();
    const lying = await box(10, 60, 70, 20);
    const warnings = await motionWarnings(guide.map((sprite, tick) => ({ frameId: `frame_${tick}`, sprite: tick === 4 ? lying : sprite, guide: sprite })));
    expect(codes(warnings, "frame_4")).toEqual(["motion_jump", "pose_mismatch"]);
    expect([...warnings.keys()]).toEqual(["frame_4"]);
  });

  it("flags two bad drawings in a row", async () => {
    const guide = await guides();
    const lying = await box(10, 60, 70, 20), crouched = await box(30, 50, 40, 26);
    const warnings = await motionWarnings(guide.map((sprite, tick) => ({ frameId: `frame_${tick}`, sprite: tick === 3 ? lying : tick === 4 ? crouched : sprite, guide: sprite })));
    expect([...warnings.keys()].sort()).toEqual(["frame_3", "frame_4"]);
    expect(codes(warnings, "frame_3")).toContain("motion_jump");
    expect(codes(warnings, "frame_4")).toContain("motion_jump");
  });

  it("flags a jump that still roughly overlaps the guide as a jump only", async () => {
    const still = await box(28, 20, 40, 56), shifted = await box(37, 20, 40, 56);
    const warnings = await motionWarnings(Array.from({ length: 8 }, (_, tick) => ({ frameId: `frame_${tick}`, sprite: tick === 4 ? shifted : still, guide: still })));
    expect([...warnings.keys()]).toEqual(["frame_4"]);
    expect(codes(warnings, "frame_4")).toEqual(["motion_jump"]);
  });

  it("measures pose against the clip's own median", async () => {
    // Every drawing overlaps its guide loosely, as with a rough engine render: none stands out.
    const guide = await guides();
    const offset = await Promise.all(Array.from({ length: 8 }, (_, tick) => box(32 + tick * 2, 20, 24, 56)));
    const warnings = await motionWarnings(guide.map((sprite, tick) => ({ frameId: `frame_${tick}`, sprite: offset[tick], guide: sprite })));
    expect(warnings.size).toBe(0);
  });

  it("needs three drawings with a guide", async () => {
    const guide = await guides();
    const lying = await box(10, 60, 70, 20);
    const warnings = await motionWarnings([
      { frameId: "frame_0", sprite: guide[0], guide: guide[0] },
      { frameId: "frame_1", sprite: lying, guide: guide[1] },
      { frameId: "frame_2", sprite: guide[2], guide: null },
    ]);
    expect(warnings.size).toBe(0);
  });
});

describe("guideTrack", () => {
  let root: string;
  // The guide walks right on a flat background, 30px a tick.
  const ticks = 6;

  async function samples(dir: string, count: number) {
    await mkdir(path.join(dir, "samples"), { recursive: true });
    for (let tick = 0; tick < count; tick++) {
      const png = await walkerPng(WALK_PHASES[tick % WALK_PHASES.length], { offsetX: -100 + tick * 30, background: "#ffffff" });
      await writeFile(path.join(dir, "samples", `frame_${String(tick).padStart(4, "0")}.png`), png);
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "focus-guide-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("measures the guide's body at every tick and keeps it", async () => {
    const dir = path.join(root, "walk");
    await samples(dir, ticks);
    const track = await guideTrack(dir, ticks, "flipbook_test");
    expect(track).not.toBeNull();
    expect(track!.width).toBe(1024);
    expect(track!.height).toBe(1536);
    expect(track!.measured.every(Boolean)).toBe(true);
    expect(track!.smoothed).toHaveLength(ticks);
    // Feet on the drawn ground line, torso following the walk.
    for (const entry of track!.measured) expect(Math.abs(entry!.foot - 1416)).toBeLessThanOrEqual(30);
    const xs = track!.measured.map((entry) => entry!.x);
    expect(xs[ticks - 1] - xs[0]).toBeGreaterThan(100);
    for (let tick = 0; tick < ticks; tick++) expect(await stat(path.join(dir, "guide", `${String(tick).padStart(4, "0")}.png`))).toBeTruthy();

    await rm(path.join(dir, "samples"), { recursive: true });
    expect(await guideTrack(dir, ticks, "flipbook_test")).toEqual(track);
  });

  it("isn't trusted when samples are missing", async () => {
    const dir = path.join(root, "short");
    await samples(dir, ticks - 2);
    expect(await guideTrack(dir, ticks, "flipbook_test")).toBeNull();
    // The refusal is kept too: a guide that can't be measured isn't cut out again on every finalize.
    expect(await guideTrack(dir, ticks, "flipbook_test")).toBeNull();
  });
});
