import { describe, expect, it } from "vitest";
import { comparePoses } from "../rotoscope/pose-match";
import { COLOURS, measureBone, measuredPose, renderFigure, standing } from "./__fixtures__/figure";
import { deform, planBones } from "./deform";
import { apply, boneTransform, compose, fitAffine, invert, norm, sub, type Vec } from "./geometry";
import { area, dilate, erode, fillHoles, fromAlpha, fromBackdrop, intersectionOverUnion, type Mask } from "./mask";
import { buildRig, weightsFor } from "./rig";
import { acceptRegion, applyRegions, regionPrompts } from "./segmenter";
import { BONE_NAMES, mapSkeleton, poseFromSkeleton, skeletonFromPose, type JointName, type Skeleton } from "./skeleton";

const close = (a: Vec, b: Vec, tolerance = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;

/** Turns the chain below `pivot` by `degrees` about the pivot joint. */
function rotateChain(s: Skeleton, pivot: JointName, chain: readonly JointName[], degrees: number): Skeleton {
  const c = s[pivot]!.p;
  const t = (degrees * Math.PI) / 180;
  const turn = (p: Vec): Vec => [c[0] + (p[0] - c[0]) * Math.cos(t) - (p[1] - c[1]) * Math.sin(t), c[1] + (p[0] - c[0]) * Math.sin(t) + (p[1] - c[1]) * Math.cos(t)];
  return { ...s, ...Object.fromEntries(chain.map((name) => [name, s[name] ? { p: turn(s[name]!.p), score: s[name]!.score } : null])) };
}

describe("geometry", () => {
  it("fits an exact affine from four point pairs and inverts it", () => {
    const m = [1.2, 0.3, 10, -0.2, 0.9, -5] as const;
    const source: Vec[] = [[0, 0], [100, 0], [0, 50], [70, 80]];
    const fitted = fitAffine(source, source.map((p) => apply(m, p)))!;
    fitted.forEach((value, i) => expect(value).toBeCloseTo(m[i], 6));
    const back = compose(invert(fitted)!, fitted);
    expect(close(apply(back, [33, 44]), [33, 44], 1e-6)).toBe(true);
  });

  it("turns and stretches a bone along its own axis while keeping its width", () => {
    const m = boneTransform([0, 0], [100, 0], [10, 10], [10, 160]);
    expect(close(apply(m, [0, 0]), [10, 10])).toBe(true);
    expect(close(apply(m, [100, 0]), [10, 160], 1e-6)).toBe(true);
    // A point 20 px to the side of the bone stays 20 px to the side.
    const side = apply(m, [50, 20]);
    expect(Math.abs(side[0] - 10)).toBeCloseTo(20, 6);
  });
});

describe("masks", () => {
  it("cuts a figure from a flat backdrop and keeps its enclosed white areas", () => {
    const sheet = renderFigure(standing(), { width: 1024, height: 1536 }, [250, 248, 244]);
    const mask = fromBackdrop(sheet);
    const truth = fromAlpha(renderFigure(standing()));
    expect(intersectionOverUnion(mask, truth)).toBeGreaterThan(0.98);
  });

  it("dilates, erodes and fills holes", () => {
    const ring: Mask = { width: 9, height: 9, data: new Uint8Array(81) };
    for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) ring.data[y * 9 + x] = x === 4 && y === 4 ? 0 : 1;
    expect(area(fillHoles(ring))).toBe(25);
    expect(area(dilate(ring, 1))).toBe(49);
    expect(area(erode(fillHoles(ring), 1))).toBe(9);
  });
});

describe("rig", () => {
  const skeleton = standing();
  const image = renderFigure(skeleton);
  const rig = buildRig(image, fromAlpha(image), skeleton);
  const labelOf = (p: Vec) => BONE_NAMES[rig.labels[Math.floor(p[1]) * rig.width + Math.floor(p[0])] - 1];

  it("assigns each bone its own pixels", () => {
    const share = (bones: readonly string[]) => {
      let [right, total] = [0, 0];
      for (const bone of bones as typeof BONE_NAMES) {
        const c = COLOURS[bone];
        for (let p = 0; p < rig.labels.length; p++) {
          if (image.data[p * 4] !== c[0] || image.data[p * 4 + 1] !== c[1] || image.data[p * 4 + 2] !== c[2]) continue;
          total++;
          if (rig.labels[p] - 1 === BONE_NAMES.indexOf(bone)) right++;
        }
      }
      return right / total;
    };
    // Arms, hands, head and torso exactly; legs lose only the round joint caps the drawing overlaps.
    expect(share(["torso", "head", "leftUpperArm", "leftForearm", "leftHand", "rightUpperArm", "rightForearm", "rightHand"])).toBeGreaterThan(0.99);
    expect(share(BONE_NAMES)).toBeGreaterThan(0.92);
    expect(labelOf([512, 600])).toBe("torso");
    expect(labelOf([512, 300])).toBe("head");
    expect(labelOf([665, 710])).toBe("leftForearm");
  });

  it("gives a shared mesh vertex the same joint weights from both sides", () => {
    const upper = rig.bones.find((bone) => bone.name === "leftUpperArm")!;
    const fore = rig.bones.find((bone) => bone.name === "leftForearm")!;
    const v: Vec = [652, 628];
    const [a, b] = [weightsFor(rig, upper, v), weightsFor(rig, fore, v)];
    expect(a.get(fore.index)).toBeCloseTo(b.get(fore.index) ?? 0, 6);
    expect(a.get(upper.index)).toBeCloseTo(b.get(upper.index) ?? 0, 6);
  });

  it("records the torso hidden under an arm laid across it", () => {
    const across = { ...skeleton, leftElbow: { p: [560, 600] as Vec, score: 0.9 }, leftWrist: { p: [470, 640] as Vec, score: 0.9 }, leftHand: { p: [440, 650] as Vec, score: 0.9 } };
    const crossed = renderFigure(across);
    const crossedRig = buildRig(crossed, fromAlpha(crossed), across);
    const torso = BONE_NAMES.indexOf("torso") + 1;
    expect(crossedRig.hidden.filter((value) => value === torso).length).toBeGreaterThan(2000);
  });
});

