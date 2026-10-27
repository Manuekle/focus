import path from "node:path";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACTION_SPECS, type CharacterAnalysis, type Flipbook, type FlipbookStatus } from "../../shared/flipbook";
import { AppError } from "../errors";
import { activeWorkCount } from "../jobs";
import { DRIFT, walkerPng } from "./__fixtures__/walker";
import {
  addExtraReference,
  applyFrameAction,
  cancelFlipbook,
  changeReference,
  createFlipbook,
  emptiedScene,
  exportFlipbook,
  generateBackground,
  generateMissing,
  listFlipbooks,
  readUploadedImage,
  removeExtraReference,
  saveFlipbook,
  saveLook,
  sendToEditor,
  reorderFrames,
  replaceFrame,
  services,
  unbilled,
  unsaveFlipbook,
} from "./flipbooks";
import { segmentation } from "./frame-alignment";
import { ingestCharacterImage } from "./image-input";
import { actionFor, parsePlanOutput } from "./pose-planning";
import { keepAroundSubject, removedWithSubject } from "./reference-manager";
import { cleanupFlipbooks, flipbookFiles, getFlipbook } from "./store";

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
const calls = { analyze: 0, plan: 0, draw: 0, clean: 0, scene: 0, describe: 0, drawIndices: [] as number[], neighbors: 0, activeDuringDraw: 0, extras: [] as number[], repairs: [] as (readonly string[] | null)[], posedDraws: 0 };
let poseFailure: AppError | null = null;
let automaticPose: string | undefined;
let automaticGuides: Record<number, string> = {};
let plannedImages = 0;
let drawFailures = new Map<number, AppError>();
/** Drawings to return instead of the walker, by pose index. */
let drawPictures = new Map<number, Buffer>();
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
  services.poseReference = async () => {
    if (poseFailure) throw poseFailure;
    return Buffer.from("mannequin reference");
  };
  services.plan = async ({ analysis: seen, poseId, imagePng }) => {
    calls.plan++;
    if (imagePng?.length) plannedImages++;
    const phases = ACTION_SPECS[actionFor(seen)].poses.map((pose) => pose.phase);
    return parsePlanOutput(JSON.stringify({ direction: "right", motion: "in_place", drawingFps: null, durationSeconds: null, poseId: automaticPose, poses: phases.map((phase, index) => ({ phase, detail: "", referenceId: automaticGuides[index] })) }), seen, actionFor(seen), poseId);
  };
  services.draw = async ({ index, neighbor, extras, repair, poseReference, signal }) => {
    calls.draw++;
    if (poseReference?.toString() === "mannequin reference") calls.posedDraws++;
    calls.drawIndices.push(index);
    calls.extras.push(extras?.length ?? 0);
    calls.repairs.push(repair ? repair.problems : null);
    if (neighbor) calls.neighbors++;
    calls.activeDuringDraw = Math.max(calls.activeDuringDraw, activeWorkCount());
    if (drawGate) await drawGate;
    if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
    const failure = drawFailures.get(index);
    if (failure) throw failure;
    const picture = drawPictures.get(index);
    if (picture) return { png: picture, width: 1024, height: 1536 };
    return { png: await walkerPng(DRIFT[index].phase, DRIFT[index]), width: 1024, height: 1536 };
  };
  services.cleanReference = async () => { calls.clean++; return { png: await walkerPng("left_passing", { scale: 1.05 }), width: 1024, height: 1536 }; };
  services.scene = async () => { calls.scene++; return { png: await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#7fb4e6" } }).png().toBuffer(), width: 1536, height: 1024 }; };
  services.describe = async () => {
    calls.describe++;
    return { analysis: { ...baseAnalysis, requestedAction: "none" }, summary: "A walker on a white page.", setting: null, ideas: [{ action: "run", direction: "left", detail: "in a hurry" }] };
  };
  services.review = async () => ({ summary: "fake", recognizableWalk: true, frames: new Map() });
  // A left-to-right gradient: any seam or wrong scroll shows up in the pixels.
  services.backdrop = async () => {
    const width = 1536, height = 1024;
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = (y * width + x) * 3; data[at] = Math.round((x / width) * 255); data[at + 1] = 120; data[at + 2] = y < height * 0.8 ? 200 : 60; }
    return { png: await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer(), width, height };
  };
});

