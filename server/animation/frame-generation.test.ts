import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_SPECS, type CharacterAnalysis } from "../../shared/flipbook";
import { drawEnsembleFrame, drawInbetween, drawPose } from "./frame-generation";
import { generateImage } from "./muse-image";
import { parsePlanOutput } from "./pose-planning";
import { planWaveSequence } from "./wave-sequence";

vi.mock("./muse-image", () => ({ generateImage: vi.fn().mockResolvedValue({ png: Buffer.from("drawn"), width: 1024, height: 1536 }) }));
const analysis: CharacterAnalysis = {
  characterCount: 1, subject: "robot", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
  style: "flat vector", hair: "none", clothing: "red shell", accessories: ["blue patch on left arm"], palette: ["#ff0000"], proportions: "short legs", requestedAction: "idle",
};
const json = JSON.stringify({ direction: "left", motion: "in_place", poses: ACTION_SPECS.idle.poses.map((pose) => ({ phase: pose.phase, detail: "" })) });
const plan = parsePlanOutput(json, analysis, "idle", "full_single_P041_side");
const anchor = Buffer.from("character");
const mannequin = Buffer.from("pose");

beforeEach(() => vi.mocked(generateImage).mockClear());

it("draws distinct temporal positions from the same two keys and identity", async () => {
  const from = Buffer.from("before"), to = Buffer.from("after");
  for (const [position, progress] of [[1 / 3, "33.3%"], [2 / 3, "66.7%"]] as const) {
    await drawInbetween({ reference: anchor, from, to, analysis, plan, fromIndex: 0, toIndex: 1, position, flipbookId: "test" });
    const request = vi.mocked(generateImage).mock.lastCall![0];
    expect(request.references.map((entry) => entry.png)).toEqual([anchor, from, to]);
    expect(request.prompt).toContain(`exactly ${progress} of the way from Image 2 to Image 3`);
    expect(request.prompt).toContain("swing along arcs from their joints");
  }
});

it("draws a sequence transition from its two bounding keys at the exact clip time", async () => {
  const wave = planWaveSequence({ durationSeconds: 4, drawingFps: 12 }, "front", "wave");
  const from = Buffer.from("hand down"), to = Buffer.from("hand halfway up");
  await drawPose({ reference: anchor, neighbor: Buffer.from("unrelated previous pose"), analysis, plan: wave, index: 2, note: "Keep the hand below the waist",
    temporalPair: { from, to, fromIndex: 0, toIndex: 6, position: 1 / 3 }, flipbookId: "test" });
  const request = vi.mocked(generateImage).mock.lastCall![0];
  expect(request.references.map((entry) => entry.png)).toEqual([anchor, from, to]);
  expect(request.prompt).toContain("exactly 33.3% of the way from Image 2 to Image 3");
  expect(request.prompt).toContain(`Exact time: ${2 / 12} s`);
  expect(request.prompt).toContain("Only the specified waving arm moves");
  expect(request.prompt).toContain("Animator's correction for this intermediate: Keep the hand below the waist");
  expect(request.prompt).toContain("Image 1 is the sole authority for garment colors");
  expect(request.prompt).toContain("Never blend or interpolate garment colors between the keys");
  expect(request.references[1].role).toContain("never a color authority");
});

it("keeps garment colors anchored during drawing, sequence repair and in-between generation", async () => {
  const wave = planWaveSequence({ durationSeconds: 4, drawingFps: 12 }, "front", "wave");
  const neighbor = Buffer.from("neighbor with an incorrectly brightened shirt");
  for (const selectedPlan of [plan, wave]) for (const repair of [null, { png: Buffer.from("repair"), problems: ["shirt changed color"] }]) {
    await drawPose({ reference: anchor, neighbor, repair, analysis, plan: selectedPlan, index: 1, flipbookId: "test" });
    const request = vi.mocked(generateImage).mock.lastCall![0];
    expect(request.references[0].png).toBe(anchor);
    expect(request.prompt).toContain("Image 1 is the sole authority for garment colors");
    expect(request.prompt).toContain("Any appearance difference in a generated drawing is an error");
    expect(request.references.find((entry) => entry.png === neighbor)?.role).toContain("Image 1 controls colors");
    expect(request.prompt).not.toMatch(/match its size, line weight and colors/);
  }
  await drawInbetween({ reference: anchor, from: neighbor, to: neighbor, analysis, plan, fromIndex: 0, toIndex: 1, flipbookId: "test" });
  const request = vi.mocked(generateImage).mock.lastCall![0];
  expect(request.prompt).toContain("Image 1 is the sole authority for garment colors");
  expect(request.prompt).not.toContain("line weight, colors, shading, the camera");
});

