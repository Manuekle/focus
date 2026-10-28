import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACTION_SPECS, type CharacterAnalysis, type Flipbook, type FlipbookStatus } from "../../shared/flipbook";
import { applyPlaybackPatch, costLine, describePlaybackPatch, FlipbookChatRequestSchema, ApplyPoseChangesRequestSchema } from "../../shared/flipbook-chat";
import { AppError } from "../errors";
import { DRIFT, walkerPng } from "./__fixtures__/walker";
import { chatContext, chatInstructions, chatJsonSchema, chatServices, parseChatOutput, proposeChange } from "./chat";
import { applyFrameAction, applyPoseChanges, createFlipbook, services } from "./flipbooks";
import { segmentation } from "./frame-alignment";
import { ingestCharacterImage } from "./image-input";
import { actionFor, parsePlanOutput } from "./pose-planning";
import { getFlipbook } from "./store";

// The Flipbook chat with Muse Spark and Muse Image replaced by fakes: the
// model returns fixed JSON, drawings are the fixture walker. No network,
// no credits. A proposal never draws; only applying does.

let work: string;
let imageId: string;

const analysis: CharacterAnalysis = {
  characterCount: 1, subject: "walker", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
  style: "flat vector, no outlines", hair: "short red cap of hair", clothing: "blue shirt, dark trousers, black shoes", accessories: [],
  palette: ["#2e86de", "#34495e", "#c0392b", "#f1c27d"], proportions: "big round head, long legs", requestedAction: "walk",
};

const calls = { draw: 0, drawIndices: [] as number[], complete: [] as { instructions: string; input: string }[] };
let modelText = "";
let drawGate: Promise<void> | null = null;

