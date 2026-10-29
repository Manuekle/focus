import { describe, expect, it } from "vitest";
import { ACTION_SPECS, FIGHT_PHASES, RUN_PHASES, WALK_PHASES, WALK_POSES, type CharacterAnalysis } from "../../shared/flipbook";
import { LOOK_INSTRUCTIONS, LOOK_JSON_SCHEMA, assessInput, parseAnalysisOutput, parseLookOutput } from "./character-analysis";
import { decideReference, depthLayers } from "./reference-manager";
import sharp from "sharp";
import { defaultMotion } from "./flipbooks";
import { actionFor, keyColorFor, parsePlanOutput, planInstructions, planJsonSchema, posePrompt, referencePrompt, repairPrompt } from "./pose-planning";
import { parseReview } from "./quality-control";
import { poseCandidates, poseReferenceFor } from "./pose-catalog";
import { CreateFlipbookRequestSchema, FlipbookPlanSchema } from "../../shared/flipbook";

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

  it("supports the actions it can animate, and says what may make a result unreliable", () => {
    expect(assessInput(analysis)).toEqual({ supported: true, reason: null, warnings: [] });
    expect(assessInput({ ...analysis, requestedAction: "dance" }).supported).toBe(true);
    expect(assessInput({ ...analysis, characterCount: 0 }).supported).toBe(false);
    const risky = assessInput({ ...analysis, view: "front", feetVisible: false, characterCount: 2, notes: "n".repeat(320) });
    expect(risky.supported).toBe(true);
    expect(risky.warnings.length).toBeGreaterThanOrEqual(3);
    expect(risky.warnings.every((warning) => warning.length <= 240)).toBe(true);
  });

  it("lets video samples define unclassified movement without bypassing character validation", () => {
    for (const requestedAction of ["other", "gesture"] as const) {
      const seen = { ...analysis, requestedAction };
      expect(assessInput(seen).supported).toBe(false);
      expect(assessInput(seen, { fromVideo: true }).supported).toBe(true);
      expect(assessInput({ ...seen, characterCount: 0 }, { fromVideo: true }).supported).toBe(false);
      expect(assessInput({ ...seen, feetVisible: false }, { fromVideo: true }).warnings).toContain("The full body isn’t visible. Unseen parts (like legs or feet) will be invented, so they may not match your design.");
    }
  });

  it("keeps a usable original camera view and redraws only when needed", () => {
    expect(decideReference(analysis).kind).toBe("original");
    expect(decideReference({ ...analysis, view: "three_quarter" }).kind).toBe("original");
    expect(decideReference({ ...analysis, view: "front" }).kind).toBe("original");
    expect(decideReference(analysis, "front").kind).toBe("clean");
    expect(decideReference({ ...analysis, feetVisible: false }).kind).toBe("clean");
    expect(decideReference({ ...analysis, background: "detailed" }).kind).toBe("clean");
  });
});

