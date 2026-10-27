import path from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WALK_PHASES, type CharacterAnalysis, type Flipbook, type FlipbookStatus } from "../../shared/flipbook";
import { AppError } from "../errors";
import { activeWorkCount } from "../jobs";
import { DRIFT, walkerPng } from "./__fixtures__/walker";
import {
  applyFrameAction,
  cancelFlipbook,
  changeReference,
  createFlipbook,
  exportFlipbook,
  generateMissing,
  reorderFrames,
  replaceFrame,
  services,
  unbilled,
} from "./flipbooks";
import { segmentation } from "./frame-alignment";
import { ingestCharacterImage } from "./image-input";
import { parsePlanOutput } from "./pose-planning";
import { getFlipbook } from "./store";

// The Flipbook lifecycle with every paid call replaced by a deterministic
// fake: Muse Spark returns fixed JSON, Muse Image returns the fixture walker,
// SAM is off (key-background cut-outs). No network, no credits.
//
// FOCUS_FLIPBOOK_SEED_DIR=<dir> keeps the data directory (and writes seed.json)
// so a production server can open the finished flipbook for manual checks.

let work: string;
let imageId: string;
const seedDir = process.env.FOCUS_FLIPBOOK_SEED_DIR;

const baseAnalysis: CharacterAnalysis = {
  characterCount: 1, subject: "walker", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
  style: "flat vector, no outlines", hair: "short red cap of hair", clothing: "blue shirt, dark trousers, black shoes", accessories: [],
  palette: ["#2e86de", "#34495e", "#c0392b", "#f1c27d"], proportions: "big round head, long legs", requestedAction: "walk",
};

let analysis: CharacterAnalysis = baseAnalysis;
const calls = { analyze: 0, plan: 0, draw: 0, clean: 0, drawIndices: [] as number[], neighbors: 0, activeDuringDraw: 0 };
let drawFailures = new Map<number, AppError>();
let drawGate: Promise<void> | null = null;

const upload = async (png: Buffer, name: string) => ({ body: Readable.toWeb(Readable.from(png)) as ReadableStream<Uint8Array>, fileName: name });

