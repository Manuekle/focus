import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkScale, figureBox, GRID, proportions, targets, toLine, withGrid } from "./grid";
import type { Pose } from "./pose-match";

function pose(points: Record<number, [number, number]>): Pose {
  const keypoints = Array.from({ length: 133 }, (_, i) => (points[i] ? points[i] : [null, null]) as [number | null, number | null]);
  return { keypoints, scores: keypoints.map(([x]) => (x === null ? 0 : 1)) };
}
// Nose at 100, hips at 300, ankles at 500.
const STANDING = pose({ 0: [200, 100], 11: [190, 300], 12: [210, 300], 15: [190, 500], 16: [210, 500] });

describe("grid", () => {
  it("counts lines from the top in cells", () => {
    expect(GRID.columns * GRID.cell).toBe(1024);
    expect(GRID.rows * GRID.cell).toBe(1536);
    expect(toLine(1356.8)).toBe(10.6);
  });

  it("draws the grid without changing the image size", async () => {
    const base = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const gridded = await withGrid(base, { head: 260, feet: 1350, center: 512 });
    expect(await sharp(gridded).metadata()).toMatchObject({ width: 1024, height: 1536 });
    const { data, info } = await sharp(gridded).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(pixel(300, 1350)[1]).toBeGreaterThan(pixel(300, 1350)[0]);
    expect(pixel(128, 700)[0]).toBeLessThan(200);
  });

  it("measures the character sheet's figure", async () => {
    const sheet = await sharp({ create: { width: 100, height: 200, channels: 3, background: "#ffffff" } })
      .composite([{ input: { create: { width: 20, height: 150, channels: 3, background: "#202020" } }, left: 40, top: 30 }]).png().toBuffer();
    expect(await figureBox(sheet)).toEqual({ top: 30, bottom: 179 });
  });

  it("places hair and sole lines from the sheet's proportions, at the drawn size", () => {
    const sheet = proportions(STANDING, { top: 40, bottom: 540 });
    expect(sheet).toEqual({ headAboveNose: 60, solesBelowAnkles: 40, headHeight: 80, figureHeight: 500 });
    expect(targets(STANDING, 2, sheet, { scale: 1, x: 10, y: 0 })).toEqual({ head: -20, feet: 580, center: 210 });
  });
});

describe("checkScale", () => {
  const target = { head: 200, feet: 1200, center: 500 };

  it("passes a drawing on its lines", () => {
    expect(checkScale({ head: 230, feet: 1180, center: 520 }, target).passed).toBe(true);
  });

  it("fails a character drawn too small and says which lines to reach", () => {
    const check = checkScale({ head: 330, feet: 1200, center: 500 }, target);
    expect(check.passed).toBe(false);
    expect(check.feedback).toBe("The top of the hair must touch grid line 1.6 (it is at 2.6).");
  });

  it("fails a character standing too high", () => {
    expect(checkScale({ head: 120, feet: 1100, center: 500 }, target).feedback).toMatch(/soles must stand on grid line 9.4 \(they are at 8.6\)/);
  });

  it("fails an off-centre character and a drawing without a body", () => {
    expect(checkScale({ head: 200, feet: 1200, center: 650 }, target).feedback).toMatch(/move left/);
    expect(checkScale(null, target).passed).toBe(false);
  });
});
