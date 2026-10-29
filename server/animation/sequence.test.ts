import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type CharacterAnalysis, type Flipbook, FlipbookPlanSchema } from "../../shared/flipbook";
import { sequenceSkeleton, parseSequenceWindow } from "./sequence-planning";
import { applyFrameAction, cancelFlipbook, createFlipbook, enhanceFlagged, generateBackground, generateMissing, retryPreparation, reviseSequence, restoreSequenceRevision, services } from "./flipbooks";
import { AppError } from "../errors";
import { getFlipbook, isRunning, flipbookDir, flipbookFiles, updateFlipbook } from "./store";
import { segmentation } from "./frame-alignment";
import { ingestCharacterImage } from "./image-input";
import { duplicateFlipbook } from "./duplicate";
import { uploadFlipbookTrack, trackPath } from "./flipbook-audio";
import { attachMotionReference, motionDir, motionGuide, uploadMotionReference } from "./motion-reference";
import { ffmpeg } from "../ffmpeg";
import { storeProposal, readProposal } from "./proposals";
import { planWaveSequence, waveAnchorIndexes } from "./wave-sequence";
import { sequenceAnchorIndexes } from "./motion-continuity";

let work: string, imageId: string, png: Buffer;
let active = 0, peak = 0, drawings = 0;
let blocked: Promise<void> | undefined;
let blockAtIndex: number | undefined;
const drawInputs: { index: number; neighbor: boolean; pair: boolean; action: string; from?: number; to?: number }[] = [];
const analysis: CharacterAnalysis = { characterCount: 1, subject: "character", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain", style: "flat", hair: "new red hair", clothing: "new blue shirt", accessories: [], palette: ["#3366aa"], proportions: "human", requestedAction: "dance" };
const body = (buffer: Buffer) => Readable.toWeb(Readable.from(buffer)) as ReadableStream<Uint8Array>;
async function settled(id: string): Promise<Flipbook> {
  const start = Date.now();
  while (isRunning(id)) {
    if (Date.now() - start > 55000) throw new Error("Sequence worker timed out");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return getFlipbook(id);
}
async function make(seconds = 4, fps: 8 | 12 | 24 = 24) {
  const book = await createFlipbook({ imageId, prompt: "Dance continuously across the chosen clip", action: "dance", sequence: { durationSeconds: seconds, drawingFps: fps } });
  const result = await settled(book.id);
  expect(result.error).toBeNull();
  return result;
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-sequence-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
  segmentation.segment = null;
  png = await sharp(Buffer.from('<svg width="160" height="240"><rect width="160" height="240" fill="white"/><rect x="48" y="32" width="64" height="176" rx="18" fill="#3366aa"/></svg>')).png().toBuffer();
  imageId = (await ingestCharacterImage({ body: body(png), fileName: "new-character.png" })).id;
  services.analyze = async () => analysis;
  services.cleanReference = async () => ({ png, width: 160, height: 240 });
  services.planSequence = async ({ settings, previous, reusePoses, guide, action }) => {
    if (action === "wave" && !previous && !guide) return planWaveSequence(settings, "front", "Wave hello");
    if (guide) expect((await guide(0))?.length).toBeGreaterThan(0);
    const old = new Map([...(reusePoses ?? []), ...(previous?.poses ?? [])].map((pose) => [pose.phase, pose]));
    return FlipbookPlanSchema.parse({ mode: "sequence", action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: settings.drawingFps, durationSeconds: settings.durationSeconds, loop: false, poses: sequenceSkeleton(settings).map((frame) => ({ ...(old.get(frame.phase) ?? { label: frame.label, description: `Body turns gradually at ${frame.phase}`, relativeRootY: 0, lift: 0 }), index: frame.poseIndex, phase: frame.phase })) });
  };
  services.draw = async ({ signal, index, neighbor, temporalPair, plan }) => {
    drawInputs.push({ index, neighbor: Boolean(neighbor), pair: Boolean(temporalPair), action: plan.action, from: temporalPair?.fromIndex, to: temporalPair?.toIndex });
    active++; peak = Math.max(peak, active); drawings++;
    try { if (blocked && (blockAtIndex === undefined || index === blockAtIndex)) await blocked; if (signal?.aborted) throw new Error("Canceled test request"); return { png, width: 160, height: 240 }; }
    finally { active--; }
  };
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe("complete continuous workflow", () => {
  it("waits for video upload and trim before its first and only movement plan", async () => {
    const originalPlan = services.planSequence;
    const planner = vi.spyOn(services, "planSequence").mockImplementation(async (input) => ({ ...await originalPlan(input), view: "front" }));
    const analyzer = vi.spyOn(services, "analyze").mockResolvedValue({ ...analysis, requestedAction: "other" });
    try {
      const book = await createFlipbook({ imageId, prompt: "Follow the selected video; preserve this character's appearance.", motionSource: "video", sequence: { durationSeconds: 1, drawingFps: 8 } });
      expect(book.status).toBe("awaiting_motion");
      expect(book.plan).toBeNull();
      expect(isRunning(book.id)).toBe(false);
      expect(planner).not.toHaveBeenCalled();
      expect(analyzer).not.toHaveBeenCalled();
      const source = path.join(work, "initial-motion.mp4");
      await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=160x240:rate=24:duration=2", "-c:v", "libx264", source]);
      const uploaded = await uploadMotionReference(book.id, body(await readFile(source)), undefined, "motion.mp4");
      expect(uploaded.status).toBe("awaiting_motion");
      expect(planner).not.toHaveBeenCalled();
      const before = drawings;
      await attachMotionReference(book.id, { version: uploaded.motionDraft!.version, start: 0.5, durationSeconds: 1, useAudio: false });
      const prepared = await settled(book.id);
      expect(prepared.error).toBeNull();
      expect(prepared.status).toBe("reference_ready");
      expect(prepared.motionReference?.start).toBe(0.5);
      expect(prepared.motionDraft).toBeNull();
      expect(prepared.plan?.view).toBe("front");
      expect(prepared.plan?.poses).toHaveLength(8);
      expect(planner).toHaveBeenCalledTimes(1);
      expect(planner.mock.calls[0][0]).toMatchObject({ action: undefined, view: undefined, guide: expect.any(Function) });
      expect(drawings).toBe(before);
      expect(prepared.analysis?.requestedAction).toBe("other");

      // Recover the persisted shape left behind by the old preset-only gate.
      await updateFlipbook(book.id, (current) => ({ ...current, status: "unsupported", plan: null, reference: null, error: { code: "unsupported_animation", message: "Choose a preset action." } }));
      const backdropGate = vi.fn();
      await expect(generateBackground(book.id, { confirmExtra: false }, backdropGate)).rejects.toMatchObject({ code: "flipbook_not_ready" });
      expect(backdropGate).not.toHaveBeenCalled();
      const retryGate = vi.fn();
      await retryPreparation(book.id, false, retryGate);
      const retried = await settled(book.id);
      expect(retried.status).toBe("reference_ready");
      expect(retried.error).toBeNull();
      expect(retried.id).toBe(book.id);
      expect(retried.motionReference).toEqual(prepared.motionReference);
      expect(retryGate).toHaveBeenCalledTimes(1);
      expect(analyzer).toHaveBeenCalledTimes(1);
      expect(planner).toHaveBeenCalledTimes(2);
      expect(drawings).toBe(before);

      // Recovery may also select a longer segment of the same saved video.
      await updateFlipbook(book.id, (current) => ({ ...current, status: "unsupported", plan: null, reference: null, error: { code: "unsupported_animation", message: "Old rejected movement." } }));
      await attachMotionReference(book.id, { version: retried.motionReference!.version, start: 0, durationSeconds: 2, useAudio: false });
      const recropped = await settled(book.id);
      expect(recropped.error).toBeNull();
      expect(recropped.frames).toHaveLength(16);
      expect(recropped.plan?.poses).toHaveLength(16);
      expect(recropped.order).toEqual(recropped.frames.map((frame) => frame.id));
      expect(analyzer).toHaveBeenCalledTimes(1);
    } finally { planner.mockRestore(); analyzer.mockRestore(); }
  });
  it("draws bounding key poses before dance intermediates and checks extended holds", async () => {
    const source = await make(1, 8);
    const before = drawInputs.length;
    await generateMissing(source.id, true);
    const result = await settled(source.id);
    const calls = drawInputs.slice(before);
    const anchors = sequenceAnchorIndexes(source.plan!);
    expect(anchors).toEqual([0, 2, 4, 6, 7]);
    expect(calls.slice(0, anchors.length).map((call) => call.index)).toEqual(anchors);
    expect(calls.filter((call) => call.pair).map(({ index, from, to }) => ({ index, from, to }))).toEqual([{ index: 1, from: 0, to: 2 }, { index: 3, from: 2, to: 4 }, { index: 5, from: 4, to: 6 }]);
    expect(result.frames[0].warnings.some((warning) => warning.code === "overlong_hold")).toBe(false);
    expect(result.frames.slice(1).every((frame) => frame.warnings.some((warning) => warning.code === "overlong_hold"))).toBe(true);
  });
  it("retries a failed preparation from its saved analysis without replacing the animation", async () => {
    const original = services.planSequence;
    services.planSequence = async () => { throw new AppError("meta_model_not_found", 502, "Model unavailable."); };
    let source: Flipbook;
    try {
      const created = await createFlipbook({ imageId, prompt: "Dance", action: "dance", sequence: { durationSeconds: 1, drawingFps: 8 } });
      source = await settled(created.id);
      expect(source.status).toBe("failed");
      expect(source.analysis).not.toBeNull();
    } finally { services.planSequence = original; }
    const before = drawings;
    const started = await retryPreparation(source!.id, false);
    expect(["analyzing", "planning", "referencing"]).toContain(started.status);
    const result = await settled(source!.id);
    expect(result.id).toBe(source!.id);
    expect(result.status).toBe("reference_ready");
    expect(result.error).toBeNull();
    expect(result.frames.every((frame) => frame.status === "pending")).toBe(true);
    expect(drawings).toBe(before);
  });
  it("repairs only flagged unapproved drawings, checks the full budget and preserves drawings on provider failure", async () => {
    const source = await make(1, 8);
    await generateMissing(source.id, true);
    const complete = await settled(source.id);
    const prepared = await updateFlipbook(source.id, (current) => ({ ...current, budget: { used: current.budget.used, limit: current.budget.used }, frames: current.frames.map((frame, index) => ({ ...frame, warnings: index === 0 || index === 1 ? [{ code: "color_shift" as const, message: "Restore the original blue shirt." }] : [], approved: index === 1, review: index === 2 ? { ok: false, issues: [{ code: "extra_limb" as const, note: "Remove the extra hand." }] } : null })) }));
    const before = drawings;
    await expect(enhanceFlagged(source.id, false)).rejects.toMatchObject({ code: "budget_reached" });
    expect(drawings).toBe(before);
    expect((await getFlipbook(source.id)).frames.map((frame) => frame.version)).toEqual(complete.frames.map((frame) => frame.version));
    const original = services.draw;
    const repairs: { index: number; problems: readonly string[] }[] = [];
    services.draw = async (input) => {
      repairs.push({ index: input.index, problems: input.repair!.problems });
      if (input.index === 2) throw new AppError("meta_model_not_found", 502, "Model unavailable.");
      return original(input);
    };
    try {
      await enhanceFlagged(source.id, true);
      const result = await settled(source.id);
      expect(repairs.map((entry) => entry.index).sort()).toEqual([0, 2]);
      expect(repairs.find((entry) => entry.index === 0)!.problems).toContain("Restore the original blue shirt.");
      expect(repairs.find((entry) => entry.index === 2)!.problems.join(" ")).toContain("Remove the extra hand.");
      expect(result.frames[0].versions.at(-1)?.source).toBe("enhanced");
      expect(result.frames[0].originalVersion).toBe(prepared.frames[0].originalVersion);
      expect(result.frames[1].version).toBe(prepared.frames[1].version);
      expect(result.frames[2].version).toBe(prepared.frames[2].version);
      expect(result.frames[2].status).toBe("ready");
      expect(result.frames[2].error?.code).toBe("meta_model_not_found");
      expect(result.budget.used).toBe(prepared.budget.used + 1);
    } finally { services.draw = original; }
  });
  it("replans the full action when length changes and keeps the old motion in history", async () => {
    const source = await make(1, 8);
    await generateMissing(source.id, true);
    const previous = await settled(source.id);
    const original = services.planSequence;
    services.planSequence = async (input) => {
      expect(input.previous).toBeUndefined();
      expect(input.reusePoses).toEqual([]);
      return original(input);
    };
    try {
      await reviseSequence(source.id, { durationSeconds: 2, drawingFps: 8 });
      const result = await settled(source.id);
      expect(result.frames).toHaveLength(16);
      expect(result.frames.every((frame) => frame.status === "pending" && !frame.version)).toBe(true);
      expect(result.plan?.motionId).not.toBe(previous.plan?.motionId);
      const restored = await restoreSequenceRevision(source.id, result.revisions![0].id);
      expect(restored.frames.map((frame) => frame.version)).toEqual(previous.frames.map((frame) => frame.version));
    } finally { services.planSequence = original; }
  });
  it("plans 96 and 480 separate drawing states and asks for the complete generation count", async () => {
    const book = await make();
    expect(book.frames).toHaveLength(96);
    expect(book.frames.every((frame) => frame.status === "pending")).toBe(true);
    const before = drawings;
    await expect(generateMissing(book.id, false)).rejects.toMatchObject({ code: "budget_reached" });
    expect(drawings).toBe(before);
    await generateMissing(book.id, true);
    const complete = await settled(book.id);
    expect(complete.frames.every((frame) => frame.status === "ready")).toBe(true);
    expect(drawings - before).toBe(96);
    expect(peak).toBeLessThanOrEqual(2);
    expect(complete.alignment?.strideX).toBe(0);
    const longer = await make(20);
    expect(longer.frames).toHaveLength(480);
    expect(new Set(longer.order).size).toBe(480);
    expect(longer.frames.at(-1)?.phase).toBe("sample_479");
  });
  it("adds density without redrawing shared instants and restores the prior revision", async () => {
    const book = await make(1, 8);
    await generateMissing(book.id, true);
    const original = await settled(book.id);
    const before = drawings;
    await reviseSequence(book.id, { durationSeconds: 1, drawingFps: 24 });
    const dense = await settled(book.id);
    expect(dense.frames).toHaveLength(24);
    expect(dense.frames.filter((frame) => frame.status === "ready")).toHaveLength(8);
    expect(dense.frames.filter((frame) => frame.status === "pending")).toHaveLength(16);
    expect(drawings).toBe(before);
    for (const frame of original.frames) expect(dense.frames.find((entry) => entry.id === frame.id)?.version).toBe(frame.version);
    const restored = await restoreSequenceRevision(book.id, dense.revisions![0].id);
    expect(restored.frames.map((frame) => frame.version)).toEqual(original.frames.map((frame) => frame.version));
    expect(restored.sequence?.drawingFps).toBe(8);
  });
  it("finishes every drawing of a full 20-second sequence with a simulated provider", async () => {
    const book = await make(20, 24);
    const before = drawings;
    await generateMissing(book.id, true);
    const complete = await settled(book.id);
    expect(complete.frames).toHaveLength(480);
    expect(complete.frames.every((frame) => frame.status === "ready" && frame.version && complete.alignment?.transforms[frame.id]?.version === frame.version)).toBe(true);
    expect(drawings - before).toBe(480);
    expect(peak).toBeLessThanOrEqual(2);
  }, 120_000);
  it("cancels queued generation and returns reservations for unstarted drawings", async () => {
    const book = await make();
    let release!: () => void;
    blocked = new Promise<void>((resolve) => { release = resolve; });
    await generateMissing(book.id, true);
    while (active < 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await cancelFlipbook(book.id);
    release(); blocked = undefined;
    const stopped = await settled(book.id);
    expect(stopped.frames.every((frame) => frame.status !== "generating")).toBe(true);
    expect(stopped.budget.used).toBeLessThanOrEqual(3); // reference + requests already sent
  });
  it("draws wave landmarks first and every transition from both surrounding poses", async () => {
    const source = await createFlipbook({ imageId, prompt: "One calm wave over four seconds", action: "wave", sequence: { durationSeconds: 4, drawingFps: 12 } });
    const prepared = await settled(source.id);
    const before = drawInputs.length;
    await generateMissing(source.id, true);
    const complete = await settled(source.id);
    const calls = drawInputs.slice(before);
    const anchors = waveAnchorIndexes(prepared.plan!);
    expect(calls.slice(0, anchors.length).map((call) => call.index)).toEqual(anchors);
    expect(calls.filter((call) => call.pair)).toHaveLength(48 - anchors.length);
    expect(calls.filter((call) => !call.pair).slice(1).every((call) => call.neighbor)).toBe(true);
    expect(complete.frames.every((frame) => frame.status === "ready")).toBe(true);
    await applyFrameAction(source.id, complete.order[3], { action: "regenerate", note: "Keep the hand below the waist", confirmExtra: true });
    await settled(source.id);
    expect(drawInputs.at(-1)).toMatchObject({ index: 3, pair: true });
  });
  it("flags a stationary garment recolor after extraction even inside the same histogram bin", async () => {
    const draw = services.draw;
    services.draw = async (input) => {
      const image = await draw(input);
      if (input.index !== 3) return image;
      const { data, info } = await sharp(image.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let offset = 0; offset < data.length; offset += 4) {
        if (data[offset] === 51 && data[offset + 1] === 102 && data[offset + 2] === 170) data[offset + 1] = 118;
      }
      return { ...image, png: await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer() };
    };
    try {
      const source = await createFlipbook({ imageId, prompt: "Wave calmly", action: "wave", sequence: { durationSeconds: 1, drawingFps: 8 } });
      await settled(source.id);
      await generateMissing(source.id, true);
      const complete = await settled(source.id);
      expect(complete.frames.every((frame) => frame.status === "ready")).toBe(true);
      expect(complete.frames[3].metrics?.colorDistance).toBeLessThan(0.01);
      expect(complete.frames.filter((frame) => frame.warnings.some((warning) => warning.code === "color_shift")).map((frame) => frame.poseIndex)).toEqual([3]);
    } finally { services.draw = draw; }
  });
  it("reuses removed drawings when returning from sparse to dense timing", async () => {
    const book = await make(1, 24);
    await generateMissing(book.id, true);
    const dense = await settled(book.id);
    const before = drawings;
    await reviseSequence(book.id, { durationSeconds: 1, drawingFps: 8 });
    await settled(book.id);
    await reviseSequence(book.id, { durationSeconds: 1, drawingFps: 24 });
    const restored = await settled(book.id);
    expect(restored.frames.map((frame) => frame.version)).toEqual(dense.frames.map((frame) => frame.version));
    expect(restored.frames.every((frame) => frame.status === "ready")).toBe(true);
    expect(drawings).toBe(before);
  });
  it("resumes saved wave landmarks after cancellation and registers every reused drawing", async () => {
    const source = await createFlipbook({ imageId, prompt: "One calm wave", action: "wave", sequence: { durationSeconds: 4, drawingFps: 12 } });
    await settled(source.id);
    const start = drawInputs.length;
    let release!: () => void;
    blockAtIndex = 1;
    blocked = new Promise<void>((resolve) => { release = resolve; });
    await generateMissing(source.id, true);
    while (!drawInputs.slice(start).some((call) => call.index === 1)) await new Promise((resolve) => setTimeout(resolve, 5));
    await cancelFlipbook(source.id);
    release(); blocked = undefined; blockAtIndex = undefined;
    const canceled = await settled(source.id);
    expect(canceled.frames.filter((frame) => frame.version).length).toBeGreaterThanOrEqual(10);
    const needed = canceled.frames.filter((frame) => !frame.version).length;
    const before = drawings;
    await generateMissing(source.id, true);
    const complete = await settled(source.id);
    expect(drawings - before).toBe(needed);
    expect(complete.frames.every((frame) => frame.status === "ready" && complete.alignment?.transforms[frame.id]?.version === frame.version)).toBe(true);
    // Recover the old bug's resting book with orphaned "generating" frames.
    await updateFlipbook(source.id, (book) => ({ ...book, frames: book.frames.map((frame, index) => index < 3 ? { ...frame, status: "generating" } : frame) }));
    const recovered = await getFlipbook(source.id);
    expect(recovered.frames.slice(0, 3).every((frame) => frame.status === "failed" && frame.error?.code === "interrupted")).toBe(true);
    const beforeRecovery = drawings;
    await generateMissing(source.id, false);
    const registered = await settled(source.id);
    expect(drawings).toBe(beforeRecovery);
    expect(registered.frames.every((frame) => frame.status === "ready")).toBe(true);
  });
  it("copies a new identity and independent audio while retaining motion and the original", async () => {
    let book = await make(1, 8);
    const wav = path.join(work, "track.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav]);
    book = await uploadFlipbookTrack(book.id, body(await readFile(wav)), undefined, "dance.wav");
    const before = drawings;
    const copy = await duplicateFlipbook(book, { imageId }, null);
    expect(copy.id).not.toBe(book.id);
    expect(copy.plan).toEqual(book.plan);
    expect(copy.reference?.version).not.toBe(book.reference?.version);
    expect(copy.frames.every((frame) => !frame.approved && !frame.version && frame.status === "pending")).toBe(true);
    expect(copy.analysis?.hair).toBe("new red hair");
    expect(copy.budget.used).toBe(0);
    expect(drawings).toBe(before);
    const audio = await readFile(trackPath(copy.id, copy.audio!.version));
    await rm(flipbookDir(book.id), { recursive: true, force: true });
    expect(await readFile(trackPath(copy.id, copy.audio!.version))).toEqual(audio);
    expect((await readFile(flipbookFiles.source(copy.id))).length).toBeGreaterThan(0);
  });
  it("samples a trimmed video on the same time grid and retains old motion in history", async () => {
    const book = await make(1, 8);
    const source = path.join(work, "reference.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=160x240:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", source]);
    const draft = await uploadMotionReference(book.id, body(await readFile(source)), undefined, "dance.mp4");
    expect(draft.plan).toEqual(book.plan);
    await attachMotionReference(book.id, { version: draft.motionDraft!.version, start: 0.5, durationSeconds: 1, useAudio: true });
    const attached = await settled(book.id);
    expect(attached.motionReference?.start).toBe(0.5);
    expect(attached.revisions?.at(-1)?.plan).toEqual(book.plan);
    expect(attached.audio?.offset).toBe(0);
    expect((await motionGuide(book.id, attached.motionReference!, 23))?.length).toBeGreaterThan(0);
    expect((await readFile(path.join(motionDir(book.id, attached.motionReference!.version), "source.mp4"))).length).toBeGreaterThan(0);
    await expect(uploadMotionReference(book.id, body(Buffer.from("#EXTM3U\nfile:///etc/passwd")), undefined, "fake.mp4")).rejects.toMatchObject({ code: "unreadable_media" });
  });
  it("rejects incomplete plans and multiple-person reference windows", () => {
    expect(() => parseSequenceWindow(JSON.stringify({ poses: [] }), [0, 1])).toThrow();
    expect(() => parseSequenceWindow(JSON.stringify({ visiblePeople: 2, poses: [] }), [], true)).toThrow("one clearly visible person");
  });
  it("binds stored chat proposals to a motion revision", async () => {
    const book = await make(1, 8);
    const proposal = await storeProposal(book, { reply: "Lift the arm", changes: [{ frame: "s0", position: 1, label: "Start", summary: "Higher arm", before: book.plan!.poses[0].description, description: "Lift the arm higher." }], skipped: [], playback: null, cost: { drawings: 1, used: 0, limit: 16, overBy: 0 } });
    expect(await readProposal(book, proposal.proposalId!)).toHaveLength(1);
    await expect(readProposal({ ...book, frames: book.frames.map((frame, index) => index === 0 ? { ...frame, approved: true } : frame) }, proposal.proposalId!)).rejects.toMatchObject({ code: "proposal_stale" });
  });
});
