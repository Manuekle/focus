import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_SPECS, type CharacterAnalysis } from "../../shared/flipbook";
import { drawPose } from "./frame-generation";
import { generateImage } from "./muse-image";
import { parsePlanOutput } from "./pose-planning";

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

describe("pose reference roles", () => {
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
