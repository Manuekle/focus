import { describe, expect, it } from "vitest";
import type { Rgba } from "../rotoscope/alpha";
import type { Pose } from "../rotoscope/pose-match";
import type { Mask } from "../mapping/mask";
import { dominantColour, evaluate, foregroundPieces, gapShare, headContacts, stanceContrast, type DebugCheck, type Figure } from "./measure";
import { variantRequest } from "./prompt";

const W = 400;
const H = 800;

/** A frontal figure: subject's right on the image's left. */
const STANDING: Record<number, [number, number]> = {
  0: [200, 100], 1: [215, 90], 2: [185, 90],
  5: [250, 200], 6: [150, 200], 7: [270, 300], 8: [130, 300], 9: [280, 400], 10: [120, 400],
  11: [230, 420], 12: [170, 420], 13: [240, 580], 14: [160, 580], 15: [245, 740], 16: [155, 740],
};

function pose(points: Record<number, [number, number]>): Pose {
  const keypoints = Array.from({ length: 133 }, (_, i) => (points[i] ? points[i] : [null, null]) as [number | null, number | null]);
  return { keypoints, scores: keypoints.map(([x]) => (x === null ? 0 : 0.9)) };
}

function image(paint: (x: number, y: number) => [number, number, number] = () => [255, 255, 255]): Rgba {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = paint(x, y);
    data.set([r, g, b, 255], (y * W + x) * 4);
  }
  return { data, width: W, height: H };
}

function mask(inside: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = inside(x, y) ? 1 : 0;
  return { width: W, height: H, data };
}

const figure = (points: Record<number, [number, number]>, m: Mask | null = null, img = image()): Figure => ({ pose: pose(points), image: img, mask: m });
const check = (checks: DebugCheck[], id: string) => checks.find((c) => c.id === id)!;

describe("single-frame evaluation", () => {
  it("passes every pose check when the output holds the reference pose", () => {
    const checks = evaluate({ pose: figure(STANDING), character: figure(STANDING), output: figure(STANDING) });
    for (const id of ["pose_global", "head_position", "left_arm", "right_arm", "left_hand", "right_hand", "leg_separation", "foot_alignment", "torso_proportions", "deformations"]) {
      expect(check(checks, id).status, id).toBe("ok");
    }
    expect(check(checks, "face_fidelity").status).toBe("manual");
  });

  it("fails the one arm drawn at another angle and names it", () => {
    const output = { ...STANDING, 10: [60, 330] as [number, number] };
    const checks = evaluate({ pose: figure(STANDING), character: figure(STANDING), output: figure(output) });
    expect(check(checks, "right_arm").status).toBe("fail");
    // Forearm (-10, 100) drawn as (-70, 30): 61° apart.
    expect((check(checks, "right_arm").values.errorsDegrees as Record<string, number>).forearm).toBe(61);
    expect(check(checks, "left_arm").status).toBe("ok");
  });

  it("calls a drawing with the raised arm on the other side mirrored", () => {
    const raised = { ...STANDING, 8: [110, 150] as [number, number], 10: [100, 60] as [number, number] };
    const mirrored = { ...STANDING, 7: [290, 150] as [number, number], 9: [300, 60] as [number, number] };
    const global = check(evaluate({ pose: figure(raised), character: figure(STANDING), output: figure(mirrored) }), "pose_global");
    expect(global.values.mirrored).toBe(true);
    expect(global.status).toBe("fail");
  });

  it("finds legs fused where the reference shows a gap between them", () => {
    const torso = (x: number, y: number) => x >= 160 && x <= 240 && y >= 190 && y <= 430;
    const apart = mask((x, y) => torso(x, y) || (y >= 420 && y <= 760 && ((x >= 220 && x <= 265) || (x >= 135 && x <= 180))));
    const merged = mask((x, y) => torso(x, y) || (y >= 420 && y <= 760 && x >= 135 && x <= 265));
    const fusion = check(evaluate({ pose: figure(STANDING, apart), character: figure(STANDING), output: figure(STANDING, merged) }), "limb_fusion");
    expect(fusion.status).toBe("fail");
    expect(fusion.summary).toMatch(/FUSED: shins/);
    const kept = check(evaluate({ pose: figure(STANDING, apart), character: figure(STANDING), output: figure(STANDING, apart) }), "limb_fusion");
    expect(kept.status).toBe("ok");
  });

  it("flags a detached piece and a figure cut by the bottom edge", () => {
    const paint = (x: number, y: number): [number, number, number] => ((x > 120 && x < 280 && y > 60) || (x > 20 && x < 60 && y > 20 && y < 60) ? [20, 20, 20] : [255, 255, 255]);
    const touching = mask((x, y) => x > 120 && x < 280 && y > 60);
    const checks = evaluate({ pose: figure(STANDING), character: figure(STANDING), output: figure(STANDING, touching, image(paint)) });
    const flags = check(checks, "deformations");
    expect(flags.status).toBe("fail");
    expect(flags.summary).toMatch(/detached piece/);
    expect(flags.summary).toMatch(/bottom edge/);
    expect(check(checks, "foot_alignment").summary).toMatch(/CROPPED/);
  });

  it("reports a pose it can't measure as unmeasured, never as a pass", () => {
    const checks = evaluate({ pose: { pose: null, image: image(), mask: null }, character: figure(STANDING), output: figure(STANDING) });
    expect(check(checks, "pose_global").status).toBe("unmeasured");
    expect(check(checks, "left_hand").status).toBe("unmeasured");
  });
});

