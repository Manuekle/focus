import { describe, expect, it } from "vitest";
import {
  ACTION_SPECS,
  CreateFlipbookRequestSchema,
  type CharacterAnalysis,
} from "../../shared/flipbook";
import {
  VIEW_OPTIONS,
  cameraDescription,
  resolveCameraView,
  type CameraView,
} from "../../shared/animation-view";
import {
  compatiblePoseId,
  poseCandidates,
  poseReferenceFor,
} from "./pose-catalog";
import { decideReference } from "./reference-manager";
import { parseAnalysisOutput } from "./character-analysis";
import {
  parsePlanOutput,
  planInstructions,
  planJsonSchema,
  posePrompt,
  referencePrompt,
  repairPrompt,
} from "./pose-planning";

const elf: CharacterAnalysis = {
  characterCount: 1,
  subject: "elf girl",
  facing: "front",
  view: "front",
  fullBodyVisible: true,
  feetVisible: true,
  background: "plain",
  style: "anime illustration",
  hair: "blonde side braid",
  clothing: "forest-green coat",
  accessories: ["burgundy choker"],
  palette: ["#456547"],
  proportions: "long pointed ears",
  requestedAction: "wave",
};
const json = JSON.stringify({
  direction: "right",
  motion: "in_place",
  poses: ACTION_SPECS.wave.poses.map((pose) => ({
    phase: pose.phase,
    detail: "",
    referenceId: "upper80v2_P001_side",
  })),
});

describe("camera views are independent of left/right screen travel", () => {
  it("keeps a frontal character frontal by default and understands explicit camera requests", () => {
    expect(resolveCameraView("original", elf, "Wave hello")).toBe("front");
    expect(resolveCameraView("original", { view: "back" }, "walk right")).toBe(
      "back",
    );
    expect(resolveCameraView("front", { view: "side" }, "walk right")).toBe(
      "front",
    );
    expect(
      resolveCameraView(
        undefined,
        { view: "side" },
        "saluda de frente, mirando a la cámara",
      ),
    ).toBe("front");
    expect(resolveCameraView(undefined, elf, "de espaldas")).toBe("back");
    expect(resolveCameraView(undefined, elf, "three-quarter view")).toBe(
      "three_quarter",
    );
  });
  it("accepts every offered view at the API boundary", () => {
    for (const option of VIEW_OPTIONS)
      expect(
        CreateFlipbookRequestSchema.safeParse({
          imageId: "11111111-1111-4111-8111-111111111111",
          prompt: "Wave hello",
          view: option.value,
        }).success,
      ).toBe(true);
  });
  it.each([
    "front",
    "three_quarter",
    "side",
    "back",
    "high",
    "low",
  ] as CameraView[])(
    "locks %s into planning, reference preparation, drawing and repair",
    (view) => {
      const source = parseAnalysisOutput(JSON.stringify({ ...elf, view }));
      expect(resolveCameraView("original", source)).toBe(view);
      expect(decideReference(source).kind).toBe("original");
      const plan = parsePlanOutput(json, elf, "wave", undefined, view);
      expect(plan.view).toBe(view);
      const expected = cameraDescription(view, plan.direction);
      expect(referencePrompt(elf, plan.direction, 0, view)).toContain(expected);
      expect(
        posePrompt({ analysis: elf, plan, index: 0, hasNeighbor: false }),
      ).toContain(expected);
      expect(
        repairPrompt({
          analysis: elf,
          plan,
          index: 0,
          hasNeighbor: false,
          problems: [],
        }),
      ).toContain(expected);
      if (view !== "side") {
        expect(plan.poses[0].description).not.toContain("side view");
        expect(
          posePrompt({ analysis: elf, plan, index: 0, hasNeighbor: false }),
        ).not.toContain("View: strict side view");
        expect(
          repairPrompt({
            analysis: elf,
            plan,
            index: 0,
            hasNeighbor: false,
            problems: [],
          }),
        ).not.toContain("View: strict side view");
      }
    },
  );
  it("does not redraw a complete frontal source into a side profile", () => {
    expect(decideReference(elf).kind).toBe("original");
    expect(decideReference(elf, "side").kind).toBe("clean");
    expect(
      decideReference({ ...elf, feetVisible: false }, "front").reason,
    ).toContain("front view");
  });
  it("keeps the original resting posture for an idle without a catalog guide", () => {
    const idle: CharacterAnalysis = { ...elf, requestedAction: "idle" };
    const plan = parsePlanOutput(
      JSON.stringify({
        poses: ACTION_SPECS.idle.poses.map((pose) => ({
          phase: pose.phase,
          detail: "",
        })),
      }),
      idle,
      "idle",
      undefined,
      "front",
    );
    expect(plan.poseId).toBeUndefined();
    expect(
      plan.poses.every(
        (pose) =>
          pose.description.includes("natural resting posture") &&
          !pose.description.includes("standing"),
      ),
    ).toBe(true);
  });
  it("uses real guides in the selected view and never falls back to a side guide", () => {
    expect(compatiblePoseId("full_single_P061_side", "idle", "front")).toBe(
      "full_single_P061_front",
    );
    expect(
      compatiblePoseId("full_single_P061_side", "idle", "three_quarter"),
    ).toBe("full_single_P061_diag");
    expect(
      compatiblePoseId("full_single_P061_side", "idle", "back"),
    ).toBeUndefined();
    for (const view of ["front", "high", "low"] as const)
      for (const pose of poseCandidates("wave", view))
        expect(poseReferenceFor(pose.id).image.angle).toBe(view);
    expect(poseCandidates("wave", "back")).toEqual([]);
    expect(
      planJsonSchema("wave", "back").properties.poses.items.properties
        .referenceId,
    ).toEqual({ type: "null" });
    expect(planInstructions("wave", undefined, "back")).toContain(
      "facing away from the camera",
    );
  });
});
