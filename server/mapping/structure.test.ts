import { describe, expect, it } from "vitest";
import { policyRegistry } from "../policies/registry";
import type { PreparationContext, RenderingContext } from "../policies/rules";
import { renderFigure, standing } from "./__fixtures__/figure";
import { deform, DEFAULT_LIMITS, planBones } from "./deform";
import { fromAlpha, area } from "./mask";
import { buildRig } from "./rig";
import type { JointName, Skeleton } from "./skeleton";

// The rig's structural checks: folded triangles detected by orientation, collapsed triangles
// counted instead of skipped, where the mesh breaks, and a torso that couldn't be fitted said so.

const skeleton = standing();
const image = renderFigure(skeleton);
const rig = buildRig(image, fromAlpha(image), skeleton);

const moved = (s: Skeleton, changes: Partial<Record<JointName, readonly [number, number]>>): Skeleton =>
  ({ ...s, ...Object.fromEntries(Object.entries(changes).map(([name, p]) => [name, { p, score: 0.9 }])) }) as Skeleton;

function structureOutcome(result: ReturnType<typeof deform>) {
  const registry = policyRegistry();
  return registry.run<RenderingContext>("rendering", { stage: "rendering", result, baseArea: area(fromAlpha(image)) }).outcomes.find((outcome) => outcome.id === "solid-drawing/structure")!;
}

describe("rig structure", () => {
  it("its own pose: no fold, no collapse, torso fitted, structure passes", () => {
    const result = deform(image, rig, skeleton);
    expect(result.stats).toMatchObject({ flipped: 0, collapsed: 0 });
    expect(result.stats.foldedBy).toEqual({});
    expect(result.plan.torsoFit).toBe("affine");
    expect(structureOutcome(result).passed).toBe(true);
  });

  it("a forearm folded back through the upper arm turns triangles over: detected by orientation and located", () => {
    const { leftShoulder, leftElbow } = skeleton;
    // The wrist and hand pulled back past the shoulder: the forearm's mesh near the elbow must fold.
    const back = moved(skeleton, {
      leftWrist: [leftShoulder!.p[0] + (leftShoulder!.p[0] - leftElbow!.p[0]) * 0.2, leftShoulder!.p[1]],
      leftHand: [leftShoulder!.p[0] + (leftShoulder!.p[0] - leftElbow!.p[0]) * 0.4, leftShoulder!.p[1]],
    });
    const result = deform(image, rig, back);
    expect(result.stats.flipped + result.stats.collapsed).toBeGreaterThan(0);
    expect(Object.keys(result.stats.foldedBy).some((bone) => bone.startsWith("left"))).toBe(true);
    const outcome = structureOutcome(result);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toMatch(/folded/);
  });

  it("a limb squashed to nothing counts as collapsed instead of being skipped silently", () => {
    const { leftElbow } = skeleton;
    // A forearm a thousandth of a pixel long, with nothing stopping the squash.
    const flat = moved(skeleton, { leftWrist: [leftElbow!.p[0] + 1e-3, leftElbow!.p[1]], leftHand: [leftElbow!.p[0] + 2e-3, leftElbow!.p[1]] });
    const result = deform(image, rig, flat, { limits: { ...DEFAULT_LIMITS, minStretch: 0 } });
    expect(result.stats.collapsed).toBeGreaterThan(0);
    expect(result.stats.foldedBy.leftForearm).toBeGreaterThan(0);
    expect(structureOutcome(result).passed).toBe(false);
  });

  it("a stretch past the limits is clamped and reported, never applied silently", () => {
    const { leftElbow, leftWrist } = skeleton;
    const long = moved(skeleton, { leftWrist: [leftElbow!.p[0] + (leftWrist!.p[0] - leftElbow!.p[0]) * 2.5, leftElbow!.p[1] + (leftWrist!.p[1] - leftElbow!.p[1]) * 2.5] });
    const plan = planBones(rig, long);
    expect(plan.clamped).toContain("leftForearm");
    const outcome = policyRegistry().run<PreparationContext>("frame-preparation", { stage: "frame-preparation", plan }).outcomes.find((entry) => entry.id === "solid-drawing/limb-volume");
    expect(outcome?.passed).toBe(false);
  });

  it("a torso sheared past what an affine may do falls back to its centre line, and says so", () => {
    const { leftShoulder, rightShoulder } = skeleton;
    // The shoulders thrown sideways by half a torso against the hips: an affine fit would shear the torso.
    const sheared = moved(skeleton, { leftShoulder: [leftShoulder!.p[0] + 400, leftShoulder!.p[1] - 300], rightShoulder: [rightShoulder!.p[0] + 400, rightShoulder!.p[1] + 300] });
    const result = deform(image, rig, sheared);
    expect(result.plan.torsoFit).toBe("similarity");
    expect(structureOutcome(result).detail).toMatch(/torso placed on its centre line/);
  });
});
