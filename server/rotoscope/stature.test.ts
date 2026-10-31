import { describe, expect, it } from "vitest";
import type { Rgba } from "./alpha";
import { proportions } from "./grid";
import type { Pose } from "./pose-match";
import { bodyChain, heightRatio, measuredHairTop, personFigure, personMarks, solesOf } from "./stature";

function pose(points: Record<number, [number, number]>): Pose {
  const keypoints = Array.from({ length: 133 }, (_, i) => (points[i] ? points[i] : [null, null]) as [number | null, number | null]);
  return { keypoints, scores: keypoints.map(([x]) => (x === null ? 0 : 1)) };
}

// A person standing: nose at 100, shoulders 140, hips 300, knees 400, ankles 500, heels 510, toes 520.
const PERSON = pose({ 0: [200, 100], 5: [230, 140], 6: [170, 140], 11: [220, 300], 12: [180, 300], 13: [220, 400], 14: [180, 400], 15: [220, 500], 16: [180, 500], 19: [222, 510], 22: [178, 510], 17: [225, 520], 20: [175, 520] });
// The character sheet at twice the size, with a bigger head (hair from 0) and longer feet.
const SHEET = pose({ 0: [400, 200], 5: [460, 280], 6: [340, 280], 11: [440, 600], 12: [360, 600], 13: [440, 800], 14: [360, 800], 15: [440, 1000], 16: [360, 1000] });

/** A grey backdrop with a dark figure from `top` down to 530 around x = 200. */
function frame(top: number): Rgba {
  const [width, height] = [400, 600];
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = y >= top && y <= 530 && Math.abs(x - 200) <= (y < 140 ? 30 : 40);
      data.set(inside ? [40, 40, 60, 255] : [200, 200, 200, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe("stature", () => {
  it("puts the soles on the lowest foot point DWPose sees", () => {
    expect(solesOf(PERSON)).toBe(520);
    expect(solesOf(SHEET)).toBeNull();
  });

  it("measures the body from nose to ankles with every bone at its longest", () => {
    // Nose to shoulders 40, torso 160, thigh 100, shin 100.
    expect(bodyChain([PERSON])).toBe(400);
  });

  it("finds the person's hair top on a plain backdrop and refuses one it can't trust", () => {
    expect(measuredHairTop(frame(60), PERSON)).toBe(60);
    // The figure runs into the top edge: the backdrop isn't separable there.
    expect(measuredHairTop(frame(0), PERSON)).toBeNull();
    // On a 160 px torso, a "hair top" 5 px above the nose is not a head.
    expect(measuredHairTop(frame(95), PERSON)).toBeNull();
  });

  it("spans the character over the person's own hair top and soles", () => {
    const sheet = proportions(SHEET, { top: 0, bottom: 1060 });
    const figure = personFigure({ samples: [60, 60, 62].map((top) => ({ frame: frame(top), pose: PERSON })), poses: [PERSON], reference: SHEET, sheet });
    expect(figure).toMatchObject({ headAboveNose: 40, solesBelowAnkles: 20, method: "silhouette", seen: 3, of: 3 });
    expect(personMarks(PERSON, figure)).toEqual({ head: 60, feet: 520, center: 200 });
    // A character 10 % taller than the person stands on the same soles.
    expect(personMarks(PERSON, figure, 1.1)?.head).toBeCloseTo(14);
  });

  it("scales the sheet's head by the body when no silhouette shows the hair", () => {
    const sheet = proportions(SHEET, { top: 0, bottom: 1060 });
    const figure = personFigure({ samples: [{ frame: frame(0), pose: PERSON }], poses: [PERSON], reference: SHEET, sheet });
    // The sheet's body (nose to ankles) is twice the person's: its 200 px of head above the nose become 100.
    expect(figure).toMatchObject({ headAboveNose: 100, method: "body", seen: 0 });
  });

  it("draws the character as tall as the person unless both heights are known", () => {
    expect(heightRatio(null)).toBe(1);
    expect(heightRatio({ heightCm: 160, personHeightCm: null })).toBe(1);
    expect(heightRatio({ heightCm: 160, personHeightCm: 170 })).toBeCloseTo(0.941, 3);
  });
});