it("carries anatomy, support, timing and immutable design requirements through every generation path", async () => {
  const wave = planWaveSequence({ durationSeconds: 4, drawingFps: 24 }, "front", "wave");
  for (const selected of [plan, wave]) for (const repair of [null, { png: anchor, problems: ["pose held too long"] }]) {
    await drawPose({ reference: anchor, neighbor: anchor, repair, analysis, plan: selected, index: 2, flipbookId: "test" });
  }
  await drawInbetween({ reference: anchor, from: anchor, to: anchor, analysis, plan, fromIndex: 0, toIndex: 1, flipbookId: "test" });
  await drawEnsembleFrame({ cast: [{ name: "Robot", versionName: "Original", analysis, png: anchor }], neighbor: anchor, analysis, plan, index: 1, scene: "Wave together", flipbookId: "test" });
  for (const [request] of vi.mocked(generateImage).mock.calls) {
    expect(request.prompt).toContain("125 ms");
    expect(request.prompt).toContain("A planted contact stays fixed");
    expect(request.prompt).toContain("Preserve bone lengths");
    expect(request.prompt).toContain("keep the established pose and occlusion");
    expect(request.prompt).toContain("do not add whole-body wobble or line jitter");
  }
});

it("guides whole-body sequence intermediates with both keys and the video's exact-time pose", async () => {
  const sequence = { ...planWaveSequence({ durationSeconds: 1, drawingFps: 24 }, "front", "wave"), action: "dance" as const };
  const guide = Buffer.from("motion reference at this time");
  await drawPose({ reference: anchor, neighbor: null, analysis, plan: sequence, index: 2, motionGuide: guide,
    temporalPair: { from: Buffer.from("start key"), to: Buffer.from("next key"), fromIndex: 0, toIndex: 6, position: 1 / 3 }, flipbookId: "test" });
  const request = vi.mocked(generateImage).mock.lastCall![0];
  expect(request.references.at(-1)?.png).toBe(guide);
  expect(request.references.at(-1)?.role).toContain("posture and support only");
  expect(request.prompt).toContain("Interpolate the specified moving joints");
  expect(request.prompt).toContain("Previous planned pose (sample_1)");
  expect(request.prompt).toContain("Next planned pose (sample_3)");
  expect(request.prompt).not.toContain("Only the specified waving arm moves");
});

describe("pose reference roles", () => {
  it("keeps the original identity portrait beside the selected outfit when animating a saved character", async () => {
    const original = Buffer.from("elf-chan original");
    await drawPose({ reference: anchor, identityReference: original, neighbor: null, analysis, plan, index: 0, flipbookId: "test" });
    const request = vi.mocked(generateImage).mock.lastCall![0];
    expect(request.references[0].png).toBe(anchor);
    expect(request.references[1].png).toBe(original);
    expect(request.references[1].role).toContain("Ignore its clothing and pose");
  });
  it("keeps the character first and mannequin last for generation and repair", async () => {
    for (const repair of [null, { png: Buffer.from("repair"), problems: ["fix the hand"] }]) {
      await drawPose({ reference: anchor, neighbor: Buffer.from("neighbor"), extras: [Buffer.from("extra")], repair, poseReference: mannequin, analysis, plan, index: 3, flipbookId: "test" });
      const request = vi.mocked(generateImage).mock.lastCall![0];
      expect(request.references[0].png).toBe(anchor);
      expect(request.references.at(-1)?.png).toBe(mannequin);
      expect(request.prompt).toContain(`Image ${repair ? 5 : 4} is a mannequin pose reference`);
      expect(request.prompt).toContain(`Image ${repair ? 4 : 3} is extra reference`);
      expect(request.prompt).toContain("Never copy its gray body");
      expect(request.prompt).toContain("blue patch on left arm");
      expect(request.prompt).toContain("Seated on folded legs");
      expect(request.prompt).not.toContain("feet near the bottom");
      expect(request.prompt).toContain("facing left");
    }
  });

  it("does not silently draw without the selected mannequin reference", async () => {
    await expect(drawPose({ reference: anchor, neighbor: null, analysis, plan, requirePoseReference: true, index: 0, flipbookId: "test" })).rejects.toMatchObject({ code: "pose_unavailable" });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("uses a phase guide without replacing the walk mechanics or cropping to its upper body", async () => {
    const walking = parsePlanOutput(JSON.stringify({ direction: "right", motion: "across", poses: ACTION_SPECS.walk.poses.map((pose) => ({ phase: pose.phase, detail: "", referenceId: "upper80v2_P001_side" })) }), { ...analysis, requestedAction: "walk" });
    await drawPose({ reference: anchor, neighbor: null, poseReference: mannequin, analysis, plan: walking, index: 1, flipbookId: "test" });
    const request = vi.mocked(generateImage).mock.lastCall![0];
    expect(request.references).toHaveLength(2);
    expect(request.prompt).toContain("phase's mechanics and movement take priority");
    expect(request.prompt).toContain("upper-body guide only");
    expect(request.prompt).toContain(walking.poses[1].description);
    expect(request.prompt).toContain("soles of both feet");
  });

  it("can draw from the posture description when an automatic guide is unavailable", async () => {
    await drawPose({ reference: anchor, neighbor: null, analysis, plan, index: 0, flipbookId: "test" });
    const request = vi.mocked(generateImage).mock.lastCall![0];
    expect(request.references).toHaveLength(1);
    expect(request.prompt).toContain("Seated on folded legs");
    expect(request.prompt).not.toContain("Image 2");
  });
});
