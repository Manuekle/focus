import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CharacterAnalysis, type Flipbook, FlipbookPlanSchema } from "../../shared/flipbook";
import { sequenceSkeleton, parseSequenceWindow } from "./sequence-planning";
import { cancelFlipbook, createFlipbook, generateMissing, reviseSequence, restoreSequenceRevision, services } from "./flipbooks";
import { getFlipbook, isRunning, flipbookDir, flipbookFiles } from "./store";
import { segmentation } from "./frame-alignment";
import { ingestCharacterImage } from "./image-input";
import { duplicateFlipbook } from "./duplicate";
import { uploadFlipbookTrack, trackPath } from "./flipbook-audio";
import { attachMotionReference, motionDir, motionGuide, uploadMotionReference } from "./motion-reference";
import { ffmpeg } from "../ffmpeg";
import { storeProposal, readProposal } from "./proposals";

let work: string, imageId: string, png: Buffer;
let active = 0, peak = 0, drawings = 0;
let blocked: Promise<void> | undefined;
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
  services.planSequence = async ({ settings, previous, reusePoses, guide }) => {
    if (guide) expect((await guide(0))?.length).toBeGreaterThan(0);
    const old = new Map([...(reusePoses ?? []), ...(previous?.poses ?? [])].map((pose) => [pose.phase, pose]));
    return FlipbookPlanSchema.parse({ mode: "sequence", action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: settings.drawingFps, durationSeconds: settings.durationSeconds, loop: false, poses: sequenceSkeleton(settings).map((frame) => ({ ...(old.get(frame.phase) ?? { label: frame.label, description: `Body turns gradually at ${frame.phase}`, relativeRootY: 0, lift: 0 }), index: frame.poseIndex, phase: frame.phase })) });
  };
  services.draw = async ({ signal }) => {
    active++; peak = Math.max(peak, active); drawings++;
    try { if (blocked) await blocked; if (signal?.aborted) throw new Error("Canceled test request"); return { png, width: 160, height: 240 }; }
    finally { active--; }
  };
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe("complete continuous workflow", () => {
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
  it("cancels queued generation and returns reservations for unstarted drawings", async () => {
    const book = await make();
    let release!: () => void;
    blocked = new Promise<void>((resolve) => { release = resolve; });
    await generateMissing(book.id, true);
    while (active < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    await cancelFlipbook(book.id);
    release(); blocked = undefined;
    const stopped = await settled(book.id);
    expect(stopped.frames.every((frame) => frame.status !== "generating")).toBe(true);
    expect(stopped.budget.used).toBeLessThanOrEqual(3); // reference + the two requests already sent
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
