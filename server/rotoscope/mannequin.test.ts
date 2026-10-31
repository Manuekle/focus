import { describe, expect, it } from "vitest";
import { renderFigure, standing } from "../mapping/__fixtures__/figure";
import { fromAlpha } from "../mapping/mask";
import { buildRig } from "../mapping/rig";
import { mannequin, sheetBuild } from "./mannequin";

// The mannequin's body comes from the character's sheet where the sheet shows it: a figure's legs and
// hips measured on its rig, and drawn with them instead of the generic dummy.

const skeleton = standing();
const figure = renderFigure(skeleton);
const rig = buildRig(figure, fromAlpha(figure), skeleton);

describe("sheetBuild", () => {
  it("measures the figure's thighs and shins near their drawn half-widths", () => {
    const build = sheetBuild(rig);
    expect(build.widths.leftThigh).toBeDefined();
    // The fixture draws thighs and shins with RADIUS × torso, plus a thin outline.
    expect(build.widths.leftThigh!).toBeCloseTo(0.16, 1);
    expect(build.widths.leftShin!).toBeCloseTo(0.12, 1);
    expect(build.widths.leftThigh).toBe(build.widths.rightThigh);
  });

  it("leaves the arms and the bust generic (a single sheet often hides them), and finds no hips beyond the thighs on a straight figure", () => {
    const build = sheetBuild(rig);
    expect(Object.keys(build.widths).sort()).toEqual(["leftShin", "leftThigh", "rightShin", "rightThigh"]);
    expect(build.torsoMargin).toBeNull();
  });

  it("draws the mannequin with the measured legs: wider thighs make more thigh pixels", () => {
    const count = (image: ReturnType<typeof mannequin>["shaded"]) => {
      let n = 0;
      for (let p = 0; p < image.width * image.height; p++) if (image.data[p * 4] < 255 || image.data[p * 4 + 1] < 255 || image.data[p * 4 + 2] < 255) n++;
      return n;
    };
    const generic = mannequin(skeleton, { width: 1024, height: 1536 }).shaded;
    const wide = mannequin(skeleton, { width: 1024, height: 1536 }, { widths: { leftThigh: 0.3, rightThigh: 0.3 }, torsoMargin: 0.16 }).shaded;
    expect(count(wide)).toBeGreaterThan(count(generic) * 1.05);
  });
});