async function waitFor(id: string, statuses: readonly FlipbookStatus[], timeoutMs = 45_000): Promise<Flipbook> {
  const started = Date.now();
  for (;;) {
    const flipbook = await getFlipbook(id);
    if (statuses.includes(flipbook.status)) return flipbook;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out in ${flipbook.status}: ${JSON.stringify(flipbook.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

const turn = (value: Record<string, unknown>) =>
  JSON.stringify({
    reply: "Done.",
    action: "propose",
    poses: [],
    playback: { drawingFps: null, speed: null, durationSeconds: null, motion: null },
    ...value,
  });

const playback = (value: Record<string, unknown>) => ({ drawingFps: null, speed: null, durationSeconds: null, motion: null, ...value });

/** A fresh, finished walk with its eight drawings. */
async function walk(): Promise<Flipbook> {
  const created = await createFlipbook({ imageId, prompt: "walk in place" });
  return waitFor(created.id, ["ready", "failed"]);
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-flipbook-chat-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  segmentation.segment = null;
  const image = await ingestCharacterImage({ body: Readable.toWeb(Readable.from(await walkerPng("left_passing"))) as ReadableStream<Uint8Array>, fileName: "walker.png" });
  imageId = image.id;

  services.analyze = async () => analysis;
  services.poseReference = async () => Buffer.from("mannequin reference");
  services.plan = async ({ analysis: seen, poseId }) => {
    const phases = ACTION_SPECS[actionFor(seen)].poses.map((pose) => pose.phase);
    return parsePlanOutput(JSON.stringify({ direction: "right", motion: "in_place", drawingFps: null, durationSeconds: null, poseId: undefined, poses: phases.map((phase) => ({ phase, detail: "", referenceId: undefined })) }), seen, actionFor(seen), poseId);
  };
  services.draw = async ({ index, signal }) => {
    calls.draw++;
    calls.drawIndices.push(index);
    if (drawGate) await drawGate;
    if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
    return { png: await walkerPng(DRIFT[index].phase, DRIFT[index]), width: 1024, height: 1536 };
  };
  chatServices.complete = async (input) => {
    calls.complete.push({ instructions: input.instructions, input: input.input });
    return modelText;
  };
});

beforeEach(() => {
  calls.draw = 0;
  calls.drawIndices = [];
  calls.complete = [];
  modelText = "";
  drawGate = null;
  delete process.env.FOCUS_FLIPBOOK_IMAGE_BUDGET;
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("the chat contract", () => {
  it("asks the model for strict JSON where every property is required", () => {
    const schema = chatJsonSchema();
    const strict = (node: Record<string, unknown>) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      }
    };
    strict(schema);
    strict(schema.properties.poses.items);
    strict(schema.properties.playback);
  });

  it("limits what a message and an apply can carry", () => {
    expect(FlipbookChatRequestSchema.safeParse({ message: "a" }).success).toBe(false);
    expect(FlipbookChatRequestSchema.safeParse({ message: "x".repeat(301) }).success).toBe(false);
    expect(FlipbookChatRequestSchema.parse({ message: "slower please" }).history).toEqual([]);
    expect(FlipbookChatRequestSchema.safeParse({ message: "slower", history: Array.from({ length: 9 }, () => ({ role: "user", text: "hi" })) }).success).toBe(false);
    expect(ApplyPoseChangesRequestSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(ApplyPoseChangesRequestSchema.safeParse({ changes: [{ frame: "f48", description: "x" }] }).success).toBe(false);
    expect(ApplyPoseChangesRequestSchema.safeParse({ changes: [{ frame: "f1", description: "x".repeat(901) }] }).success).toBe(false);
  });

  it("words the cost in frames and drawings, and playback patches in plain words", () => {
    expect(costLine({ drawings: 1, used: 8, limit: 16, overBy: 0 })).toBe("This will redraw 1 frame (1 drawing).");
    expect(costLine({ drawings: 3, used: 8, limit: 16, overBy: 0 })).toBe("This will redraw 3 frames (3 drawings).");
    expect(describePlaybackPatch({ drawingFps: 8, speed: 0.8 })).toEqual(["8 drawings per second", "speed ×0.8"]);
    const settings = { drawingFps: 12 as const, durationSeconds: 4 as const, motion: "in_place" as const, aspect: "16:9" as const, speed: 1 };
    expect(applyPlaybackPatch(settings, { drawingFps: 8 })).toEqual({ ...settings, drawingFps: 8 });
  });

  it("tells the model what it cannot do", () => {
    expect(chatInstructions({ plan: null })).toMatch(/Looping is always on/);
    expect(chatInstructions({ plan: null })).toMatch(/never draw/);
  });
});

describe("proposals", () => {
  let flipbook: Flipbook;
  beforeAll(async () => {
    flipbook = await walk();
    expect(flipbook.status).toBe("ready");
  });

  it("turns positions into frames, costs one drawing per changed frame and leaves the rest alone", () => {
    const proposal = parseChatOutput(
      turn({
        reply: "I’ll lift the arm in frame 4.",
        poses: [
          { position: 4, summary: "Arm raised higher", description: "The near arm swings up to shoulder height." },
          { position: 2, summary: "Softer landing", description: "The weight drops gently onto the left leg." },
        ],
      }),
      flipbook,
    );
    expect(proposal.changes.map((change) => [change.frame, change.position])).toEqual([["f1", 2], ["f3", 4]]);
    expect(proposal.changes[1]).toMatchObject({ label: flipbook.frames[3].label, summary: "Arm raised higher", before: flipbook.plan!.poses[3].description });
    expect(proposal.cost).toEqual({ drawings: 2, used: 8, limit: 16, overBy: 0 });
    expect(proposal.playback).toBeNull();
    expect(proposal.skipped).toEqual([]);
  });

  it("drops unchanged, repeated, out-of-range and empty poses", () => {
    const same = flipbook.plan!.poses[0].description;
    const proposal = parseChatOutput(
      turn({
        poses: [
          { position: 1, summary: "Nothing", description: same },
          { position: 3, summary: "Real change", description: "Both arms swing wide." },
          { position: 3, summary: "Again", description: "Something else entirely." },
          { position: 9, summary: "Not a frame", description: "Nope." },
          { position: 5, summary: "Empty", description: "   " },
        ],
      }),
      flipbook,
    );
    expect(proposal.changes.map((change) => change.position)).toEqual([3]);
    expect(proposal.changes[0].description).toBe("Both arms swing wide.");
    expect(proposal.cost.drawings).toBe(1);
  });

  it("follows the playback order the person sees, even after frames were reordered", () => {
    const reordered = { ...flipbook, order: ["f7", "f0", "f1", "f2", "f3", "f4", "f5", "f6"] as Flipbook["order"] };
    const proposal = parseChatOutput(turn({ poses: [{ position: 1, summary: "x", description: "New first drawing." }] }), reordered);
    expect(proposal.changes[0]).toMatchObject({ frame: "f7", position: 1 });
    expect(chatContext(reordered, undefined, [], "hi")).toMatch(new RegExp(`1\\. ${flipbook.frames[7].label}`));
  });

  it("names approved frames it leaves alone instead of redrawing them", () => {
    const approved = { ...flipbook, frames: flipbook.frames.map((frame) => (frame.id === "f2" ? { ...frame, approved: true } : frame)) };
    const proposal = parseChatOutput(turn({ poses: [{ position: 3, summary: "x", description: "Different." }, { position: 4, summary: "y", description: "Also different." }] }), approved);
    expect(proposal.changes.map((change) => change.frame)).toEqual(["f3"]);
    expect(proposal.skipped).toEqual([{ frame: "f2", position: 3, label: flipbook.frames[2].label, reason: expect.stringMatching(/Approved frames are locked/) }]);
    expect(proposal.cost.drawings).toBe(1);
  });

  it("says how far past the drawing budget a proposal goes", () => {
    const tight = { ...flipbook, budget: { limit: 9, used: 8 } };
    const poses = [1, 2, 3].map((position) => ({ position, summary: "x", description: `New drawing ${position}.` }));
    expect(parseChatOutput(turn({ poses }), tight).cost).toEqual({ drawings: 3, used: 8, limit: 9, overBy: 2 });
  });

  it("keeps playback changes that differ from now, clamped, and drops what cannot apply", () => {
    const now = { drawingFps: 12 as const, durationSeconds: 4 as const, motion: "in_place" as const, speed: 1 };
    // In place: speed does nothing, and an unchanged length is no change.
    expect(parseChatOutput(turn({ playback: playback({ drawingFps: 8, speed: 0.6, durationSeconds: 4 }) }), flipbook, now).playback).toEqual({ drawingFps: 8 });
    // Travelling: speed is clamped to the supported range and rounded.
    const across = parseChatOutput(turn({ playback: playback({ motion: "across", speed: 9.123 }) }), flipbook, now);
    expect(across.playback).toEqual({ motion: "right", speed: 1.5 });
    expect(parseChatOutput(turn({ playback: playback({ speed: 0.8 }) }), flipbook, { ...now, motion: "right" }).playback).toEqual({ speed: 0.8 });
    // Values outside the supported set are dropped, not guessed.
    expect(parseChatOutput(turn({ playback: playback({ drawingFps: 24, durationSeconds: 5 }) }), flipbook, now).playback).toBeNull();
  });

  it("never carries an action that stays on the spot across the stage", () => {
    const wave = { ...flipbook, plan: { ...flipbook.plan!, action: "wave" as const } };
    expect(parseChatOutput(turn({ playback: playback({ motion: "across" }) }), wave).playback).toBeNull();
  });

  it("ignores pose and playback fields when the model says it cannot help", () => {
    const proposal = parseChatOutput(turn({ action: "none", reply: "I can’t change the background here.", poses: [{ position: 1, summary: "x", description: "Different." }], playback: playback({ drawingFps: 8 }) }), flipbook);
    expect(proposal).toMatchObject({ reply: "I can’t change the background here.", changes: [], playback: null, cost: { drawings: 0 } });
  });

  it("rejects unreadable or malformed output", () => {
    expect(() => parseChatOutput("not json", flipbook)).toThrow(expect.objectContaining({ code: "chat_invalid_output" }));
    expect(() => parseChatOutput(JSON.stringify({ action: "propose" }), flipbook)).toThrow(expect.objectContaining({ code: "chat_invalid_output" }));
    expect(() => parseChatOutput(turn({ reply: "" }), flipbook)).toThrow(expect.objectContaining({ code: "chat_invalid_output" }));
  });

  it("asks the model with the plan in playback order and the recent conversation, and draws nothing", async () => {
    modelText = turn({ reply: "Slower it is.", playback: playback({ drawingFps: 8 }) });
    const before = await getFlipbook(flipbook.id);
    const proposal = await proposeChange({
      flipbook: before,
      message: "make it slower",
      history: [{ role: "user", text: "make her happier" }, { role: "assistant", text: "Done, with a bigger smile." }],
      playback: { drawingFps: 12, durationSeconds: 4, motion: "in_place", speed: 1 },
    });
    expect(proposal.playback).toEqual({ drawingFps: 8 });
    expect(calls.complete).toHaveLength(1);
    const asked = calls.complete[0].input;
    expect(asked).toContain("Person: make it slower");
    expect(asked).toContain("Person: make her happier");
    expect(asked).toContain("Assistant: Done, with a bigger smile.");
    expect(asked).toContain("12 drawings per second");
    for (const frame of before.frames) expect(asked).toContain(`${frame.label} (${frame.phase})`);
    // A proposal is only text: no drawing, no budget, no saved change.
    expect(calls.draw).toBe(0);
    const after = await getFlipbook(flipbook.id);
    expect(after.budget).toEqual(before.budget);
    expect(after.plan).toEqual(before.plan);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("refuses to propose before there is a pose plan", async () => {
    await expect(proposeChange({ flipbook: { ...flipbook, plan: null }, message: "slower", history: [] })).rejects.toMatchObject({ code: "flipbook_not_ready" });
    expect(calls.complete).toHaveLength(0);
  });
});

describe("applying a proposal", () => {
  it("saves the new instructions and redraws exactly the listed frames, one drawing each", async () => {
    const flipbook = await walk();
    calls.drawIndices = [];
    const gates: number[] = [];
    const started = await applyPoseChanges(
      flipbook.id,
      [{ frame: "f3", description: "The near arm is raised high above the head." }, { frame: "f5", description: "The far leg steps long." }],
      {},
      async ({ estimatedFrames }) => { gates.push(estimatedFrames); },
    );
    expect(gates).toEqual([2]);
    expect(started.status).toBe("generating");
    expect(started.budget).toEqual({ limit: 16, used: 10 });
    expect(started.plan!.poses[3].description).toBe("The near arm is raised high above the head.");
    expect(started.plan!.poses[5].description).toBe("The far leg steps long.");
    // The other six poses keep their instructions.
    for (const index of [0, 1, 2, 4, 6, 7]) expect(started.plan!.poses[index].description).toBe(flipbook.plan!.poses[index].description);
    const done = await waitFor(flipbook.id, ["ready"]);
    expect([...calls.drawIndices].sort()).toEqual([3, 5]);
    expect(done.frames.filter((frame) => frame.versions.length === 2).map((frame) => frame.id).sort()).toEqual(["f3", "f5"]);
    expect(done.frames.every((frame) => frame.status === "ready")).toBe(true);
  });

  it("changes nothing when a frame is approved", async () => {
    const flipbook = await walk();
    await applyFrameAction(flipbook.id, "f2", { action: "approve", approved: true });
    const before = await getFlipbook(flipbook.id);
    calls.drawIndices = [];
    await expect(applyPoseChanges(flipbook.id, [{ frame: "f1", description: "New." }, { frame: "f2", description: "Locked." }])).rejects.toMatchObject({ code: "frame_approved" });
    const after = await getFlipbook(flipbook.id);
    expect(after.plan).toEqual(before.plan);
    expect(after.budget).toEqual(before.budget);
    expect(calls.drawIndices).toEqual([]);
  });

  it("asks for confirmation past the budget and leaves the plan as it was until confirmed", async () => {
    const flipbook = await walk();
    process.env.FOCUS_FLIPBOOK_IMAGE_BUDGET = "9";
    const created = await walk();
    const changes = (["f1", "f2", "f3"] as const).map((frame) => ({ frame, description: `Changed ${frame}.` }));
    await expect(applyPoseChanges(created.id, changes)).rejects.toMatchObject({ code: "budget_reached", status: 402 });
    const untouched = await getFlipbook(created.id);
    expect(untouched.plan).toEqual(created.plan);
    expect(untouched.budget).toEqual({ limit: 9, used: 8 });
    expect(flipbook.id).not.toBe(created.id);
    const confirmed = await applyPoseChanges(created.id, changes, { confirmExtra: true });
    expect(confirmed.budget).toEqual({ limit: 11, used: 11 });
    await waitFor(created.id, ["ready"]);
    expect(calls.drawIndices.filter((index) => [1, 2, 3].includes(index)).length).toBeGreaterThanOrEqual(3);
  });

  it("is turned away by the same guard as any paid drawing, before anything is saved", async () => {
    const flipbook = await walk();
    const before = await getFlipbook(flipbook.id);
    const gate = async () => { throw new AppError("rate_limited", 429, "Too many."); };
    await expect(applyPoseChanges(flipbook.id, [{ frame: "f0", description: "New." }], {}, gate)).rejects.toMatchObject({ code: "rate_limited" });
    const after = await getFlipbook(flipbook.id);
    expect(after.plan).toEqual(before.plan);
    expect(after.budget).toEqual(before.budget);
  });

  it("waits for the running step instead of starting another", async () => {
    const flipbook = await walk();
    let release!: () => void;
    drawGate = new Promise<void>((resolve) => { release = resolve; });
    await applyPoseChanges(flipbook.id, [{ frame: "f0", description: "New." }]);
    const mid = await getFlipbook(flipbook.id);
    await expect(applyPoseChanges(flipbook.id, [{ frame: "f1", description: "Another." }])).rejects.toMatchObject({ code: "flipbook_busy" });
    // The refused request spent nothing and changed nothing.
    expect((await getFlipbook(flipbook.id)).budget).toEqual(mid.budget);
    expect((await getFlipbook(flipbook.id)).plan!.poses[1].description).toBe(flipbook.plan!.poses[1].description);
    release();
    await waitFor(flipbook.id, ["ready"]);
  });
});
