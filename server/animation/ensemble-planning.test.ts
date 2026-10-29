import { describe, expect, it } from "vitest";
import type { CharacterAnalysis } from "../../shared/flipbook";
import {
  castLabel,
  ensembleCamera,
  ensembleInstructions,
  ensemblePlanSchema,
  ensemblePrompt,
  ensembleView,
  groupConcepts,
  mergeAnalyses,
  parseEnsembleOutput,
  type CastEntry,
} from "./ensemble-planning";

const analysis = (subject: string, palette: string[]): CharacterAnalysis => ({
  characterCount: 1, subject, facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
  style: "clean anime line art", hair: "short red hair", clothing: "blue jacket", accessories: [], palette, proportions: "big head", requestedAction: "walk",
});

const cast: CastEntry[] = [
  { name: "Elf-chan", versionName: "Winter", analysis: analysis("girl", ["#2E86DE", "#F1C27D"]) },
  { name: "Robo", versionName: "Base", analysis: analysis("robot", ["#2e86de", "#7f8c8d"]) },
];

const beats = (count: number) => JSON.stringify({ direction: "left", beats: Array.from({ length: count }, (_, index) => ({ title: `Move ${index + 1}`, description: `Character 1 steps toward Character 2, beat ${index + 1}.` })) });

describe("a scene plan", () => {
  it("needs exactly one beat per drawing: the duration at eight a second", () => {
    for (const seconds of [1, 2, 3, 6]) {
      const plan = parseEnsembleOutput(beats(seconds * 8), { seconds, view: "side" });
      expect(plan.action).toBe("ensemble");
      expect(plan.poses).toHaveLength(seconds * 8);
      expect(plan.durationSeconds).toBe(seconds);
      expect(plan.drawingFps).toBe(8);
      expect(plan.motion).toBe("in_place");
      expect(plan.poses.map((pose) => pose.phase).slice(0, 3)).toEqual(["beat_0", "beat_1", "beat_2"]);
      expect(plan.direction).toBe("left");
    }
    expect(() => parseEnsembleOutput(beats(15), { seconds: 2, view: "side" })).toThrowError(expect.objectContaining({ code: "pose_plan_invalid" }));
    expect(() => parseEnsembleOutput(beats(17), { seconds: 2, view: "side" })).toThrowError(expect.objectContaining({ code: "pose_plan_invalid" }));
    expect(() => parseEnsembleOutput("not json", { seconds: 2, view: "side" })).toThrowError(expect.objectContaining({ code: "pose_plan_invalid" }));
  });

  it("trims what the model sends and never leaves a drawing without an instruction", () => {
    const raw = JSON.stringify({ direction: "up", beats: Array.from({ length: 8 }, (_, index) => ({ title: index === 0 ? "T".repeat(80) : "", description: index === 1 ? "d".repeat(2000) : "" })) });
    const plan = parseEnsembleOutput(raw, { seconds: 1, view: "front" });
    expect(plan.view).toBe("front");
    expect(plan.direction).toBe("right");
    expect(plan.poses[0].label).toHaveLength(40);
    expect(plan.poses[1].description).toHaveLength(900);
    expect(plan.poses[2].label).toBe("Drawing 3");
    expect(plan.poses[2].description).toMatch(/Continue the action/);
  });

  it("asks Muse Spark for the length of the scene, the cast in order, and a locked camera", () => {
    const text = ensembleInstructions({ cast, seconds: 3, view: "side" });
    expect(text).toContain("exactly 24 drawings");
    expect(text).toContain("3 seconds");
    expect(text).toContain("1. Character 1 (Elf-chan)");
    expect(text).toContain("2. Character 2 (Robo)");
    expect(text).toContain(ensembleCamera("side"));
    const schema = ensemblePlanSchema();
    expect(schema.required).toEqual(["direction", "beats"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("defaults to a side-on camera, where bodies can reach each other", () => {
    expect(ensembleView(undefined)).toBe("side");
    expect(ensembleView("original")).toBe("side");
    expect(ensembleView("three_quarter")).toBe("three_quarter");
  });
});

describe("reading the whole cast", () => {
  it("keeps every character's colors in one palette, for a key color none of them uses", () => {
    const merged = mergeAnalyses(cast.map((entry) => entry.analysis!));
    expect(merged.characterCount).toBe(2);
    expect(merged.subject).toBe("character");
    expect(merged.palette).toEqual(["#2E86DE", "#F1C27D", "#7F8C8D"]);
  });

  it("looks for the generic concept first, then each character's own noun, once", () => {
    expect(groupConcepts(cast.map((entry) => entry.analysis))).toEqual(["character", "girl", "robot"]);
    expect(groupConcepts([analysis("character", []), null])).toEqual(["character"]);
  });
});

describe("a drawing of the scene", () => {
  const plan = parseEnsembleOutput(beats(16), { seconds: 2, view: "side" });
  const base = { cast, analysis: mergeAnalyses(cast.map((entry) => entry.analysis!)), plan, index: 4, scene: "they fight", hasNeighbor: false };

  it("puts every character in the same drawing, each from its own image", () => {
    const text = ensemblePrompt(base);
    expect(text).toContain("drawing 5 of 16");
    expect(text).toContain("they fight");
    expect(text).toContain("All 2 characters appear TOGETHER");
    expect(text).toContain(`Image 1 is ${castLabel(cast[0], 0)}`);
    expect(text).toContain(`Image 2 is ${castLabel(cast[1], 1)}`);
    expect(text).toContain("short red hair");
    expect(text).toContain("exactly 2 separate characters");
    expect(text).toContain("Character 1 steps toward Character 2, beat 5.");
    // A flat key color for the cut-out, and nothing that would be cut out with the characters.
    expect(text).toMatch(/flat uniform .*color filling the whole image/);
    expect(text).toContain("no impact effects");
    expect(text).toContain("same distance and angle in every drawing");
  });

  it("numbers the images that follow the cast: the drawing to repair, then the neighbor", () => {
    expect(ensemblePrompt({ ...base, hasNeighbor: true })).toContain("Image 3 is the neighboring drawing");
    const repair = ensemblePrompt({ ...base, hasNeighbor: true, repair: { problems: ["a missing arm"] } });
    expect(repair).toContain("Image 3 is the drawing to repair");
    expect(repair).toContain("Image 4 is the neighboring drawing");
    expect(repair).toContain("Problems found in Image 3: a missing arm");
    expect(repair).toContain("Each character's own reference image is the sole authority");
    expect(repair).toContain("Do NOT copy its pose or appearance errors");
    expect(ensemblePrompt({ ...base, note: "hit harder" })).toContain("Correction requested by the animator: hit harder");
  });
});