describe("hand-to-head contact", () => {
  // Face keypoints (23–90) as a box from y 70 (brows) to 140 (chin), x 175–225; eyes at y 90.
  const face = Object.fromEntries(Array.from({ length: 68 }, (_, i) => [23 + i, [175 + (i % 10) * 5.5, 70 + Math.floor(i / 10) * 11.6] as [number, number]]));
  const handAt = (y: number) => {
    const hand = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [112 + i, [195 + (i % 3) * 5, y + Math.floor(i / 3)] as [number, number]]));
    return { ...STANDING, ...face, 8: [130, 120] as [number, number], 10: [170, 60] as [number, number], ...hand };
  };
  const crown = handAt(20);
  const salute = handAt(62);

  it("tells a palm on the crown from a salute at the forehead", () => {
    const contact = check(evaluate({ pose: figure(crown), character: figure(crown), output: figure(salute) }), "hand_head_contact");
    expect(contact.summary).toMatch(/right hand on top of the head in A .* vs at the forehead in output/);
    expect(contact.status).toBe("fail");
    expect(check(evaluate({ pose: figure(crown), character: figure(crown), output: figure(crown) }), "hand_head_contact").status).toBe("ok");
  });

  it("says the contact in screen terms for a prompt", () => {
    expect(headContacts(pose(crown))).toEqual([expect.stringMatching(/^The hand on the LEFT of the image is on top of the head, the palm resting on the crown/)]);
    expect(headContacts(pose(STANDING))).toEqual([]);
  });
});

describe("stance contrast", () => {
  const narrow = { ...STANDING, 13: [215, 580] as [number, number], 14: [185, 580] as [number, number], 15: [212, 740] as [number, number], 16: [188, 740] as [number, number] };
  it("names Image B's wider stance as the one not to copy", () => {
    const text = stanceContrast(pose(narrow), pose(STANDING))!;
    expect(text).toMatch(/the ankles are 0\.4 hip widths apart/);
    expect(text).toMatch(/Image B stands with its ankles 1\.5 hip widths apart: that is Image B's own standing stance, NOT the pose/);
    expect(text).toMatch(/shoes side by side/);
  });
  it("says nothing when B stands like A", () => {
    expect(stanceContrast(pose(STANDING), pose(STANDING))).toBeNull();
  });
});

describe("variants", () => {
  const [a, b, c] = [Buffer.from("a"), Buffer.from("b"), Buffer.from("c")];
  it("changes one thing each against the base prompt", () => {
    const base = variantRequest("base", { pose: a, character: b });
    expect(base.references.map((r) => r.label)).toEqual(["Image A", "Image B"]);
    expect(variantRequest("edit", { pose: a, character: b }).action).toBe("edit");
    const mannequin = variantRequest("mannequin", { pose: a, character: b, mannequin: c });
    expect(mannequin.references.map((r) => r.label)).toEqual(["Image A", "Image B", "Image C"]);
    expect(mannequin.prompt).toContain("Image C is a posing mannequin");
    const described = variantRequest("describe", { pose: a, character: b, described: "Legs: the knees are pulled together." });
    expect(described.prompt.startsWith(base.prompt)).toBe(true);
    expect(described.prompt).toMatch(/knees are pulled together\.$/);
    expect(() => variantRequest("mannequin", { pose: a, character: b })).toThrow(/pose estimator/);
    const stance = variantRequest("stance", { pose: a, character: b, described: "Legs: x.", stance: "Image B stands wider." });
    expect(stance.prompt).toBe(`${described.prompt.replace("Legs: the knees are pulled together.", "Legs: x.")}\n\nImage B stands wider.`);
  });
});

describe("measuring helpers", () => {
  it("measures the background share between two points", () => {
    const left = mask((x) => x < 100);
    expect(gapShare(left, [50, 400], [350, 400])).toBeGreaterThan(0.7);
    expect(gapShare(mask(() => true), [50, 400], [350, 400])).toBe(0);
  });

  it("finds the dominant colour of a region", () => {
    const img = image((x) => (x < 300 ? [200, 30, 30] : [30, 30, 200]));
    expect(dominantColour(img, () => true)?.hex).toBe("#c81e1e");
  });

  it("counts foreground pieces only on a plain backdrop", () => {
    expect(foregroundPieces(image((x, y) => (x > 100 && x < 200 && y > 100 && y < 300 ? [0, 0, 0] : [255, 255, 255])))).toHaveLength(1);
    expect(foregroundPieces(image((x, y) => ((x + y) % 2 ? [0, 0, 0] : [255, 255, 255])))).toBeNull();
    // A cut-out with black outlines and a white shirt is one piece: alpha decides, not colour.
    const cutout = image((x, y) => (x > 100 && x < 300 && y > 100 && y < 700 ? (x < 110 ? [0, 0, 0] : [250, 250, 250]) : [0, 0, 0]));
    for (let p = 0; p < W * H; p++) { const [x, y] = [p % W, Math.floor(p / W)]; if (!(x > 100 && x < 300 && y > 100 && y < 700)) cutout.data[p * 4 + 3] = 0; }
    expect(foregroundPieces(cutout)).toHaveLength(1);
  });
});
