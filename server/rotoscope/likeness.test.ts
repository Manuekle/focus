import { describe, expect, it } from "vitest";
import { faceBox } from "./likeness";
import type { Pose } from "./pose-match";

const sheet = (points: Record<number, [number, number]>): Pose => {
  const keypoints = Array.from({ length: 133 }, (_, i) => points[i] ?? [null, null]) as [number | null, number | null][];
  return { keypoints, scores: keypoints.map(() => 1) };
};

describe("faceBox", () => {
  it("frames the head around the nose, 2.4 jaw widths wide, more of it above the nose", () => {
    const box = faceBox(sheet({ 0: [500, 300], 23: [450, 310], 39: [550, 310] }), 1000, 2000)!;
    expect(box).toEqual({ left: 380, top: 156, width: 240, height: 240 });
  });

  it("stays inside the sheet", () => {
    const box = faceBox(sheet({ 0: [40, 30], 23: [0, 40], 39: [100, 40] }), 1000, 2000)!;
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
  });

  it("gives up without the nose or the jaw", () => {
    expect(faceBox(sheet({ 0: [500, 300], 23: [450, 310] }), 1000, 2000)).toBeNull();
  });
});
