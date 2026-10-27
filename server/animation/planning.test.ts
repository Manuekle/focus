import { describe, expect, it } from "vitest";
import { ACTION_SPECS, FIGHT_PHASES, RUN_PHASES, WALK_PHASES, WALK_POSES, type CharacterAnalysis } from "../../shared/flipbook";
import { assessInput, parseAnalysisOutput } from "./character-analysis";
import { decideReference } from "./reference-manager";
import { actionFor, keyColorFor, parsePlanOutput, planJsonSchema, posePrompt, referencePrompt } from "./pose-planning";
import { parseReview } from "./quality-control";

// Muse Spark output parsing and prompt building, on recorded-shape JSON.
// The shapes follow the strict schemas sent to the model; nothing is fetched.

const analysis: CharacterAnalysis = {
  characterCount: 1,
  subject: "girl",
  facing: "right",
  view: "side",
  fullBodyVisible: true,
  feetVisible: true,
  background: "plain",
  style: "clean anime line art, cel shading",
  hair: "short black bob, red clip on the left side",
  clothing: "yellow raincoat, blue boots",
  accessories: ["red backpack on her back"],
  palette: ["#f4d03f", "#2e86de", "#c0392b"],
  proportions: "about 5 heads tall",
  requestedAction: "walk",
};

const planJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  direction: "left",
  motion: "across",
  drawingFps: null,
  durationSeconds: 6,
  poses: WALK_PHASES.map((phase) => ({ phase, detail: phase === "left_passing" ? "The raincoat hem swings back." : "" })),
  ...overrides,
});

describe("character analysis", () => {
  it("parses strict output, trims long text and drops invalid colors", () => {
    const parsed = parseAnalysisOutput(JSON.stringify({ ...analysis, palette: ["#ffffff", "red", "#12345"], notes: null, style: "x".repeat(400), subject: "Girl" }));
    expect(parsed.palette).toEqual(["#ffffff"]);
    expect(parsed.style.length).toBe(240);
    expect(parsed.subject).toBe("girl");
    expect(parsed.notes).toBeUndefined();
  });

  it("falls back to a safe SAM concept and rejects unreadable output", () => {
    expect(parseAnalysisOutput(JSON.stringify({ ...analysis, subject: "Segment the girl, please!" })).subject).toBe("character");
    expect(() => parseAnalysisOutput("not json")).toThrow(/unreadable/);
    expect(() => parseAnalysisOutput(JSON.stringify({ ...analysis, view: "isometric" }))).toThrow();
  });

  it("supports walks only, and says what may make a result unreliable", () => {
    expect(assessInput(analysis)).toEqual({ supported: true, reason: null, warnings: [] });
    expect(assessInput({ ...analysis, requestedAction: "jump" }).supported).toBe(false);
    expect(assessInput({ ...analysis, characterCount: 0 }).supported).toBe(false);
    const risky = assessInput({ ...analysis, view: "front", feetVisible: false, characterCount: 2, notes: "n".repeat(320) });
    expect(risky.supported).toBe(true);
    expect(risky.warnings.length).toBeGreaterThanOrEqual(3);
    expect(risky.warnings.every((warning) => warning.length <= 240)).toBe(true);
  });

  it("keeps a usable side view as the reference and redraws only when needed", () => {
    expect(decideReference(analysis).kind).toBe("original");
    expect(decideReference({ ...analysis, view: "three_quarter" }).kind).toBe("clean");
    expect(decideReference({ ...analysis, feetVisible: false }).kind).toBe("clean");
    expect(decideReference({ ...analysis, background: "detailed" }).kind).toBe("clean");
  });
});

describe("pose plan", () => {
  it("merges Muse Spark's detail into the fixed walk library", () => {
    const plan = parsePlanOutput(planJson(), analysis);
    expect(plan.direction).toBe("left");
    expect(plan.motion).toBe("left");
    expect(plan.drawingFps).toBe(8);
    expect(plan.durationSeconds).toBe(6);
    expect(plan.poses.map((pose) => pose.phase)).toEqual([...WALK_PHASES]);
    expect(plan.poses[2].description).toBe(`${WALK_POSES[2].constraints} The raincoat hem swings back.`);
    expect(plan.poses[0].description).toBe(WALK_POSES[0].constraints);
    expect(plan.poses.map((pose) => pose.relativeRootY)).toEqual(WALK_POSES.map((pose) => pose.relativeRootY));
  });

  it("refuses a plan that reorders, drops or invents a phase", () => {
    const shuffled = WALK_PHASES.map((phase) => ({ phase, detail: "" })).reverse();
    expect(() => parsePlanOutput(planJson({ poses: shuffled }), analysis)).toThrow(/eight walk cycle phases/);
    expect(() => parsePlanOutput(planJson({ poses: shuffled.slice(1) }), analysis)).toThrow(/eight walk cycle phases/);
    expect(() => parsePlanOutput("{", analysis)).toThrow(/unreadable/);
  });

  it("walks in place unless the instruction travels, facing the character's way by default", () => {
    const plan = parsePlanOutput(planJson({ motion: "in_place", direction: "sideways" }), { ...analysis, facing: "left" });
    expect(plan.motion).toBe("in_place");
    expect(plan.direction).toBe("left");
  });
});

