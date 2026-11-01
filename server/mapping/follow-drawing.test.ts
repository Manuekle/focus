import { describe, expect, it } from "vitest";
import type { Pose } from "../rotoscope/pose-match";
import { redrawKeptPose } from "../rotoscope/pipeline";
import { angleOf, dist, sub } from "./geometry";
import { followDrawing, retarget } from "./retarget";
import { boneVector, skeletonFromPose, torsoLength } from "./skeleton";

/** A COCO body pose (17 points, the rest unseen) from [x, y] pairs. */
const pose = (points: readonly (readonly [number, number])[]): Pose => ({
  keypoints: Array.from({ length: 133 }, (_, i) => (points[i] ? [points[i][0], points[i][1]] as const : [null, null] as const)),
  scores: Array.from({ length: 133 }, (_, i) => (points[i] ? 0.9 : 0)),
});

// The person: arms down, then the right arm (subject's right, image left) raised.
const DOWN: [number, number][] = [
  [300, 150], [290, 140], [310, 140], [280, 145], [320, 145],
  [250, 220], [350, 220], [240, 320], [360, 320], [235, 410], [365, 410],
  [265, 420], [335, 420], [262, 580], [338, 580], [260, 740], [340, 740],
];
const UP = DOWN.map((p) => [...p] as [number, number]);
UP[8] = [420, 160];
UP[10] = [470, 90];
// The drawing of the character in the DOWN frame, smaller and with its hips higher (hidden under a skirt).
const DRAWN = DOWN.map(([x, y]) => [x * 0.8 + 40, y * 0.8 + 30] as [number, number]);
DRAWN[11] = [DRAWN[11][0], DRAWN[11][1] - 40];
DRAWN[12] = [DRAWN[12][0], DRAWN[12][1] - 40];

describe("followDrawing", () => {
  const base = skeletonFromPose(pose(DRAWN));
  const followed = followDrawing({ base, sourceBase: pose(DOWN), source: pose(UP), character: {}, sourceFull: {} });

  it("moves the drawing's limbs as the person's move, in the drawing's own build", () => {
    const [arm, wanted] = [boneVector(followed.skeleton, "rightForearm")!, boneVector(skeletonFromPose(pose(UP)), "rightForearm")!];
    expect(Math.abs(angleOf(arm) - angleOf(wanted))).toBeLessThan(1e-6);
    // Nothing moved in the video's torso: the drawing's torso, high hips included, stays exactly as drawn.
    expect(torsoLength(followed.skeleton)).toBeCloseTo(torsoLength(base)!, 6);
    expect(dist(followed.skeleton.leftHip!.p, base.leftHip!.p)).toBeLessThan(1e-6);
  });

  it("doesn't stretch the drawing onto the person's size the way the guide placement does", () => {
    const guided = retarget({ source: pose(UP), guide: pose(UP), character: {}, sourceFull: {} });
    expect(torsoLength(guided.skeleton)! / torsoLength(base)!).toBeGreaterThan(1.2);
    expect(torsoLength(followed.skeleton)! / torsoLength(base)!).toBeCloseTo(1, 6);
  });

  it("carries the torso's turn and the pelvis's move, scaled to the drawing", () => {
    const moved = DOWN.map(([x, y]) => [x + 50, y] as [number, number]);
    const shifted = followDrawing({ base, sourceBase: pose(DOWN), source: pose(moved), character: {}, sourceFull: {} });
    const step = sub(shifted.skeleton.pelvis!.p, base.pelvis!.p);
    expect(step[0]).toBeCloseTo(50 * (torsoLength(base)! / torsoLength(skeletonFromPose(pose(DOWN)))!), 6);
  });
});

describe("redrawKeptPose", () => {
  const placed = skeletonFromPose(pose(DOWN));

  it("keeps a redraw whose wrists and ankles stay where the rig put them, and refuses one that moved a hand", () => {
    const nudged = DOWN.map(([x, y]) => [x + 3, y - 2] as [number, number]);
    expect(redrawKeptPose(placed, pose(nudged)).kept).toBe(true);
    const moved = DOWN.map((p) => [...p] as [number, number]);
    moved[10] = [365, 300];
    const verdict = redrawKeptPose(placed, pose(moved));
    expect(verdict.kept).toBe(false);
    expect(verdict.worst).toBeGreaterThan(0.15);
  });

  it("ignores an elbow hidden in a sleeve and left and right labels the estimator swapped", () => {
    const sleeve = DOWN.map((p) => [...p] as [number, number]);
    sleeve[8] = [420, 360];
    expect(redrawKeptPose(placed, pose(sleeve)).kept).toBe(true);
    const swapped = DOWN.map((p) => [...p] as [number, number]);
    [swapped[9], swapped[10]] = [swapped[10], swapped[9]];
    expect(redrawKeptPose(placed, pose(swapped)).kept).toBe(true);
  });
});