beforeEach(() => {
  analysis = baseAnalysis;
  drawFailures = new Map();
  drawPictures = new Map();
  drawGate = null;
  poseFailure = null;
  automaticPose = undefined;
  automaticGuides = {};
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
    const value = { format: "mp4" as const, settings: { drawingFps: 8 as const, durationSeconds: 2 as const, motion: "in_place" as const, aspect: "16:9" as const, speed: 1 }, background: { kind: "color" as const, color: "#ffffff" } };
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

  it("never restores a first drawing that couldn't be cut out", async () => {
    // Noise everywhere: no flat background to key out, and SAM is off.
    drawPictures.set(5, await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer());
    const created = await createFlipbook({ imageId, prompt: "walk in place" });
    const first = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    const broken = first.frames.find((frame) => frame.id === "f5")!;
    expect(broken.status).toBe("failed");
    expect(broken.originalVersion).toBeNull();
    drawPictures = new Map();
    await applyFrameAction(created.id, "f5", { action: "regenerate" });
    const redrawn = (await waitFor(created.id, ["ready", "failed"])).frames.find((frame) => frame.id === "f5")!;
    expect(redrawn.status).toBe("ready");
    expect(redrawn.originalVersion).toBe(redrawn.version);
    await expect(applyFrameAction(created.id, "f5", { action: "restore" })).rejects.toMatchObject({ code: "nothing_to_restore" });
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

  it("draws a background once, still and as a seamless strip that scrolls in exports", async () => {
    const used = (await getFlipbook(flipbook.id)).budget.used;
    const next = await generateBackground(flipbook.id, { prompt: "a park at sunset", confirmExtra: false });
    expect(next.backgrounds.generated?.prompt).toBe("a park at sunset");
    expect(next.budget.used).toBe(used + 1);
    const still = await sharp(flipbookFiles.background(flipbook.id, "generated")).metadata();
    const strip = await sharp(flipbookFiles.background(flipbook.id, "generated-loop")).metadata();
    expect(strip.height).toBe(still.height);
    expect(strip.width).toBe(Math.round(still.width! * 0.88));
    // The strip's right edge leads into its left edge: the seam is continuous.
    const { data, info } = await sharp(flipbookFiles.background(flipbook.id, "generated-loop")).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number) => data[(10 * info.width + x) * info.channels];
    expect(Math.abs(pixel(info.width - 1) - pixel(0))).toBeLessThanOrEqual(2);

    const settings = { drawingFps: 8 as const, durationSeconds: 2 as const, motion: "in_place" as const, aspect: "16:9" as const, speed: 1 };
    const mp4 = await exportFlipbook(flipbook.id, { format: "mp4", settings, background: { kind: "generated", motion: "scroll" } });
    expect(mp4.record.facts.frames).toBe(48);
    const gif = await exportFlipbook(flipbook.id, { format: "gif", settings, background: { kind: "generated", motion: "scroll" } });
    // A scrolling background needs the whole trip, not one looping cycle.
    expect(gif.record.facts.frames).toBe(16);
    const stillGif = await exportFlipbook(flipbook.id, { format: "gif", settings, background: { kind: "generated", motion: "static" } });
    expect(stillGif.record.facts.frames).toBe(8);
    await expect(exportFlipbook(flipbook.id, { format: "spritesheet", settings, background: { kind: "generated", motion: "static" } })).rejects.toMatchObject({ code: "sprites_background" });
  });

  it("keeps the last look, saves to one account only, and saved animations outlive the cleanup", async () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const look = { settings: { drawingFps: 12 as const, durationSeconds: 6 as const, motion: "in_place" as const, aspect: "16:9" as const, speed: 1 }, background: { kind: "generated" as const, motion: "scroll" as const } };
    expect((await saveLook(flipbook.id, look)).look).toEqual(look);
    const saved = await saveFlipbook(flipbook.id, owner, { title: "Park walk" });
    expect(saved.ownerId).toBe(owner);
    expect(saved.title).toBe("Park walk");
    await expect(saveFlipbook(flipbook.id, other, {})).rejects.toMatchObject({ code: "flipbook_not_found" });
    await expect(unsaveFlipbook(flipbook.id, other)).rejects.toMatchObject({ code: "flipbook_not_found" });
    expect((await listFlipbooks(owner)).map((entry) => [entry.id, entry.title, entry.frames])).toEqual([[flipbook.id, "Park walk", 8]]);
    expect(await listFlipbooks(other)).toEqual([]);

    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(flipbookFiles.state(flipbook.id), old, old);
    await cleanupFlipbooks();
    expect((await getFlipbook(flipbook.id)).ownerId).toBe(owner);

    await unsaveFlipbook(flipbook.id, owner);
    expect(await listFlipbooks(owner)).toEqual([]);
  });

  it("opens the animation in the video editor as a normalized clip", async () => {
    const settings = { drawingFps: 8 as const, durationSeconds: 2 as const, motion: "right" as const, aspect: "16:9" as const, speed: 1 };
    await expect(sendToEditor(flipbook.id, { settings, background: { kind: "transparent" } })).rejects.toMatchObject({ code: "mp4_needs_background" });
    const { video } = await sendToEditor(flipbook.id, { settings, background: { kind: "generated", motion: "static" } });
    expect(video.originalName).toMatch(/\.mp4$/);
    expect(video.normalized.durationSeconds).toBeGreaterThan(1.9);
    expect(video.normalized.durationSeconds).toBeLessThan(2.2);
    expect(video.urls.preview).toContain(`/api/videos/${video.id}/media`);
  });
});