describe("drawing prompts", () => {
  it("repeat the identity lock, the side view and the flat key background in every pose", () => {
    const plan = parsePlanOutput(planJson(), analysis);
    const prompts = plan.poses.map((_pose, index) => posePrompt({ analysis, plan, index, hasNeighbor: false }));
    for (const [index, prompt] of prompts.entries()) {
      expect(prompt).toContain("Image 1");
      expect(prompt).toContain(analysis.clothing);
      expect(prompt).toContain("red clip on the left side");
      expect(prompt).toContain("never mirror");
      expect(prompt).toContain("facing left");
      expect(prompt).toContain(plan.poses[index].description);
      expect(prompt).toContain("pure white (#FFFFFF)");
      expect(prompt).not.toContain("Image 2");
    }
    expect(new Set(prompts).size).toBe(8);
    const redraw = posePrompt({ analysis, plan, index: 3, hasNeighbor: true, note: "lift the back heel" });
    expect(redraw).toContain("do NOT copy its pose");
    expect(redraw).toContain("lift the back heel");
    expect(referencePrompt(analysis, "right")).toContain("strict side view (profile), facing right");
  });

  it("picks a key color away from the character's own colors", () => {
    expect(keyColorFor(analysis).hex).toBe("#FFFFFF");
    expect(keyColorFor({ ...analysis, palette: ["#fafafa", "#f0f0f0"] }).hex).not.toBe("#FFFFFF");
    expect(keyColorFor(null).hex).toBe("#FFFFFF");
  });
});

describe("AI review parsing", () => {
  it("keeps only real frames and known issue codes", () => {
    const review = parseReview(JSON.stringify({
      summary: "Frame 3 faces the wrong way.",
      recognizableWalk: false,
      frames: [
        { frame: 3, ok: false, issues: [{ code: "wrong_facing", note: "faces left" }, { code: "made_up", note: "?" }] },
        { frame: 3, ok: true, issues: [] },
        { frame: 9, ok: false, issues: [{ code: "cropped", note: "out of range" }] },
        { frame: 1, ok: true, issues: [] },
      ],
    }), 8);
    expect(review.recognizableWalk).toBe(false);
    expect([...review.frames.keys()].sort()).toEqual([0, 2]);
    expect(review.frames.get(2)).toEqual({ ok: false, issues: [{ code: "wrong_facing", note: "faces left" }] });
    expect(() => parseReview("nope", 8)).toThrow();
  });
});

describe("run and fight", () => {
  const phasesJson = (phases: readonly string[], overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ direction: "right", motion: "across", drawingFps: null, durationSeconds: null, poses: phases.map((phase) => ({ phase, detail: "" })), ...overrides });

  it("picks the action from the analysis; anything else stays a walk", () => {
    expect(actionFor({ requestedAction: "run" })).toBe("run");
    expect(actionFor({ requestedAction: "fight" })).toBe("fight");
    expect(actionFor({ requestedAction: "none" })).toBe("walk");
    expect(actionFor({ requestedAction: "walk" })).toBe("walk");
  });

  it("supports running and fighting, and says two characters can't fight each other yet", () => {
    expect(assessInput({ ...analysis, requestedAction: "run" }).supported).toBe(true);
    expect(assessInput({ ...analysis, requestedAction: "fight" }).supported).toBe(true);
    const duel = assessInput({ ...analysis, requestedAction: "fight", characterCount: 2 });
    expect(duel.supported).toBe(true);
    expect(duel.warnings.join(" ")).toMatch(/fighting each other isn’t supported/);
    expect(assessInput({ ...analysis, requestedAction: "dance" }).supported).toBe(false);
  });

  it("plans a run with a flight phase, faster by default, able to travel", () => {
    const plan = parsePlanOutput(phasesJson(RUN_PHASES), { ...analysis, requestedAction: "run" });
    expect(plan.action).toBe("run");
    expect(plan.motion).toBe("right");
    expect(plan.drawingFps).toBe(12);
    expect(plan.poses.map((pose) => pose.phase)).toEqual([...RUN_PHASES]);
    expect(plan.poses.filter((pose) => pose.lift > 0).map((pose) => pose.phase)).toEqual(["left_float", "right_float"]);
    expect(() => parsePlanOutput(phasesJson(WALK_PHASES), { ...analysis, requestedAction: "run" })).toThrow(/run cycle phases/);
  });

  it("plans a fighting combo that always stays in place", () => {
    const plan = parsePlanOutput(phasesJson(FIGHT_PHASES), { ...analysis, requestedAction: "fight" });
    expect(plan.action).toBe("fight");
    expect(plan.motion).toBe("in_place");
    expect(plan.poses.map((pose) => pose.phase)).toEqual([...FIGHT_PHASES]);
    expect(ACTION_SPECS.fight.travels).toBe(false);
  });

  it("asks Muse Spark only for the action's own phases, and draws one fighter with no opponent", () => {
    const schema = planJsonSchema("fight") as unknown as { properties: { poses: { items: { properties: { phase: { enum: string[] } } } } } };
    expect(schema.properties.poses.items.properties.phase.enum).toEqual([...FIGHT_PHASES]);
    const plan = parsePlanOutput(phasesJson(FIGHT_PHASES), { ...analysis, requestedAction: "fight" });
    const prompt = posePrompt({ analysis, plan, index: 2, hasNeighbor: false });
    expect(prompt).toContain("fighting combo");
    expect(prompt).toContain("no opponent");
    expect(prompt).toContain("fully extended straight forward");
    const run = parsePlanOutput(phasesJson(RUN_PHASES), { ...analysis, requestedAction: "run" });
    expect(posePrompt({ analysis, plan: run, index: 3, hasNeighbor: false })).toContain("both feet are off the ground");
  });
});
