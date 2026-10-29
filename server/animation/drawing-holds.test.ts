import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { overlongDrawingHolds, type TimedDrawing } from "./drawing-holds";
import { checkFrames } from "./quality-control";
import { repairableFrames, type FlipbookFrame } from "../../shared/flipbook";

async function sprite(markX = 20, red = 0, markSize = 8) {
  return sharp(Buffer.from(`<svg width="96" height="96"><rect x="12" y="8" width="72" height="80" fill="rgb(${red},100,180)"/><rect x="${markX}" y="20" width="${markSize}" height="${markSize}" fill="black"/></svg>`)).png().toBuffer();
}
const timeline = (sprites: Buffer[], fps: number): TimedDrawing[] => sprites.map((sprite, index) => ({ frameId: `s${index}`, sprite, atSeconds: index / fps, holdSeconds: 1 / fps }));

describe("125 ms drawing exposure limit", () => {
  it("allows exactly three 24-fps ticks and flags the fourth unchanged drawing", async () => {
    const still = await sprite();
    expect([...await overlongDrawingHolds(timeline(Array(4).fill(still), 24))]).toEqual(["s3"]);
  });
  it("uses elapsed time rather than an unconditional three-drawing count", async () => {
    const still = await sprite();
    for (const fps of [8, 12]) expect([...await overlongDrawingHolds(timeline([still, still], fps))]).toEqual(["s1"]);
    expect([...await overlongDrawingHolds(timeline([still], 8))]).toEqual([]);
    expect([...await overlongDrawingHolds(timeline([still], 4))]).toEqual(["s0"]);
  });
  it("recognizes movement inside an unchanged silhouette instead of flagging a subtle action", async () => {
    const moving = await Promise.all([20, 22, 24, 26].map((x) => sprite(x)));
    expect([...await overlongDrawingHolds(timeline(moving, 8))]).toEqual([]);
  });
  it("accumulates small changes against the start of a hold rather than freezing every gradual movement", async () => {
    const moving = await Promise.all([20, 21, 22, 23, 24, 25].map((x) => sprite(x, 0, 3)));
    expect([...await overlongDrawingHolds(timeline(moving, 24))]).toEqual([]);
  });
  it("does not mistake slight color or compression noise for actual movement", async () => {
    const repeated = await Promise.all([0, 1, 2, 3].map((r) => sprite(20, r)));
    expect([...await overlongDrawingHolds(timeline(repeated, 24))]).toEqual(["s3"]);
  });
  it("does not infer a duplicate across a missing drawing or across a finite clip's ends", async () => {
    const still = await sprite();
    const entries = timeline([still, still], 8);
    entries[1] = { ...entries[1], atSeconds: 0.25 };
    expect([...await overlongDrawingHolds(entries)]).toEqual([]);
    const different = await sprite(40);
    expect([...await overlongDrawingHolds(timeline([still, different, still], 8))]).toEqual([]);
  });
  it("distinguishes a timing correction from a repeated pose that image repair can fix", async () => {
    const still = await sprite();
    const entries = timeline([still, still], 8).map((entry) => ({ ...entry, phase: "sample_0", label: entry.frameId, scale: 1, timing: { atSeconds: entry.atSeconds, holdSeconds: entry.holdSeconds }, measure: { rawWidth: 96, rawHeight: 96, crop: { left: 12, top: 8, width: 72, height: 80 }, topY: 8, footY: 88, torsoX: 48, lowerSpan: 40, coverage: 0.6, touchesEdge: false, histogram: Array(64).fill(1 / 64), method: "sam" as const, multiple: false, backgroundUniformity: 1 } }));
    const repeated = await checkFrames(entries, null, "dance", "front", true);
    expect(repeated.get("s1")!.warnings.map((warning) => warning.code)).toContain("overlong_hold");
    const slow = await checkFrames([{ ...entries[0], timing: { atSeconds: 0, holdSeconds: 0.25 } }], null, "dance", "front", true);
    expect(slow.get("s0")!.warnings.map((warning) => warning.code)).toContain("exposure_too_long");
    const base: FlipbookFrame = { id: "s0", poseIndex: 0, phase: "sample_0", label: "Pose", status: "ready", approved: false, version: "v-0123456789ab", originalVersion: "v-0123456789ab", versions: [], metrics: null, warnings: slow.get("s0")!.warnings, review: null, error: null };
    expect(repairableFrames({ frames: [base, { ...base, id: "s1", warnings: repeated.get("s1")!.warnings }] }).map((frame) => frame.id)).toEqual(["s1"]);
  });
});