describe("deform", () => {
  const skeleton = standing();
  const image = renderFigure(skeleton);
  const rig = buildRig(image, fromAlpha(image), skeleton);

  it("reproduces the drawing for its own pose", () => {
    const result = deform(image, rig, skeleton);
    expect(intersectionOverUnion(result.coverage, fromAlpha(image))).toBeGreaterThan(0.97);
    expect(result.stats.flipped).toBe(0);
    expect(result.stats.exposedArea).toBe(0);
  });

  it("moves an arm's own pixels to the target angle, measured on the result", () => {
    const raised = rotateChain(skeleton, "leftShoulder", ["leftElbow", "leftWrist", "leftHand"], -110);
    const result = deform(image, rig, raised);
    const fore = measureBone(result.image, "leftUpperArm")!;
    const want = sub(raised.leftElbow!.p, raised.leftShoulder!.p);
    const got = sub(fore.ends[1], fore.ends[0]);
    const angle = Math.abs(Math.atan2(want[0] * got[1] - want[1] * got[0], want[0] * got[0] + want[1] * got[1])) * 180 / Math.PI;
    expect(Math.min(angle, 180 - angle)).toBeLessThan(4);
    expect(result.stats.flipped).toBe(0);
    // The firewall's own pose check, on a pose measured from the pixels alone.
    expect(comparePoses(poseFromSkeleton(raised), measuredPose(result.image)).passed).toBe(true);
  });

  it("finds the torso an arm uncovers and fills it", () => {
    const across = { ...skeleton, leftElbow: { p: [560, 600] as Vec, score: 0.9 }, leftWrist: { p: [470, 640] as Vec, score: 0.9 }, leftHand: { p: [440, 650] as Vec, score: 0.9 } };
    const crossed = renderFigure(across);
    const crossedRig = buildRig(crossed, fromAlpha(crossed), across);
    const result = deform(crossed, crossedRig, skeleton);
    expect(result.stats.exposedArea).toBeGreaterThan(1500);
    // Every exposed pixel is opaque after the fill: no hole in the body.
    for (let p = 0; p < result.exposed.data.length; p++) if (result.exposed.data[p]) expect(result.image.data[p * 4 + 3]).toBe(255);
  });

  it("clamps a limb asked to stretch past its limits and reports it", () => {
    const long = { ...skeleton, leftWrist: { p: [760, 1150] as Vec, score: 0.9 }, leftHand: { p: [780, 1200] as Vec, score: 0.9 } };
    const plan = planBones(rig, long);
    expect(plan.clamped).toContain("leftForearm");
    const forearm = norm(sub(plan.generated.leftWrist!.p, plan.generated.leftElbow!.p));
    expect(forearm).toBeLessThanOrEqual(norm(sub(skeleton.leftWrist!.p, skeleton.leftElbow!.p)) * 1.31);
  });

  it("follows the target anywhere on the canvas and at another size", () => {
    const moved = mapSkeleton(skeleton, (p) => [p[0] * 0.9 + 40, p[1] * 0.9 + 60]);
    const result = deform(image, rig, moved);
    expect(result.plan.scale).toBeCloseTo(0.9, 2);
    expect(close(result.plan.generated.leftWrist!.p, moved.leftWrist!.p, 2)).toBe(true);
  });
});

describe("SAM region prompts", () => {
  const skeleton = standing();
  const image = renderFigure(skeleton);
  const rig = buildRig(image, fromAlpha(image), skeleton);

  it("prompts every limb with a box, points on the bone and negative points on its neighbours", () => {
    const prompts = regionPrompts(rig);
    const arm = prompts.find((prompt) => prompt.bone === "leftForearm")!;
    expect(arm.box.right).toBeGreaterThan(arm.box.left);
    expect(arm.points.filter((point) => point.label !== "negative").length).toBeGreaterThanOrEqual(2);
    for (const point of arm.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(rig.height);
    }
  });

  it("uses a SAM region only where it agrees with the rig, and never a joint from it", () => {
    const own = BONE_NAMES.indexOf("leftForearm") + 1;
    const good: Mask = { width: rig.width, height: rig.height, data: rig.labels.map((label) => (label === own ? 1 : 0)) };
    const wrong: Mask = { width: rig.width, height: rig.height, data: rig.labels.map((label) => (label === BONE_NAMES.indexOf("torso") + 1 ? 1 : 0)) };
    expect(acceptRegion(good, rig, "leftForearm")).toBe(true);
    expect(acceptRegion(wrong, rig, "leftForearm")).toBe(false);
    const { applied } = applyRegions(rig, new Map([["leftForearm", good], ["rightForearm", wrong]]));
    expect(applied).toEqual(["leftForearm"]);
    expect(rig.skeleton.leftElbow).toEqual(skeletonFromPose(poseFromSkeleton(skeleton)).leftElbow);
  });
});
