import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJoints, unconfirmed } from "./joints";
import { boneUncertainty, comparePoses, movingBones, type Pose } from "./pose-match";

// The pose check and the joint schema on the real wave run (run 60bd847f, frame 1): the source poses
// of all 9 frames, and DWPose on the three Muse Image attempts. By eye: a1 is mirrored, a2 holds the
// pose, a3's raised upper arm is off.

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__/wave/poses.json"), "utf8")) as {
  size: { width: number; height: number };
  source: Pose[];
  attempts: Pose[];
};
const [a1, a2, a3] = fixture.attempts;
const source = fixture.source[0];
const clip = fixture.source;

describe("pose check on the wave run's frame 1", () => {
  it("measures the arms now, not only the legs (the old check measured 4 bones: thighs and shins)", () => {
    const check = comparePoses(source, a2, undefined, clip);
    expect(check.bones.map((bone) => bone.name)).toEqual(expect.arrayContaining(["right upper arm", "right forearm", "left upper arm", "left forearm"]));
    expect(check.coverage).toEqual({ measured: 4, of: 4 });
  });

  it("agrees with the human verdict on all three attempts", () => {
    const [first, second, third] = [a1, a2, a3].map((drawn) => comparePoses(source, drawn, undefined, clip));
    expect(first.status).toBe("fail");
    expect(first.detail).toMatch(/^MIRRORED/);
    expect(second.status).toBe("pass");
    expect(third.status).toBe("fail");
    expect(third.bones.find((bone) => bone.name === "right upper arm")!.degrees).toBeGreaterThan(60);
  });

  it("finds the moving bones of the clip: the waving arms, not the still legs", () => {
    const moving = movingBones(clip);
    expect(moving).toEqual(expect.arrayContaining(["right upper arm", "right forearm"]));
    expect(moving).not.toContain("left thigh");
    expect(moving).not.toContain("right shin");
  });

  it("gives no verdict when every moving bone is too short to measure, even if the legs match", () => {
    // The arms pulled into the shoulders (pointing straight at the camera): no direction to measure.
    const keypoints = source.keypoints.map((p) => [...p] as [number | null, number | null]);
    for (const [joint, shoulder] of [[7, 5], [9, 5], [8, 6], [10, 6]] as const) keypoints[joint] = [source.keypoints[shoulder][0]! + 3, source.keypoints[shoulder][1]! + 3];
    const foreshortened: Pose = { keypoints, scores: source.scores };
    const check = comparePoses(foreshortened, a2, undefined, clip);
    expect(check.status).toBe("inconclusive");
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/too few of the moving bones/);
  });

  it("never measures a source joint the track doesn't confirm", () => {
    const hidden = unconfirmed(canonicalJoints(source, { space: "frame", source: "rtmw", ...fixture.size, flags: { occluded: [8], bridged: [], offSubject: [] } }));
    const check = comparePoses(source, a2, undefined, clip, hidden);
    expect(check.unmeasured).toEqual(expect.arrayContaining(["right upper arm", "right forearm"]));
    expect(check.bones.map((bone) => bone.name)).not.toContain("right upper arm");
  });

  it("still fails a confident error however little else was measured", () => {
    const hidden = new Set([7, 8, 9, 10]);
    // a1 mirrored: even with the arms unmeasured the legs alone don't make it a pass…
    const check = comparePoses(source, a1, undefined, clip, hidden);
    expect(check.status).not.toBe("pass");
  });
});

describe("bone direction uncertainty", () => {
  it("shrinks as the bone gets longer and is huge for a bone seen end-on", () => {
    expect(boneUncertainty(10, 5)).toBeGreaterThan(boneUncertainty(100, 5));
    expect(boneUncertainty(0, 5)).toBe(180);
    // RTMW's noise (0.02 torso) on a forearm of 0.43 torso: about ±7.5°.
    expect(boneUncertainty(0.43, 0.02)).toBeCloseTo(7.5, 0);
  });
});

describe("canonical joints", () => {
  it("represents every body joint with side, pixels, torso units, score and visibility", () => {
    const joints = canonicalJoints(source, { space: "frame", source: "rtmw", ...fixture.size });
    expect(joints).toHaveLength(17);
    const elbow = joints.find((joint) => joint.name === "left elbow")!;
    expect(elbow).toMatchObject({ id: 7, side: "left", visibility: "VISIBLE", space: "frame" });
    expect(elbow.score).toBeGreaterThan(1);
    // The raised elbow is above the hips by about 1.3 torso lengths.
    expect(elbow.normalized![1]).toBeLessThan(-1);
    const hip = joints.find((joint) => joint.name === "left hip")!;
    expect(Math.abs(hip.normalized![1])).toBeLessThan(0.05);
  });

  it("marks missing, off-image, untracked and bridged joints instead of trusting them", () => {
    const keypoints = source.keypoints.map((p) => [...p] as [number | null, number | null]);
    keypoints[0] = [null, null];
    keypoints[9] = [fixture.size.width + 50, 100];
    const joints = canonicalJoints({ keypoints, scores: source.scores }, { space: "frame", source: "rtmw", ...fixture.size, flags: { occluded: [13], bridged: [14], offSubject: [15] } });
    const by = (id: number) => joints[id];
    expect(by(0).visibility).toBe("UNKNOWN");
    expect(by(9)).toMatchObject({ visibility: "UNKNOWN", reason: "off the image" });
    expect(by(13).visibility).toBe("OCCLUDED");
    expect(by(14).visibility).toBe("INFERRED");
    expect(by(15).visibility).toBe("OCCLUDED");
    expect([...unconfirmed(joints)].sort((x, y) => x - y)).toEqual([0, 9, 13, 14, 15]);
  });

  it("puts a joint outside the figure's mask out of the measurements", () => {
    const mask = { width: fixture.size.width, height: fixture.size.height, data: new Uint8Array(fixture.size.width * fixture.size.height) };
    const joints = canonicalJoints(source, { space: "frame", source: "rtmw", ...fixture.size, mask });
    expect(joints.every((joint) => joint.visibility !== "VISIBLE")).toBe(true);
  });

  it("carries the hidden-under-the-skirt legs of a drawing as detected: RTMW's scores can't tell (documented limit)", () => {
    const legs = canonicalJoints(a2, { space: "drawing", source: "rtmw", width: 1024, height: 1536 }).filter((joint) => [13, 14].includes(joint.id));
    expect(legs.every((joint) => joint.visibility === "VISIBLE")).toBe(true);
  });
});
