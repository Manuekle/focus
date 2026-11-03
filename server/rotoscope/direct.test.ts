import { describe, expect, it } from "vitest";
import { onPerson } from "./direct";
import type { Pose } from "./pose-match";

const body = (scale: number, x: number, y: number): Pose => {
  const keypoints = Array.from({ length: 17 }, () => [null, null] as [number | null, number | null]);
  const at: Record<number, [number, number]> = { 0: [50, 10], 5: [40, 30], 6: [60, 30], 11: [42, 70], 12: [58, 70], 15: [40, 120], 16: [60, 120] };
  for (const [joint, [px, py]] of Object.entries(at)) keypoints[Number(joint)] = [px * scale + x, py * scale + y];
  return { keypoints, scores: keypoints.map(() => 1) };
};

describe("onPerson", () => {
  it("scales and moves the drawn body onto the video person", () => {
    const move = onPerson(body(2, 100, 50), body(1.5, 300, 200))!;
    expect(move.scale).toBeCloseTo(0.75);
    // The drawn nose (200, 70) lands on the person's (375, 215).
    expect(200 * move.scale + move.x).toBeCloseTo(375);
    expect(70 * move.scale + move.y).toBeCloseTo(215);
  });

  it("gives up with fewer than four joints on both", () => {
    const sparse: Pose = { keypoints: body(1, 0, 0).keypoints.map((point, joint) => (joint < 6 ? point : [null, null])), scores: [] };
    expect(onPerson(sparse, body(1, 0, 0))).toBeNull();
  });
});
