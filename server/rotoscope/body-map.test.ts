import { describe, expect, it } from "vitest";
import { bodySpec, checkProportions, describeFace, fullLengths, onCanvas, sheetLengths } from "./body-map";
import type { Pose } from "./pose-match";

/** A standing figure facing the camera, canvas pixels: shoulders at y 400, hips 700, knees 950, ankles 1200. */
function standing(stretch = 1): Pose {
  const keypoints: [number | null, number | null][] = Array.from({ length: 133 }, () => [null, null]);
  const set = (i: number, x: number, y: number) => { keypoints[i] = [x, y]; };
  set(0, 512, 300);
  set(6, 432, 400); set(5, 592, 400); // subject's right shoulder on the viewer's left
  set(8, 412, 400 + 180 * stretch); set(10, 402, 400 + 360 * stretch);
  set(7, 612, 400 + 180 * stretch); set(9, 622, 400 + 360 * stretch);
  set(12, 462, 700); set(11, 562, 700);
  set(14, 462, 950); set(16, 462, 1200);
  set(13, 562, 950); set(15, 562, 1200);
  set(31, 512, 340); // chin
  return { keypoints, scores: keypoints.map(([x]) => (x === null ? 0 : 1)) };
}
const marks = { head: 200, feet: 1240, center: 512 };

describe("bodySpec", () => {
  it("states every joint in grid cells and names sides as the viewer sees them", () => {
    const spec = bodySpec(standing(), marks, 140)!;
    expect(spec.text).toContain("The arm on the LEFT of the image (red in Image 2): shoulder (3.38, 3.13)");
    expect(spec.text).toContain("upper arm 1.41 cells");
    expect(spec.text).toContain("7.4 heads tall");
    expect(spec.bones.filter((bone) => bone.clear)).toHaveLength(8);
  });

  it("calls a bone foreshortened only against its own full length in the clip", () => {
    const full = fullLengths([standing(), standing(2)]);
    const spec = bodySpec(standing(), marks, 140, full)!;
    expect(spec.text).toContain("upper arm 1.41 cells (seen shortened");
    expect(spec.text).toContain("thigh 1.95 cells,");
    expect(bodySpec(standing(), marks, 140, fullLengths([standing()]))!.text).not.toContain("seen shortened");
  });

  it("never takes a limb the clip keeps shortened for its full length", () => {
    // The clip never extends the arms (0.5 of the sheet's length throughout); the sheet does.
    const full = fullLengths([standing(0.5)], sheetLengths(standing(), [standing(0.5)]));
    const spec = bodySpec(standing(0.5), marks, 140, full)!;
    expect(spec.text).toContain("upper arm 0.72 cells (seen shortened: it points toward the viewer; fully extended it would be 1.20 cells)");
    expect(spec.bones.find((bone) => bone.name === "thigh")!.clear).toBe(true);
  });

  it("places source poses on the canvas", () => {
    const moved = onCanvas(standing(), { scale: 0.5, x: 10, y: 20 });
    expect(moved.keypoints[0]).toEqual([266, 170]);
  });
});

describe("checkProportions", () => {
  const spec = bodySpec(standing(), marks, 140)!;

  it("passes a drawing with the guide's lengths", () => {
    expect(checkProportions(spec, standing(), marks, marks).passed).toBe(true);
  });

  it("fails over-long arms and says how long they must be", () => {
    const check = checkProportions(spec, standing(1.35), marks, marks);
    expect(check.passed).toBe(false);
    expect(check.feedback).toMatch(/upper arm on the LEFT of the image is 35 % too long: it must measure 1.41 cells/);
  });

  it("lets a shortened limb come out at the character's full length, never longer", () => {
    const short = bodySpec(standing(0.5), marks, 140, fullLengths([standing(0.5)], sheetLengths(standing(), [standing(0.5)])))!;
    expect(checkProportions(short, standing(0.8), marks, marks).passed).toBe(true);
    const check = checkProportions(short, standing(1.2), marks, marks);
    expect(check.passed).toBe(false);
    expect(check.feedback).toMatch(/upper arm on the LEFT of the image is 41 % longer than the character's own: even fully extended it measures at most 1.20 cells/);
  });

  it("measures against the drawing's own height, whatever size it came out", () => {
    const half = onCanvas(standing(), { scale: 0.5, x: 0, y: 0 });
    expect(checkProportions(spec, half, { head: 100, feet: 620, center: 256 }, marks).passed).toBe(true);
  });
});

describe("describeFace", () => {
  it("is empty without face points", () => {
    expect(describeFace(standing())).toBe("");
  });
});
