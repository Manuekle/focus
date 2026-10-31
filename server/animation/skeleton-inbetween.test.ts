import { describe, expect, it } from "vitest";
import { emptyMask } from "../mapping/mask";
import type { Vec } from "../mapping/geometry";
import type { JointName } from "../mapping/skeleton";
import { holesWithin, limbBand, sliversWithin } from "./skeleton-inbetween";

// One straight leg, hip to ankle, on a small canvas: what a deformed in-between's checks look at.
const joints: Partial<Record<JointName, Vec>> = { leftHip: [20, 10], leftKnee: [20, 40], leftAnkle: [20, 70], pelvis: [30, 5] };
const joint = (name: JointName) => joints[name] ?? null;

function leg(hole?: { y: number; size: number }) {
  const mask = emptyMask(60, 80);
  for (let y = 8; y <= 72; y++) for (let x = 14; x <= 26; x++) mask.data[y * 60 + x] = 1;
  // Long hair beside the leg, with gaps between its strands: never counted.
  for (let y = 10; y <= 40; y++) for (let x = 40; x <= 50; x++) mask.data[y * 60 + x] = x % 3 === 0 && y > 12 && y < 38 ? 0 : 1;
  if (hole) for (let y = hole.y; y < hole.y + hole.size; y++) for (let x = 18; x < 18 + hole.size; x++) mask.data[y * 60 + x] = 0;
  return mask;
}

describe("a torn skeleton in-between", () => {
  it("counts see-through holes along the arms and legs only", () => {
    const band = limbBand(60, 80, joint, () => 6);
    expect(band.data[40 * 60 + 20]).toBe(1);
    expect(band.data[20 * 60 + 45]).toBe(0);
    expect(holesWithin(leg(), band)).toBe(0);
    expect(holesWithin(leg({ y: 38, size: 4 }), band)).toBe(16);
  });

  it("ignores a gap that opens to the outside of the figure", () => {
    const mask = leg();
    for (let x = 0; x < 20; x++) mask.data[50 * 60 + x] = 0;
    expect(holesWithin(mask, limbBand(60, 80, joint, () => 6))).toBe(0);
  });
});

describe("a shattered skeleton in-between", () => {
  it("counts the thin shards and notches along the limbs", () => {
    const band = limbBand(60, 80, joint, () => 6);
    const clean = leg();
    expect(sliversWithin(clean, band, 2)).toBeLessThan(0.45);
    const shattered = leg();
    // A notch cut into the knee and a loose shard of skin beside it.
    for (let y = 36; y <= 44; y++) for (let x = 14; x <= 22; x++) if ((y + x) % 2) shattered.data[y * 60 + x] = 0;
    expect(sliversWithin(shattered, band, 2)).toBeGreaterThan(sliversWithin(clean, band, 2));
  });
});