describe("pose plan", () => {
  it("selects an idle posture internally and normalizes its angle without changing phases", () => {
    const seen = { ...analysis, requestedAction: "idle" as const };
    const plan = parsePlanOutput(planJson({ poseId: "full_single_P061_front", poses: ACTION_SPECS.idle.poses.map((pose) => ({ phase: pose.phase, detail: "", referenceId: "upper80v2_P001_side" })) }), seen);
    expect(plan.poseId).toBe("full_single_P061_side");
    expect(plan.poses.every((pose) => pose.referenceId === plan.poseId && pose.description.includes("Crouching low"))).toBe(true);
    expect(plan.motion).toBe("in_place");
    expect(planInstructions("idle")).not.toContain("Standing at ease");
  });

  it("uses compatible guides per phase while rejecting unknown, paired and seated walk references", () => {
    const references = ["upper80v2_P001_front", "full_single_P041_side", "pair60_P001_side", "https://example.com/pose.png"];
    const plan = parsePlanOutput(planJson({ poseId: "full_single_P061_side", poses: WALK_PHASES.map((phase, index) => ({ phase, detail: "", referenceId: references[index] ?? null })) }), analysis);
    expect(plan.poseId).toBeUndefined();
    expect(plan.poses[0].referenceId).toBe("upper80v2_P001_side");
    expect(plan.poses.slice(1).every((pose) => !pose.referenceId)).toBe(true);
    expect(plan.poses[0].description).toBe(WALK_POSES[0].constraints);
    expect(plan.motion).toBe("left");
  });

  it("keeps each gallery posture throughout all eight idle phases and bounds the request", () => {
    const seen = { ...analysis, requestedAction: "idle" as const };
    const json = planJson({ motion: "in_place", poses: ACTION_SPECS.idle.poses.map((pose) => ({ phase: pose.phase, detail: "The scarf settles." })) });
    for (const candidate of poseCandidates()) {
      const selected = { ...poseReferenceFor(candidate.id), id: candidate.id };
      const plan = parsePlanOutput(json, seen, "idle", selected.id);
      expect(plan.poseId).toBe(selected.id);
      expect(plan.poses.map((pose) => pose.phase)).toEqual(ACTION_SPECS.idle.poses.map((pose) => pose.phase));
      for (const pose of plan.poses) {
        expect(pose.description).toContain(selected.description);
        expect(pose.description).toContain("same support points");
        expect(pose.relativeRootY).toBe(0);
        expect(pose.lift).toBe(0);
      }
      expect(planInstructions("idle", selected.id)).toContain(selected.description);
      expect(FlipbookPlanSchema.safeParse({ ...plan, motion: "right" }).success).toBe(false);
      expect(FlipbookPlanSchema.safeParse({ ...plan, action: "walk" }).success).toBe(false);
    }
    const request = { imageId: "aa16bf53-7f3e-4c71-883d-b1f03c9b07e4", prompt: "Breathe in the pose", poseId: poseCandidates()[0].id };
    expect(CreateFlipbookRequestSchema.safeParse(request).success).toBe(true);
    expect(CreateFlipbookRequestSchema.safeParse({ ...request, poseId: "../../secret" }).success).toBe(false);
    expect(CreateFlipbookRequestSchema.safeParse({ ...request, action: "walk" }).success).toBe(false);
    expect(CreateFlipbookRequestSchema.safeParse({ imageId: request.imageId, prompt: "walk" }).success).toBe(true);
  });

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

  it("names extra reference images, and a repair keeps the anchor first and the drawing to fix second", () => {
    const plan = parsePlanOutput(planJson(), analysis);
    const withExtras = posePrompt({ analysis, plan, index: 1, hasNeighbor: true, extraCount: 2 });
    expect(withExtras).toContain("Images 3 to 4 are extra references");
    expect(posePrompt({ analysis, plan, index: 1, hasNeighbor: false, extraCount: 1 })).toContain("Image 2 is extra reference");
    expect(posePrompt({ analysis, plan, index: 1, hasNeighbor: false })).not.toContain("extra reference");
    expect(referencePrompt(analysis, "right", 1)).toContain("Image 2 is extra reference");

    const repair = repairPrompt({ analysis, plan, index: 2, hasNeighbor: true, extraCount: 1, problems: ["Extra limb: three legs."], note: "fix the hands" });
    expect(repair).toContain("Image 1");
    expect(repair).toContain("Image 2 is a drawing");
    expect(repair).toContain("Image 3 is the neighboring drawing");
    expect(repair).toContain("Image 4 is extra reference");
    expect(repair).toContain("Extra limb: three legs.");
    expect(repair).toContain("fix the hands");
    expect(repair).toContain(plan.poses[2].description);
    expect(repairPrompt({ analysis, plan, index: 2, hasNeighbor: false, problems: [] })).toContain("look for anatomy and identity mistakes");
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
    expect(assessInput({ ...analysis, requestedAction: "dance" }).supported).toBe(true);
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

describe("reading an upload", () => {
  const character = {
    characterCount: 1, subject: "girl", facing: "right", view: "three_quarter", fullBodyVisible: true, feetVisible: true, background: "detailed",
    style: "anime", hair: "white", clothing: "track suit", accessories: [], palette: ["#ffffff"], proportions: "tall", notes: null,
  };

  it("asks for the character facts, the picture and ideas, but no action", () => {
    expect(LOOK_JSON_SCHEMA.required).not.toContain("requestedAction");
    expect(LOOK_JSON_SCHEMA.required).toEqual(expect.arrayContaining(["subject", "summary", "setting", "ideas"]));
    expect(LOOK_INSTRUCTIONS).not.toContain("requestedAction");
    expect(LOOK_INSTRUCTIONS).toContain("- subject:");
    expect(LOOK_INSTRUCTIONS).toContain("- ideas:");
  });

  it("keeps only motions Focus can animate, and never fights in place", () => {
    const reading = parseLookOutput(JSON.stringify({
      ...character,
      summary: "A girl running through falling leaves.",
      setting: "blue sky with leaves",
      ideas: [
        { action: "run", direction: "right", detail: "hair and tail flowing." },
        { action: "fight", direction: "in_place", detail: "light on her feet" },
        { action: "dance", direction: "left", detail: "twirling" },
        { action: "walk", direction: "left", detail: "calm" },
        { action: "walk", direction: "right", detail: "a fourth one" },
      ],
    }));
    expect(reading.analysis.requestedAction).toBe("none");
    expect(reading.analysis.subject).toBe("girl");
    expect(reading.setting).toBe("blue sky with leaves");
    expect(reading.ideas).toEqual([
      { action: "run", direction: "right", detail: "hair and tail flowing" },
      { action: "fight", direction: "right", detail: "light on her feet" },
      { action: "dance", direction: "left", detail: "twirling" },
    ]);
  });

  it("has no setting on a plain background", () => {
    const reading = parseLookOutput(JSON.stringify({ ...character, background: "plain", summary: "A girl.", setting: "white", ideas: [] }));
    expect(reading.setting).toBeNull();
  });
});

describe("jump, wave and idle", () => {
  it("plans a two-second dance cycle that repeats for a 20-second export", () => {
    const dancing = { ...analysis, requestedAction: "dance" as const };
    const poses = ACTION_SPECS.dance.poses.map((pose) => ({ phase: pose.phase, detail: "" }));
    const plan = parsePlanOutput(JSON.stringify({ direction: "right", motion: "across", drawingFps: 4, durationSeconds: 20, poses }), dancing);
    expect(plan).toMatchObject({ action: "dance", motion: "in_place", drawingFps: 4, durationSeconds: 20 });
    expect(plan.poses).toHaveLength(8);
    expect(planInstructions("dance")).toContain("rate of KEY POSES, not the output frame rate");
    expect(plan.poses.map((pose) => pose.description).join(" ")).toContain("cycle closes smoothly");
  });

  const base = { ...analysis, requestedAction: "none" as const };

  it("are chosen from the instruction and stay on the spot", () => {
    for (const action of ["jump", "wave", "idle", "dance"] as const) {
      const seen = { ...base, requestedAction: action };
      expect(actionFor(seen)).toBe(action);
      expect(assessInput(seen).supported).toBe(true);
      const phases = ACTION_SPECS[action].poses.map((pose) => pose.phase);
      const plan = parsePlanOutput(JSON.stringify({ direction: "left", motion: "across", drawingFps: null, durationSeconds: null, poses: phases.map((phase) => ({ phase, detail: "" })) }), seen);
      expect(plan.action).toBe(action);
      expect(plan.motion).toBe("in_place");
      expect(plan.drawingFps).toBe(ACTION_SPECS[action].drawingFps);
      expect(planInstructions(action)).toContain("always \"in_place\"");
      const prompt = posePrompt({ analysis: seen, plan, index: 0, hasNeighbor: false });
      expect(prompt).not.toContain("opponent");
      expect(prompt).toContain("staying on the spot");
    }
    expect(actionFor({ requestedAction: "dance" })).toBe("dance");
    expect(assessInput({ ...base, requestedAction: "dance" }).supported).toBe(true);
  });

  it("are suggested from a reading, facing a side rather than in place", () => {
    const reading = parseLookOutput(JSON.stringify({
      characterCount: 1, subject: "girl", facing: "left", view: "front", fullBodyVisible: true, feetVisible: true, background: "plain",
      style: "anime", hair: "white", clothing: "dress", accessories: [], palette: [], proportions: "tall", notes: null,
      summary: "A smiling girl.", setting: null,
      ideas: [{ action: "wave", direction: "in_place", detail: "shy" }, { action: "idle", direction: "right", detail: "calm" }],
    }));
    expect(reading.ideas).toEqual([{ action: "wave", direction: "left", detail: "shy" }, { action: "idle", direction: "right", detail: "calm" }]);
  });
});

describe("scene depth", () => {
  it("splits the sky from the rest and fills the sky behind what stood in front of it", async () => {
    const width = 20, height = 10;
    const rgb = Buffer.alloc(width * height * 3);
    const sky = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const isSky = y < 6 && !(x >= 7 && x <= 14 && y >= 2);
      const color = isSky ? [100, 150, 250] : [40, 160, 60];
      rgb.set(color, index * 3);
      sky[index] = isSky ? 255 : 0;
    }
    const layers = (await depthLayers(rgb, width, height, sky))!;
    const far = await sharp(layers.far).raw().toBuffer();
    const near = await sharp(layers.near).raw().toBuffer();
    // The tree's pixel in the sky band shows sky in the far layer; the ground band takes the nearest sky row.
    expect([...far.subarray((4 * width + 10) * 3, (4 * width + 10) * 3 + 3)]).toEqual([100, 150, 250]);
    expect([...far.subarray((9 * width + 2) * 3, (9 * width + 2) * 3 + 3)]).toEqual([100, 150, 250]);
    // The near layer is see-through where the sky was, solid elsewhere.
    expect(near[(1 * width + 1) * 4 + 3]).toBe(0);
    expect(near[(4 * width + 10) * 4 + 3]).toBe(255);
    expect(near[(9 * width + 2) * 4 + 3]).toBe(255);
    // The sky's edge is grown into its neighbors, so a cloud's anti-aliased rim doesn't stay in front.
    expect(near[(7 * width + 2) * 4 + 3]).toBe(0);
    // All sky, or almost none: nothing to separate.
    expect(await depthLayers(rgb, width, height, new Uint8Array(width * height).fill(255))).toBeNull();
    expect(await depthLayers(rgb, width, height, new Uint8Array(width * height))).toBeNull();
  });

  it("picks how a separated scene moves from the motion", () => {
    expect(defaultMotion({ action: "walk", motion: "in_place" }, true)).toBe("parallax");
    expect(defaultMotion({ action: "run", motion: "in_place" }, false)).toBe("scroll");
    expect(defaultMotion({ action: "walk", motion: "right" }, true)).toBe("static");
    for (const action of ["jump", "wave", "idle", "fight"] as const) expect(defaultMotion({ action, motion: "in_place" }, true)).toBe("zoom");
  });
});
