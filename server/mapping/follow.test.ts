import { describe, expect, it } from "vitest";
import { followSkeleton } from "./follow";
import { dist } from "./geometry";
import { JOINT_NAMES, torsoLength, type JointName, type Skeleton } from "./skeleton";

function figure(arm: "down" | "out", options: { pelvis?: [number, number]; size?: number } = {}): Skeleton {
  const [px, py] = options.pelvis ?? [100, 200];
  const k = options.size ?? 1;
  const at = (x: number, y: number) => ({ p: [px + x * k, py + y * k] as [number, number], score: 1 });
  const joints: Partial<Record<JointName, ReturnType<typeof at>>> = {
    pelvis: at(0, 0), neck: at(0, -100), head: at(0, -130),
    leftShoulder: at(-20, -95), rightShoulder: at(20, -95), leftHip: at(-12, 0), rightHip: at(12, 0),
    leftElbow: at(-25, -50), leftWrist: at(-25, -10), leftHand: at(-25, 5),
    rightElbow: arm === "down" ? at(25, -50) : at(65, -95), rightWrist: arm === "down" ? at(25, -10) : at(105, -95), rightHand: arm === "down" ? at(25, 5) : at(120, -95),
    leftKnee: at(-12, 60), leftAnkle: at(-12, 120), leftToe: at(-5, 125), rightKnee: at(12, 60), rightAnkle: at(12, 120), rightToe: at(19, 125),
  };
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, joints[name] ?? null])) as Skeleton;
}

describe("following a video's movement", () => {
  it("stays on the key when the video hasn't moved", () => {
    const key = figure("down", { size: 2, pelvis: [300, 500] });
    const same = followSkeleton(key, figure("down"), figure("down"))!;
    for (const name of JOINT_NAMES) if (key[name]) expect(dist(same[name]!.p, key[name]!.p)).toBeLessThan(0.5);
  });

  it("turns each bone by what the video's bone turned, at the character's own size", () => {
    // The character is twice the person's size and stands elsewhere; its arm is hanging, like the person's.
    const key = figure("down", { size: 2, pelvis: [300, 500] });
    const raised = followSkeleton(key, figure("down"), figure("out"))!;
    expect(torsoLength(raised)).toBeCloseTo(torsoLength(key)!, 3);
    // The person's arm went from hanging to level: so does the character's, with its own (longer) arm.
    const upper = (s: Skeleton) => dist(s.rightShoulder!.p, s.rightElbow!.p);
    expect(Math.abs(upper(raised) - upper(key))).toBeLessThan(2);
    const v = [raised.rightElbow!.p[0] - raised.rightShoulder!.p[0], raised.rightElbow!.p[1] - raised.rightShoulder!.p[1]];
    expect(Math.abs(v[1])).toBeLessThan(Math.abs(v[0]) * 0.15);
    expect(v[0]).toBeGreaterThan(0);
    // The other arm and the legs didn't move.
    expect(dist(raised.leftWrist!.p, key.leftWrist!.p)).toBeLessThan(0.5);
    expect(dist(raised.rightAnkle!.p, key.rightAnkle!.p)).toBeLessThan(0.5);
  });

  it("moves the figure by the person's travel, in torsos", () => {
    const key = figure("down", { size: 2, pelvis: [300, 500] });
    const moved = followSkeleton(key, figure("down", { pelvis: [100, 200] }), figure("down", { pelvis: [150, 180] }))!;
    expect(moved.pelvis!.p[0]).toBeCloseTo(300 + 50 * 2, 3);
    expect(moved.pelvis!.p[1]).toBeCloseTo(500 - 20 * 2, 3);
  });

  it("keeps the key's bone where the video didn't show it", () => {
    const key = figure("down");
    const hidden = { ...figure("out"), rightElbow: null } as Skeleton;
    const result = followSkeleton(key, figure("down"), hidden)!;
    expect(dist(result.rightElbow!.p, key.rightElbow!.p)).toBeLessThan(0.5);
  });
});
