import { describe, expect, it } from "vitest";
import { checkAlpha, keyOut, type Rgba } from "./alpha";
import { angleBetween, comparePoses, describeLegs, describePose, direction, type Pose } from "./pose-match";
import { checkStyle, outlineDensity } from "./style";
import { framePrompt, reviewCheck, type FrameInput, type Review } from "./draw";

/** A magenta canvas with filled rectangles of the given colours. */
function canvas(width: number, height: number, rects: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[]): Rgba {
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([255, 0, 255, 255], p * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set([...r.rgb, 255], (y * width + x) * 4);
  return { data, width, height };
}

describe("keyOut and checkAlpha", () => {
  it("keys flat magenta to transparent and passes a clean figure", () => {
    const image = keyOut(canvas(100, 150, [{ x: 30, y: 20, w: 40, h: 110, rgb: [240, 240, 235] }, { x: 40, y: 25, w: 20, h: 20, rgb: [20, 20, 20] }]));
    expect(image.data[3]).toBe(0);
    expect(image.data[((60 * 100) + 50) * 4 + 3]).toBe(255);
    expect(checkAlpha(image)).toMatchObject({ name: "alpha", passed: true });
  });

  it("keeps red and skin tones opaque", () => {
    const image = keyOut(canvas(10, 10, [{ x: 2, y: 2, w: 3, h: 3, rgb: [200, 40, 40] }, { x: 5, y: 5, w: 3, h: 3, rgb: [240, 200, 180] }]));
    expect(image.data[((3 * 10) + 3) * 4 + 3]).toBe(255);
    expect(image.data[((6 * 10) + 6) * 4 + 3]).toBe(255);
  });

  it("drops floating specks far smaller than the body", () => {
    const image = keyOut(canvas(200, 300, [{ x: 50, y: 30, w: 100, h: 240, rgb: [30, 30, 30] }, { x: 5, y: 5, w: 2, h: 2, rgb: [30, 30, 30] }]));
    expect(image.data[((5 * 200) + 5) * 4 + 3]).toBe(0);
  });

  it("fails a figure cut by the frame edge, with feedback", () => {
    const check = checkAlpha(keyOut(canvas(100, 150, [{ x: 30, y: 20, w: 40, h: 130, rgb: [30, 30, 30] }])));
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/touches the canvas edge/);
    expect(check.feedback).toMatch(/inside the frame/);
  });

  it("fails a background that was not flat magenta", () => {
    const check = checkAlpha(keyOut(canvas(100, 150, [{ x: 0, y: 140, w: 100, h: 10, rgb: [120, 120, 120] }, { x: 30, y: 20, w: 40, h: 110, rgb: [30, 30, 30] }])));
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/corners/);
  });

  it("fails magenta painted inside the figure", () => {
    const check = checkAlpha(keyOut(canvas(100, 150, [{ x: 30, y: 20, w: 40, h: 110, rgb: [30, 30, 30] }, { x: 40, y: 50, w: 12, h: 12, rgb: [150, 40, 150] }])));
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/magenta painted inside/);
  });

  it("removes a faint magenta cast from the figure instead of failing it", () => {
    const image = keyOut(canvas(100, 150, [{ x: 30, y: 20, w: 40, h: 110, rgb: [53, 14, 52] }]));
    expect([...image.data.subarray(((60 * 100) + 50) * 4, ((60 * 100) + 50) * 4 + 4)]).toEqual([15, 14, 14, 255]);
    expect(checkAlpha(image).passed).toBe(true);
  });
});

/** A standing pose: shoulders, hips and limbs given as screen points; everything else missing. */
function pose(points: Record<number, [number, number]>): Pose {
  const keypoints = Array.from({ length: 133 }, (_, i) => (points[i] ? points[i] : [null, null]) as [number | null, number | null]);
  return { keypoints, scores: keypoints.map(([x]) => (x === null ? 0 : 1)) };
}
const BASE: Record<number, [number, number]> = {
  5: [120, 100], 6: [80, 100], 11: [115, 200], 12: [85, 200],
  7: [130, 150], 9: [135, 200], 8: [70, 150], 10: [65, 200],
  13: [118, 260], 15: [118, 320], 14: [82, 260], 16: [82, 320],
};

