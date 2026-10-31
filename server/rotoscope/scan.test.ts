import { describe, expect, it } from "vitest";
import { renderFigure, standing } from "../mapping/__fixtures__/figure";
import type { Vec } from "../mapping/geometry";
import { mapSkeleton, MIRROR_JOINT, type JointName, type Skeleton } from "../mapping/skeleton";
import { applySimilarity, cellName, invertSimilarity, procrustes, scanPose } from "./scan";

const target = standing();
const image = renderFigure(target);
const moved = (s: Skeleton, joint: JointName, to: Vec): Skeleton => ({ ...s, [joint]: { p: to, score: 0.9 } });

describe("overlay scan", () => {
  it("recovers a similarity exactly by least squares", () => {
    const from: Vec[] = [[0, 0], [100, 0], [0, 50], [80, 120]];
    const m = { scale: 1.3, angle: 0.4, tx: 25, ty: -10 };
    const fitted = procrustes(from, from.map((p) => applySimilarity(m, p)))!;
    expect(fitted.scale).toBeCloseTo(1.3, 6);
    expect(fitted.angle).toBeCloseTo(0.4, 6);
    expect(fitted.tx).toBeCloseTo(25, 6);
    const back = applySimilarity(invertSimilarity(fitted), applySimilarity(fitted, [33, 44]));
    expect(back[0]).toBeCloseTo(33, 6);
    expect(back[1]).toBeCloseTo(44, 6);
  });

  it("passes the target's own pose, wherever and at whatever size it is drawn", () => {
    const shifted = mapSkeleton(target, (p) => [p[0] * 0.9 + 60, p[1] * 0.9 + 40]);
    const report = scanPose(target, shifted, renderFigure(shifted));
    expect(report.passed, report.detail).toBe(true);
    expect(report.mean).toBeLessThan(0.01);
  });

  it("finds a hand in the wrong place and names the grid cells", () => {
    const wrong = moved(moved(target, "leftWrist", [760, 300]), "leftElbow", [720, 450]);
    const report = scanPose(target, wrong, image);
    expect(report.passed).toBe(false);
    expect(report.feedback).toMatch(/left wrist: should be in [A-H]\d+, drawn in [A-H]\d+/);
    expect(report.cells.length).toBeGreaterThan(0);
    expect(cellName([700, 300])).toBe("F3");
  });

  it("catches a mirrored drawing even when the legs alone look right", () => {
    const raised = moved(moved(target, "leftWrist", [700, 120]), "leftElbow", [660, 280]);
    const mirrored = Object.fromEntries(Object.entries(raised).map(([name, joint]) => [MIRROR_JOINT[name as JointName], joint])) as unknown as Skeleton;
    const flipped = mapSkeleton(mirrored, (p) => [1024 - p[0], p[1]]);
    const report = scanPose(raised, flipped, renderFigure(raised));
    expect(report.passed).toBe(false);
    expect(report.detail).toMatch(/MIRRORED|bad cells/);
  });

  it("flags a limb the skeleton places but the drawing has no pixels for", () => {
    const blank = { ...image, data: Buffer.from(image.data) };
    for (let y = 600; y < 900; y++) for (let x = 620; x < 760; x++) blank.data[(y * 1024 + x) * 4 + 3] = 0;
    const report = scanPose(target, target, blank);
    expect(report.passed).toBe(false);
    expect(report.feedback).toMatch(/Nothing is drawn where the left/);
  });
});