async function waitFor(id: string, statuses: readonly FlipbookStatus[], timeoutMs = 45_000): Promise<Flipbook> {
  const started = Date.now();
  for (;;) {
    const flipbook = await getFlipbook(id);
    if (statuses.includes(flipbook.status)) return flipbook;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out in ${flipbook.status}: ${JSON.stringify(flipbook.error)}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

beforeAll(async () => {
  work = seedDir ?? await mkdtemp(path.join(tmpdir(), "focus-flipbook-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  segmentation.segment = null;
  const image = await ingestCharacterImage(await upload(await walkerPng("left_passing"), "walker.png"));
  imageId = image.id;

  services.analyze = async () => { calls.analyze++; return analysis; };
  services.plan = async ({ analysis: seen }) => {
    calls.plan++;
    return parsePlanOutput(JSON.stringify({ direction: "right", motion: "in_place", drawingFps: null, durationSeconds: null, poses: WALK_PHASES.map((phase) => ({ phase, detail: "" })) }), seen);
  };
  services.draw = async ({ index, neighbor, signal }) => {
    calls.draw++;
    calls.drawIndices.push(index);
    if (neighbor) calls.neighbors++;
    calls.activeDuringDraw = Math.max(calls.activeDuringDraw, activeWorkCount());
    if (drawGate) await drawGate;
    if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
    const failure = drawFailures.get(index);
    if (failure) throw failure;
    return { png: await walkerPng(DRIFT[index].phase, DRIFT[index]), width: 1024, height: 1536 };
  };
  services.cleanReference = async () => { calls.clean++; return { png: await walkerPng("left_passing", { scale: 1.05 }), width: 1024, height: 1536 }; };
  services.scene = async () => { throw new AppError("meta_unavailable", 502, "not used"); };
  services.review = async () => ({ summary: "fake", recognizableWalk: true, frames: new Map() });
});

beforeEach(() => {
  analysis = baseAnalysis;
  drawFailures = new Map();
  drawGate = null;
  delete process.env.FOCUS_FLIPBOOK_IMAGE_BUDGET;
});

afterAll(async () => {
  if (!seedDir) await rm(work, { recursive: true, force: true });
});

describe("the eight-pose pipeline", () => {
  let flipbook: Flipbook;

  it("goes from one illustration to eight registered, checked walk drawings", async () => {
    const before = { ...calls };
    const created = await createFlipbook({ imageId, prompt: "walk in place" });
    expect(created.status).toBe("analyzing");
    flipbook = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    expect(flipbook.status).toBe("ready");
    expect(calls.analyze - before.analyze).toBe(1);
    expect(calls.plan - before.plan).toBe(1);
    expect(calls.draw - before.draw).toBe(8);
    expect(calls.clean - before.clean).toBe(0);
    expect(calls.activeDuringDraw).toBeGreaterThanOrEqual(1);
    expect(flipbook.reference?.kind).toBe("original");
    expect(flipbook.budget).toEqual({ limit: 16, used: 8 });
    expect(flipbook.order).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
    expect(flipbook.alignment?.strideMeasured).toBe(true);
    for (const frame of flipbook.frames) {
      expect(frame.status).toBe("ready");
      expect(frame.version).toBe(frame.originalVersion);
      expect(flipbook.alignment?.transforms[frame.id]?.version).toBe(frame.version);
      expect(frame.metrics?.extraction).toBe("key");
      expect(frame.warnings.map((warning) => warning.code)).not.toContain("near_duplicate");
      expect(frame.warnings.map((warning) => warning.code)).not.toContain("subject_cropped");
    }
    // Size drift between "generations" is measured and corrected.
    expect(Math.max(...flipbook.frames.map((frame) => frame.metrics!.relativeScale))).toBeGreaterThan(1.05);
    if (seedDir) await writeFile(path.join(seedDir, "seed.json"), JSON.stringify({ flipbookId: flipbook.id }));
  });

  it("exports a verified MP4 and reuses it for identical settings", async () => {
    const value = { format: "mp4" as const, settings: { drawingFps: 8 as const, durationSeconds: 2 as const, motion: "in_place" as const, speed: 1 }, background: { kind: "color" as const, color: "#ffffff" } };
    const first = await exportFlipbook(flipbook.id, value);
    expect(first.record.facts.frames).toBe(48);
    expect(first.record.files[0].url).toContain(`/api/flipbooks/${flipbook.id}/media?kind=export`);
    const again = await exportFlipbook(flipbook.id, value);
    expect(again.record.key).toBe(first.record.key);
    expect(again.record.createdAt).toBe(first.record.createdAt);
  });

  it("protects approved frames and redraws only the one asked for", async () => {
    await applyFrameAction(flipbook.id, "f2", { action: "approve", approved: true });
    await expect(applyFrameAction(flipbook.id, "f2", { action: "regenerate" })).rejects.toMatchObject({ code: "frame_approved" });
    await expect(applyFrameAction(flipbook.id, "f2", { action: "restore" })).rejects.toMatchObject({ code: "frame_approved" });
    const before = await getFlipbook(flipbook.id);
    const neighbors = calls.neighbors;
    const started = await applyFrameAction(flipbook.id, "f3", { action: "regenerate", note: "lift the back heel" });
    expect(started.status).toBe("generating");
    expect(started.frames.find((frame) => frame.id === "f3")!.status).toBe("generating");
    const after = await waitFor(flipbook.id, ["ready"]);
    expect(calls.drawIndices.at(-1)).toBe(3);
    expect(calls.neighbors - neighbors).toBe(1);
    const f3 = after.frames.find((frame) => frame.id === "f3")!;
    expect(f3.version).not.toBe(f3.originalVersion);
    expect(f3.versions.at(-1)?.note).toBe("lift the back heel");
    for (const frame of after.frames.filter((entry) => entry.id !== "f3")) {
      const old = before.frames.find((entry) => entry.id === frame.id)!;
      expect(frame.version).toBe(old.version);
      expect(frame.approved).toBe(old.approved);
    }
    expect(after.frames.find((frame) => frame.id === "f2")!.approved).toBe(true);
    expect(after.budget.used).toBe(9);
  });

  it("restores the original drawing without any AI call", async () => {
    const draws = calls.draw;
    const restored = await applyFrameAction(flipbook.id, "f3", { action: "restore" });
    const f3 = restored.frames.find((frame) => frame.id === "f3")!;
    expect(f3.version).toBe(f3.originalVersion);
    expect(f3.status).toBe("ready");
    expect(calls.draw).toBe(draws);
  });

  it("reorders only with a complete permutation", async () => {
    await expect(reorderFrames(flipbook.id, ["f0", "f0", "f2", "f3", "f4", "f5", "f6", "f7"])).rejects.toMatchObject({ code: "invalid_order" });
    const swapped = await reorderFrames(flipbook.id, ["f0", "f1", "f3", "f2", "f4", "f5", "f6", "f7"]);
    expect(swapped.order.slice(2, 4)).toEqual(["f3", "f2"]);
    const back = await reorderFrames(flipbook.id, ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
    expect(back.order[2]).toBe("f2");
  });

  it("replaces a frame with an uploaded transparent drawing, cut out by its own alpha", async () => {
    const draws = calls.draw;
    await replaceFrame(flipbook.id, "f5", (await upload(await walkerPng("right_down", { background: null }), "fix.png")).body, undefined);
    const after = await waitFor(flipbook.id, ["ready"]);
    const f5 = after.frames.find((frame) => frame.id === "f5")!;
    expect(f5.versions.at(-1)?.source).toBe("uploaded");
    expect(f5.metrics?.extraction).toBe("alpha");
    expect(calls.draw).toBe(draws);
    await applyFrameAction(flipbook.id, "f5", { action: "restore" });
  });
});

describe("budget and failures", () => {
  it("asks for confirmation past the drawing budget, then extends it by exactly that", async () => {
    process.env.FOCUS_FLIPBOOK_IMAGE_BUDGET = "9";
    const created = await createFlipbook({ imageId, prompt: "walk right" });
    await waitFor(created.id, ["ready"]);
    await applyFrameAction(created.id, "f1", { action: "regenerate" });
    await waitFor(created.id, ["ready"]);
    await expect(applyFrameAction(created.id, "f1", { action: "regenerate" })).rejects.toMatchObject({ code: "budget_reached", status: 402 });
    await applyFrameAction(created.id, "f1", { action: "regenerate", confirmExtra: true });
    const after = await waitFor(created.id, ["ready"]);
    expect(after.budget).toEqual({ limit: 10, used: 10 });
  });

  it("keeps failed frames visible, refunds only drawings Meta doesn't bill, and draws the missing ones on request", async () => {
    drawFailures = new Map([[5, new AppError("image_blocked", 422, "blocked")], [6, new AppError("meta_timeout", 504, "slow")]]);
    const created = await createFlipbook({ imageId, prompt: "walk" });
    const flipbook = await waitFor(created.id, ["ready"]);
    expect(flipbook.frames.find((frame) => frame.id === "f5")).toMatchObject({ status: "failed", error: { code: "image_blocked" } });
    expect(flipbook.frames.find((frame) => frame.id === "f6")).toMatchObject({ status: "failed", error: { code: "meta_timeout" } });
    expect(flipbook.budget.used).toBe(7);
    await expect(exportFlipbook(created.id, { format: "gif", settings: { drawingFps: 8, durationSeconds: 2, motion: "in_place", speed: 1 }, background: { kind: "transparent" } })).rejects.toMatchObject({ code: "export_not_ready" });
    drawFailures = new Map();
    await generateMissing(created.id, false);
    const fixed = await waitFor(created.id, ["ready"]);
    expect(fixed.frames.every((frame) => frame.status === "ready")).toBe(true);
    expect(fixed.budget.used).toBe(9);
    expect(unbilled(new AppError("meta_timeout", 504, ""))).toBe(false);
    expect(unbilled(new AppError("image_unreadable", 502, ""))).toBe(false);
    expect(unbilled(new AppError("meta_unavailable", 502, ""))).toBe(true);
  });

  it("cancels running work; a late answer can't write over the cancel", async () => {
    let release!: () => void;
    drawGate = new Promise((resolve) => { release = resolve; });
    const created = await createFlipbook({ imageId, prompt: "walk" });
    await waitFor(created.id, ["generating"]);
    expect(activeWorkCount()).toBeGreaterThanOrEqual(1);
    const canceled = await cancelFlipbook(created.id);
    expect(canceled.status).toBe("reference_ready");
    expect(canceled.frames.every((frame) => frame.status === "failed" && frame.error?.code === "canceled")).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const later = await getFlipbook(created.id);
    expect(later.status).toBe("reference_ready");
    expect(later.frames.every((frame) => frame.version === null)).toBe(true);
  });
});

describe("input handling", () => {
  it("pauses on a risky input after drawing a clean side-view reference", async () => {
    analysis = { ...baseAnalysis, view: "three_quarter", facing: "front" };
    const clean = calls.clean;
    const created = await createFlipbook({ imageId, prompt: "walk" });
    const paused = await waitFor(created.id, ["reference_ready", "ready", "failed"]);
    expect(paused.status).toBe("reference_ready");
    expect(paused.reference?.kind).toBe("clean");
    expect(calls.clean - clean).toBe(1);
    expect(paused.budget.used).toBe(1);
    expect(paused.warnings.length).toBeGreaterThan(0);
    expect(paused.frames.every((frame) => frame.status === "pending")).toBe(true);
    // The answer already shows the work running, so the editor keeps polling.
    const switched = await changeReference(created.id, "original", {});
    expect(switched.status).toBe("referencing");
    const back = await waitFor(created.id, ["reference_ready"]);
    expect(back.reference?.kind).toBe("original");
    await generateMissing(created.id, false);
    const done = await waitFor(created.id, ["ready"]);
    expect(done.frames.every((frame) => frame.status === "ready")).toBe(true);
  });

  it("refuses actions other than walking, before any drawing is paid for", async () => {
    analysis = { ...baseAnalysis, requestedAction: "jump" };
    const draws = calls.draw;
    const created = await createFlipbook({ imageId, prompt: "make it jump" });
    const result = await waitFor(created.id, ["unsupported", "failed", "ready"]);
    expect(result.status).toBe("unsupported");
    expect(result.error?.code).toBe("unsupported_animation");
    expect(calls.draw).toBe(draws);
    expect(result.budget.used).toBe(0);
  });

  it("is unreachable with the feature flag off", async () => {
    process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "false";
    try {
      await expect(createFlipbook({ imageId, prompt: "walk" })).rejects.toMatchObject({ code: "flipbook_disabled", status: 404 });
    } finally {
      process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
    }
  });

  it("stores uploads as decoded PNGs and rejects files that aren't images", async () => {
    const image = await ingestCharacterImage(await upload(await walkerPng("left_up"), "photo.png"));
    const stored = await stat(path.join(process.env.FOCUS_DATA_DIR!, "flipbook-images", image.id, "image.png"));
    expect(stored.size).toBeGreaterThan(0);
    await expect(ingestCharacterImage(await upload(Buffer.from("not an image"), "fake.png"))).rejects.toMatchObject({ code: "unreadable_image" });
    await expect(ingestCharacterImage(await upload(await walkerPng("left_up"), "walker.gif"))).rejects.toMatchObject({ code: "unsupported_image" });
    expect((await readFile(path.join(process.env.FOCUS_DATA_DIR!, "flipbook-images", image.id, "image.json"), "utf8"))).toContain("\"hasAlpha\":false");
  });
});
