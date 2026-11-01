import { describe, expect, it } from "vitest";
import { coveredShare, overlaySampleFrames, parseOverlayOutput } from "./overlays";

const media = { width: 720, height: 1280 };

describe("overlay locator", () => {
  it("turns 0–1000 boxes into clamped source pixels on sampled frames only", () => {
    const text = JSON.stringify({
      frames: [
        { frame: 39, regions: [{ label: "KORYUGI NEWS", box: [440, 82, 692, 99] }, { label: "flipped", box: [600, 100, 500, 50] }, { label: "outside", box: [-50, 990, 1200, 1100] }] },
        { frame: 7, regions: [{ label: "not sampled", box: [0, 0, 500, 500] }] },
      ],
    });
    expect(parseOverlayOutput(text, [39], media)).toEqual([
      { frameIndex: 39, box: { left: 317, top: 105, right: 498, bottom: 127 }, label: "KORYUGI NEWS" },
      { frameIndex: 39, box: { left: 360, top: 64, right: 432, bottom: 128 }, label: "flipped" },
      { frameIndex: 39, box: { left: 0, top: 1267, right: 720, bottom: 1280 }, label: "outside" },
    ]);
  });

  it("drops degenerate boxes and rejects unreadable output", () => {
    expect(parseOverlayOutput(JSON.stringify({ frames: [{ frame: 0, regions: [{ label: "dot", box: [10, 10, 11, 11] }] }] }), [0], media)).toEqual([]);
    expect(() => parseOverlayOutput("nope", [0], media)).toThrow();
    expect(() => parseOverlayOutput(JSON.stringify({ frames: [{ frame: 0, regions: [{ label: "x", box: [1, 2] }] }] }), [0], media)).toThrow();
  });

  it("measures how much of a box is already covered", () => {
    const box = { left: 0, top: 0, right: 100, bottom: 10 };
    expect(coveredShare(box, [])).toBe(0);
    expect(coveredShare(box, [{ left: 0, top: 0, right: 50, bottom: 10 }])).toBe(0.5);
    expect(coveredShare(box, [{ left: -10, top: -10, right: 200, bottom: 50 }])).toBe(1);
  });

  it("samples frames across the clip, without duplicates on tiny clips", () => {
    expect(overlaySampleFrames(394)).toEqual([39, 197, 354]);
    expect(overlaySampleFrames(1)).toEqual([0]);
  });
});