describe("comparePoses", () => {
  it("passes the same pose at another scale and position (proportion-free)", () => {
    const moved = Object.fromEntries(Object.entries(BASE).map(([k, [x, y]]) => [k, [x * 1.4 + 50, y * 1.4 - 20]])) as Record<number, [number, number]>;
    const result = comparePoses(pose(BASE), pose(moved));
    expect(result.passed).toBe(true);
    expect(result.bones).toHaveLength(8);
  });

  it("fails a raised arm the source keeps down and says which way it should point", () => {
    const drawn = pose({ ...BASE, 8: [70, 50], 10: [65, 0] });
    const result = comparePoses(pose(BASE), drawn);
    expect(result.passed).toBe(false);
    expect(result.feedback).toMatch(/^The upper arm on the LEFT of the image must point down/);
  });

  it("recognises a mirrored drawing and says which side each limb belongs on", () => {
    const raised = { ...BASE, 7: [140, 50], 9: [150, 0] } as Record<number, [number, number]>;
    // The same pose seen in a mirror: x flipped around 100, left and right labels swapped.
    const mirror = Object.fromEntries(Object.entries(raised).map(([k, [x, y]]) => {
      const swap: Record<string, string> = { 5: "6", 6: "5", 7: "8", 8: "7", 9: "10", 10: "9", 11: "12", 12: "11", 13: "14", 14: "13", 15: "16", 16: "15" };
      return [swap[k] ?? k, [200 - x, y]];
    })) as Record<number, [number, number]>;
    const result = comparePoses(pose(raised), pose(mirror));
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/^MIRRORED/);
    expect(result.feedback).toMatch(/upper arm on the RIGHT of the image points up/);
  });

  it("skips foreshortened source bones it cannot measure", () => {
    const source = pose({ ...BASE, 8: [78, 108], 10: [100, 150] });
    const drawn = pose({ ...BASE, 8: [60, 100], 10: [100, 150] });
    expect(comparePoses(source, drawn).bones.map((b) => b.name)).not.toContain("right upper arm");
  });

  it("fails a limb the source shows but the drawing lacks", () => {
    const drawn = pose(Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== "9")));
    const result = comparePoses(pose(BASE), drawn);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(["left forearm"]);
  });

  it("fails a drawing without a body", () => {
    expect(comparePoses(pose(BASE), pose({})).passed).toBe(false);
  });

  it("describes the pose by screen side, not by the subject's left and right", () => {
    const raised = pose({ ...BASE, 0: [100, 70], 7: [140, 50], 9: [150, 0] });
    expect(describePose(raised)).toBe("The arm on the LEFT of the image: upper arm points down, forearm points down, hand at waist height. The arm on the RIGHT of the image: upper arm points up, forearm points up, hand above the head. Legs: both legs straight, knees not bent, the feet are a little apart, closer than the shoulders are wide.");
  });

  it("measures knees together and crossed legs instead of leaving them to a glance", () => {
    expect(describeLegs(pose({ ...BASE, 13: [104, 260], 14: [96, 260] }))).toBe("Legs: both legs nearly straight, knees only slightly bent (no crouch), the knees are pulled together, touching, the feet are a little apart, closer than the shoulders are wide.");
    expect(describeLegs(pose({ ...BASE, 13: [95, 260], 14: [105, 260], 15: [90, 320], 16: [110, 320] }))).toBe("Legs: both legs nearly straight, knees only slightly bent (no crouch), the legs cross at the knees, the legs cross, each foot on the other leg's side.");
  });

  it("measures angles and names screen directions", () => {
    expect(angleBetween([1, 0], [0, 1])).toBe(90);
    expect(angleBetween([1, 0.0001], [1, -0.0001])).toBeLessThan(1);
    expect(direction(0, -1)).toBe("up");
    expect(direction(-1, 1)).toBe("down-left");
  });
});

describe("reviewCheck", () => {
  const parts = ["right arm (upper arm and forearm)", "right hand", "left arm (upper arm and forearm)", "left hand", "legs and feet", "head and torso"];
  const review = (same: (part: string) => boolean): Review => ({
    limbs: parts.map((part) => ({ part, source: "a", drawing: same(part) ? "a" : "b", same: same(part) })),
    sameCharacter: true, identityNotes: "", sameStyle: true, anatomyOk: true, anatomyNotes: "", correctionDone: true, correctionNotes: "", fix: "",
  });

  it("passes only when every body part matches", () => {
    expect(reviewCheck(review(() => true)).passed).toBe(true);
    const check = reviewCheck(review((part) => part !== "right hand"));
    expect(check.passed).toBe(false);
    expect(check.detail).toBe("right hand: video a; drawing b");
  });

  it("fails a review that skipped a body part", () => {
    const partial = review(() => true);
    partial.limbs = partial.limbs.slice(1);
    expect(reviewCheck(partial).detail).toMatch(/right arm .* not compared/);
  });
});

describe("checkStyle", () => {
  const figure = (stripes: number): Rgba => {
    const width = 64, height = 64, data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x >= 4 && x < 60 && y >= 4 && y < 60;
      const dark = stripes > 0 && inside && Math.floor(x / stripes) % 2 === 0;
      data[i] = data[i + 1] = data[i + 2] = dark ? 10 : 230;
      data[i + 3] = inside ? 255 : 0;
    }
    return { data, width, height };
  };

  it("passes the same line work", () => {
    expect(checkStyle(figure(4), outlineDensity(figure(4))).passed).toBe(true);
  });

  it("fails a drawing with soft, lost outlines", () => {
    const check = checkStyle(figure(0), outlineDensity(figure(4)));
    expect(check.passed).toBe(false);
    expect(check.feedback).toMatch(/outlines/);
  });
});

describe("framePrompt", () => {
  const input: FrameInput = {
    character: Buffer.alloc(0), description: "a girl", guide: Buffer.alloc(0), sourceGrey: Buffer.alloc(0), previous: null,
    marks: { head: 256, feet: 1472, center: 512 }, poseText: "", bodyMap: "", face: "Face and expression in this frame: eyes open.", correction: null, feedback: [],
  };

  it("trusts the frame's reading over the measured face", () => {
    const { prompt } = framePrompt({ ...input, reading: "Eyes closed, head bowed." });
    expect(prompt).toContain("described by a person who watched the video (trust it for the head, eyes, mouth and hands): Eyes closed, head bowed.");
    expect(prompt).not.toContain("eyes open");
  });

  it("falls back to the measured face without a reading", () => {
    expect(framePrompt(input).prompt).toContain("eyes open");
  });

  it("holds the style to the first approved frame when there is one", () => {
    const { prompt, references } = framePrompt({ ...input, previous: Buffer.from("p"), anchor: Buffer.from("a") });
    const index = references.findIndex((reference) => reference.role.startsWith("THE STYLE ANCHOR")) + 1;
    expect(index).toBe(5);
    expect(prompt).toContain(`Style: identical to Image ${index} (the style anchor)`);
    expect(framePrompt(input).references.some((reference) => reference.role.startsWith("THE STYLE ANCHOR"))).toBe(false);
  });
});