describe("animated gallery poses", () => {
  it("chooses an idle posture internally from the ordinary creation flow", async () => {
    automaticPose = "full_single_P061_side";
    const before = calls.posedDraws;
    const beforeImages = plannedImages;
    const created = await createFlipbook({ imageId, action: "idle", prompt: "Rest crouching and breathe" });
    const ready = await waitFor(created.id, ["ready", "failed"]);
    expect(ready.status).toBe("ready");
    expect(ready.poseId).toBeUndefined();
    expect(ready.plan?.poseId).toBe("full_single_P061_side");
    expect(ready.analysis?.requestedAction).toBe("idle");
    expect(calls.posedDraws - before).toBe(8);
    expect(plannedImages - beforeImages).toBe(1);
  });

  it("attaches different internal guides only to the frames that need them", async () => {
    automaticGuides = { 0: "upper80v2_P001_side", 3: "full_single_P015_side" };
    const before = calls.posedDraws;
    const created = await createFlipbook({ imageId, action: "walk", prompt: "Walk in place" });
    const ready = await waitFor(created.id, ["ready", "failed"]);
    expect(ready.status).toBe("ready");
    expect(ready.plan?.poseId).toBeUndefined();
    expect(ready.plan?.poses.filter((pose) => pose.referenceId)).toHaveLength(2);
    expect(calls.posedDraws - before).toBe(2);
  });

  it("continues with the planned posture when an automatic download fails", async () => {
    automaticPose = "full_single_P061_side";
    poseFailure = new AppError("pose_unavailable", 502, "Pose unavailable.");
    const before = calls.draw;
    const created = await createFlipbook({ imageId, action: "idle", prompt: "Rest crouching and breathe" });
    const ready = await waitFor(created.id, ["ready", "failed"]);
    expect(ready.status).toBe("ready");
    expect(calls.draw - before).toBe(8);
    expect(ready.warnings.some((warning) => warning.includes("visual pose guide was unavailable"))).toBe(true);
    expect(ready.plan?.poseId).toBe(automaticPose);
  });

  it("keeps the selected posture through an unread upload, reload and repair", async () => {
    const image = await ingestCharacterImage(await upload(await walkerPng("left_passing"), "posed.png"));
    const before = calls.posedDraws;
    // The analysis still suggests walking; the explicit pose must win.
    const created = await createFlipbook({ imageId: image.id, poseId: "full_single_P061_side", prompt: "Hold the crouching pose and breathe" });
    const ready = await waitFor(created.id, ["ready", "failed"]);
    expect(ready.status).toBe("ready");
    expect(ready.poseId).toBe("full_single_P061_side");
    expect(ready.plan?.poseId).toBe(ready.poseId);
    expect(ready.plan?.action).toBe("idle");
    expect(ready.plan?.motion).toBe("in_place");
    expect(ready.plan?.poses.every((pose) => pose.description.includes("Crouching low"))).toBe(true);
    expect(ready.alignment?.strideX).toBe(0);
    expect(calls.posedDraws - before).toBe(8);
    await applyFrameAction(ready.id, "f2", { action: "enhance" });
    const repaired = await waitFor(ready.id, ["ready", "failed"]);
    expect(repaired.status).toBe("ready");
    expect(repaired.plan?.poseId).toBe(ready.poseId);
    expect(calls.posedDraws - before).toBe(9);
  });

  it("reports an unavailable pose before spending model calls", async () => {
    poseFailure = new AppError("pose_unavailable", 502, "Pose unavailable.");
    const before = { ...calls };
    const created = await createFlipbook({ imageId, poseId: "full_single_P015_side", prompt: "Hold the pose" });
    const failed = await waitFor(created.id, ["failed"]);
    expect(failed.error?.code).toBe("pose_unavailable");
    expect(failed.budget.used).toBe(0);
    expect(calls.analyze).toBe(before.analyze);
    expect(calls.plan).toBe(before.plan);
    expect(calls.draw).toBe(before.draw);
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
    await expect(exportFlipbook(created.id, { format: "gif", settings: { drawingFps: 8, durationSeconds: 2, motion: "in_place", aspect: "16:9" as const, speed: 1 }, background: { kind: "transparent" } })).rejects.toMatchObject({ code: "export_not_ready" });
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

describe("reading the upload, and the scene behind the character", () => {
  it("reads an upload once, cuts the character out, and a flipbook made from it reuses the reading", async () => {
    const before = { ...calls };
    const look = await readUploadedImage(imageId);
    expect(look.summary).toBe("A walker on a white page.");
    expect(look.ideas).toEqual([{ action: "run", direction: "left", detail: "in a hurry" }]);
    // A plain page: the character comes out, there is no scene to keep.
    expect(look.layers).toEqual({ character: true, scene: false });
    expect((await readUploadedImage(imageId)).summary).toBe(look.summary);
    expect(calls.describe - before.describe).toBe(1);

    const created = await createFlipbook({ imageId, prompt: "Run across the screen to the left, in a hurry", action: "run" });
    expect(created.analysis?.requestedAction).toBe("run");
    const flipbook = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    expect(flipbook.error).toBeNull();
    expect(flipbook.status).toBe("ready");
    expect(flipbook.plan?.action).toBe("run");
    expect(calls.analyze - before.analyze).toBe(0);
    expect(calls.scene - before.scene).toBe(0);
  });

  it("empties the character's place in the scene preview", async () => {
    const source = await sharp({ create: { width: 200, height: 100, channels: 4, background: "#3366cc" } }).png().toBuffer();
    const cutout = await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const measure = { rawWidth: 200, rawHeight: 100, crop: { left: 80, top: 20, width: 40, height: 60 } } as Parameters<typeof emptiedScene>[2];
    const { data, info } = await sharp(await emptiedScene(source, cutout, measure)).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(100, 50)).toBe(0);
    expect(alphaAt(10, 10)).toBe(255);
  });

  it("keeps the upload pixel for pixel around the character when the scene is redrawn", async () => {
    const width = 384, height = 216;
    const source = await sharp({ create: { width, height, channels: 3, background: "#3366cc" } })
      .composite([{ input: await sharp({ create: { width: 60, height: 120, channels: 3, background: "#ff0000" } }).png().toBuffer(), left: 160, top: 60 }])
      .png().toBuffer();
    const mask = new Uint8Array(width * height);
    for (let y = 60; y < 180; y++) for (let x = 160; x < 220; x++) mask[y * width + x] = 255;
    // Muse Image's plate: a different size, the same aspect, everything slightly off.
    const plate = await sharp({ create: { width: 768, height: 432, channels: 3, background: "#3468cb" } }).png().toBuffer();
    const kept = await keepAroundSubject(source, plate, mask);
    const { data, info } = await sharp(kept!).raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(source).removeAlpha().raw().toBuffer();
    expect([info.width, info.height]).toEqual([width, height]);
    const at = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
    // The character's place is the plate: no red left.
    expect(at(data, 190, 120)).toEqual([0x34, 0x68, 0xcb]);
    // Away from it, every pixel is the upload's own.
    let changed = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x >= 140 && x < 240 && y >= 40) continue;
      if (at(data, x, y).some((value, c) => value !== at(original, x, y)[c])) changed++;
    }
    expect(changed).toBe(0);
    // A plate drawn in another aspect can't be laid back over the upload.
    expect(await keepAroundSubject(source, await sharp({ create: { width: 300, height: 300, channels: 3, background: "#000000" } }).png().toBuffer(), mask)).toBeNull();
  });

  it("counts a removed part SAM missed as the character's, but not an unrelated change", () => {
    const width = 40, height = 10;
    const rgb = Buffer.alloc(width * height * 3, 200);
    const drawn = Buffer.from(rgb);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < 5; x++) mask[y * width + x] = 255;
    // A faint tail tip running out of the body, removed in the plate (30/255 off)...
    for (let x = 5; x < 15; x++) drawn[(5 * width + x) * 3 + 2] = 230;
    // ...and a detail the plate redrew far from the character.
    for (let x = 30; x < 35; x++) drawn[(5 * width + x) * 3] = 0;
    const out = removedWithSubject(mask, rgb, drawn, width, height);
    expect(out[5 * width + 14]).toBe(255);
    expect(out[5 * width + 32]).toBe(0);
    expect(out[2 * width + 10]).toBe(0);
  });

  it("separates the scene alongside the poses and makes it the background", async () => {
    const before = { ...calls };
    const created = await createFlipbook({ imageId, prompt: "walk in place", keepScene: true });
    const flipbook = await waitFor(created.id, ["ready", "failed", "reference_ready"]);
    expect(flipbook.status).toBe("ready");
    expect(calls.scene - before.scene).toBe(1);
    expect(flipbook.backgrounds.scene).toBe(true);
    // In place: the scene scrolls behind the walk.
    expect(flipbook.look?.background).toEqual({ kind: "scene", motion: "scroll" });
    expect(flipbook.budget.used).toBe(9);
    expect(await stat(flipbookFiles.background(flipbook.id, "scene-loop"))).toBeTruthy();
    const mp4 = await exportFlipbook(flipbook.id, { format: "mp4", settings: { drawingFps: 8, durationSeconds: 2, motion: "in_place", aspect: "16:9" as const, speed: 1 }, background: { kind: "scene", motion: "scroll" } });
    expect(mp4.record.facts.frames).toBe(48);
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

  it("makes a jump on the spot: eight drawings, the airborne ones lifted off the ground", async () => {
    analysis = { ...baseAnalysis, requestedAction: "jump" };
    const created = await createFlipbook({ imageId, prompt: "jump in place" });
    const result = await waitFor(created.id, ["ready", "failed", "reference_ready", "unsupported"]);
    expect(result.status).toBe("ready");
    expect(result.plan?.action).toBe("jump");
    expect(result.plan?.motion).toBe("in_place");
    expect(result.plan?.drawingFps).toBe(12);
    expect(result.frames.every((frame) => frame.status === "ready")).toBe(true);
    const apex = result.plan!.poses.find((pose) => pose.phase === "jump_apex")!;
    expect(apex.lift).toBeGreaterThan(0.1);
  });

  it("refuses actions it can't animate, before any drawing is paid for", async () => {
    analysis = { ...baseAnalysis, requestedAction: "dance" };
    const draws = calls.draw;
    const created = await createFlipbook({ imageId, prompt: "make it dance" });
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

describe("extra references and repairs", () => {
  it("sends extra views with every drawing, and repairs a drawing from the one it has", async () => {
    const created = await createFlipbook({ imageId, prompt: "walk in place" });
    const ready = await waitFor(created.id, ["ready"]);
    const png = await walkerPng("left_passing");
    const view = async (name: string) => (await upload(png, name)).body;

    let current = await addExtraReference(ready.id, await view("back.png"), undefined, "back.png");
    expect(current.extraReferences.map((extra) => extra.name)).toEqual(["back.png"]);
    await expect(stat(flipbookFiles.extraReference(ready.id, current.extraReferences[0].version))).resolves.toBeTruthy();
    current = await addExtraReference(ready.id, await view("side.png"), undefined, "side.png");
    current = await addExtraReference(ready.id, await view("top.png"), undefined, "top.png");
    await expect(addExtraReference(ready.id, await view("one-too-many.png"), undefined, "x.png")).rejects.toMatchObject({ code: "too_many_references" });
    current = await removeExtraReference(ready.id, current.extraReferences[2].version);
    expect(current.extraReferences).toHaveLength(2);
    await expect(removeExtraReference(ready.id, "v-000000000000")).rejects.toMatchObject({ code: "media_not_found" });

    // Improve: the same pose is repaired from its current drawing, the extras still travel, the old version is kept.
    const before = ready.frames.find((frame) => frame.id === "f1")!;
    const draws = calls.draw;
    const started = await applyFrameAction(ready.id, "f1", { action: "enhance", note: "fix the hands" });
    expect(started.status).toBe("generating");
    const after = await waitFor(ready.id, ["ready"]);
    expect(calls.draw - draws).toBe(1);
    expect(calls.repairs.at(-1)).not.toBeNull();
    expect(calls.extras.at(-1)).toBe(2);
    const f1 = after.frames.find((frame) => frame.id === "f1")!;
    expect(f1.versions.at(-1)).toMatchObject({ source: "enhanced", note: "fix the hands" });
    expect(f1.versions).toHaveLength(before.versions.length + 1);
    expect(f1.originalVersion).toBe(before.originalVersion);
    expect(after.budget.used).toBe(9);

    // A plain redraw is not a repair.
    await applyFrameAction(ready.id, "f2", { action: "regenerate" });
    await waitFor(ready.id, ["ready"]);
    expect(calls.repairs.at(-1)).toBeNull();
  });

  it("won't repair a frame that has no drawing yet", async () => {
    drawFailures = new Map([[4, new AppError("image_failed", 502, "This drawing failed.")]]);
    const created = await createFlipbook({ imageId, prompt: "walk in place" });
    const done = await waitFor(created.id, ["ready", "failed"]);
    const f4 = done.frames.find((frame) => frame.poseIndex === 4)!;
    expect(f4.version).toBeNull();
    await expect(applyFrameAction(done.id, f4.id, { action: "enhance" })).rejects.toMatchObject({ code: "nothing_to_enhance" });
  });
});
