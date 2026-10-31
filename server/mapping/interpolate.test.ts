import { describe, expect, it } from "vitest";
import { dist } from "./geometry";
import { interpolateSkeleton, largestTurn } from "./interpolate";
import { JOINT_NAMES, torsoLength, type JointName, type Skeleton } from "./skeleton";

/** A standing figure facing the camera; the right arm hangs down or points sideways. */
function figure(arm: "down" | "out", pelvis: [number, number] = [100, 200]): Skeleton {
  const at = (x: number, y: number) => ({ p: [pelvis[0] + x, pelvis[1] + y] as [number, number], score: 1 });
  const joints: Partial<Record<JointName, ReturnType<typeof at>>> = {
    pelvis: at(0, 0), neck: at(0, -100), head: at(0, -130),
    leftShoulder: at(-20, -95), rightShoulder: at(20, -95), leftHip: at(-12, 0), rightHip: at(12, 0),
    leftElbow: at(-25, -50), leftWrist: at(-25, -10), leftHand: at(-25, 5),
    rightElbow: arm === "down" ? at(25, -50) : at(65, -95), rightWrist: arm === "down" ? at(25, -10) : at(105, -95), rightHand: arm === "down" ? at(25, 5) : at(120, -95),
    leftKnee: at(-12, 60), leftAnkle: at(-12, 120), leftToe: at(-5, 125), rightKnee: at(12, 60), rightAnkle: at(12, 120), rightToe: at(19, 125),
  };
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, joints[name] ?? null])) as Skeleton;
}

describe("interpolating a skeleton", () => {
  it("returns each key at its end", () => {
    const [a, b] = [figure("down"), figure("out")];
    const start = interpolateSkeleton(a, b, 0)!;
    const end = interpolateSkeleton(a, b, 1)!;
    for (const name of JOINT_NAMES) {
      if (a[name]) expect(dist(start[name]!.p, a[name]!.p)).toBeLessThan(0.5);
      if (b[name]) expect(dist(end[name]!.p, b[name]!.p)).toBeLessThan(0.5);
    }
  });

  it("swings a limb through an arc instead of shrinking it through a chord", () => {
    const [a, b] = [figure("down"), figure("out")];
    const middle = interpolateSkeleton(a, b, 0.5)!;
    const upper = (s: Skeleton) => dist(s.rightShoulder!.p, s.rightElbow!.p);
    expect(upper(middle)).toBeGreaterThan(upper(a) * 0.98);
    expect(upper(middle)).toBeLessThan(upper(a) * 1.4);
    // Halfway between hanging (down) and level: pointing down-and-out, about 45° below the shoulder line.
    const v = [middle.rightElbow!.p[0] - middle.rightShoulder!.p[0], middle.rightElbow!.p[1] - middle.rightShoulder!.p[1]];
    expect(Math.abs((Math.atan2(v[1], v[0]) * 180) / Math.PI)).toBeGreaterThan(30);
    expect(Math.abs((Math.atan2(v[1], v[0]) * 180) / Math.PI)).toBeLessThan(60);
  });

  it("moves the whole figure with the pelvis and keeps the torso length between the keys", () => {
    const [a, b] = [figure("down", [100, 200]), figure("down", [160, 200])];
    const middle = interpolateSkeleton(a, b, 0.5)!;
    expect(middle.pelvis!.p[0]).toBeCloseTo(130, 3);
    expect(torsoLength(middle)).toBeCloseTo(100, 3);
  });

  it("measures how far two keys are apart and refuses a key with no torso", () => {
    expect(largestTurn(figure("down"), figure("down"))).toBeCloseTo(0, 3);
    expect(largestTurn(figure("down"), figure("out"))).toBeGreaterThan(60);
    const headless = { ...figure("down"), pelvis: null } as Skeleton;
    expect(interpolateSkeleton(headless, figure("out"), 0.5)).toBeNull();
  });
});
