import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { AnimationAsset, AnimationJob, EngineAvailability, WorkerManifest, WorkerStatus } from "../../shared/reference-motion";
import { ffmpeg } from "../ffmpeg";
import { ingestAsset } from "./assets";
import { cancelAnimationJob, createAnimationJob, receiveWorkerOutput, retryAnimationJob, services, verifyVideo, workerInput } from "./jobs";
import { signedUrl, verifySignedRequest } from "./signing";
import { getOwnedJob, isRunning, peekJob } from "./store";
import { importToFlipbook, services as importServices } from "./flipbook-import";
import { pathToFileURL } from "node:url";
import { getFlipbook, isRunning as flipbookRunning } from "../animation/store";
import { applyFrameAction, services as flipbookServices } from "../animation/flipbooks";
import { motionGuide } from "../animation/motion-reference";
import { AppError } from "../errors";

// The Reference Motion job with the GPU worker replaced by an in-process fake
// that downloads the trimmed input and uploads a real MP4 through the same
// functions the signed routes call. No network, no GPU.

let work: string;
let character: AnimationAsset;
let driving: AnimationAsset;
const OWNER = "4f1c7a52-9b0e-4d3a-8f61-2c9e5b7d1a30";
const original = { ...services };

const ready: EngineAvailability = { configured: true, reachable: true, ready: true, engines: ["fake"], defaultEngine: "fake", gpu: { name: "Test GPU", vramTotalMb: 24_000 }, gpuHourlyUsd: 0.8, maxSegmentSeconds: 3, detail: null };

type Script = (manifest: WorkerManifest, poll: number) => Promise<WorkerStatus | null>;
let script: Script;
let manifests: WorkerManifest[] = [];
let cancels: string[] = [];

const stream = (file: string) => Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
const status = (manifest: WorkerManifest, stage: WorkerStatus["stage"], extra: Partial<WorkerStatus> = {}): WorkerStatus => ({ jobId: manifest.jobId, runId: `run-${manifest.attempt}`, stage, uploaded: [], timings: {}, synthetic: true, ...extra });

async function upload(manifest: WorkerManifest, source: string, withAudio = false) {
  const out = path.join(work, `out-${manifest.attempt}.mp4`);
  await ffmpeg(["-f", "lavfi", "-i", source, ...(withAudio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"] : []), "-t", String(manifest.durationSeconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(withAudio ? ["-c:a", "aac", "-shortest"] : []), out]);
  await receiveWorkerOutput(manifest.jobId, manifest.attempt, "animation.mp4", stream(out));
}

/** Uploads a real moving test video and reports completion on the second poll. */
const succeed: Script = async (manifest, poll) => {
  if (poll === 1) return status(manifest, "generating", { detail: "step 1/4" });
  const input = await workerInput(manifest.jobId, manifest.attempt, "driving.mp4");
  expect((await readFile(input.file)).byteLength).toBeGreaterThan(1000);
  await upload(manifest, "testsrc2=size=320x568:rate=24");
  await receiveWorkerOutput(manifest.jobId, manifest.attempt, "render_report.json", Readable.toWeb(Readable.from([Buffer.from("{\"ok\":true}")])) as ReadableStream<Uint8Array>);
  return status(manifest, "completed", { gpu: { name: "Test GPU", vramTotalMb: 24_000, peakVramMb: 9_000 }, gpuSeconds: 90, gpuHourlyUsd: 0.8 });
};

async function settled(id: string): Promise<AnimationJob> {
  for (let i = 0; i < 2400; i++) {
    const job = await peekJob(id);
    if (!isRunning(id)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("job did not settle");
}

const create = (key: string, extra: object = {}) => createAnimationJob(OWNER, { characterAssetId: character.id, drivingVideoAssetId: driving.id, startSeconds: 1, durationSeconds: 2, idempotencyKey: key, seed: 7, ...extra }, async () => undefined);

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-rm-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  const video = path.join(work, "dance.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=414x896:rate=30:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const image = path.join(work, "character.png");
  await sharp({ create: { width: 512, height: 768, channels: 4, background: { r: 240, g: 120, b: 160, alpha: 1 } } }).png().toFile(image);
  driving = await ingestAsset({ kind: "driving", ownerId: OWNER, body: stream(video), fileName: "dance.mp4" });
  character = await ingestAsset({ kind: "character", ownerId: OWNER, body: stream(image), fileName: "girl.png" });
});

afterAll(async () => {
  Object.assign(services, original);
  await rm(work, { recursive: true, force: true });
});

beforeEach(() => {
  manifests = [];
  cancels = [];
  script = succeed;
  const polls = new Map<string, number>();
  Object.assign(services, {
    availability: async () => ready,
    dispatch: async (manifest: WorkerManifest) => { manifests.push(manifest); return status(manifest, "queued"); },
    status: async (jobId: string) => {
      const manifest = manifests.findLast((entry) => entry.jobId === jobId)!;
      const key = `${jobId}:${manifest.attempt}`;
      polls.set(key, (polls.get(key) ?? 0) + 1);
      return script(manifest, polls.get(key)!);
    },
    cancel: async (jobId: string) => { cancels.push(jobId); },
    sleep: () => new Promise<void>((resolve) => setImmediate(resolve)),
  });
});

describe("signed worker URLs", () => {
  it("accept their own target and refuse any change or an expired link", () => {
    const url = new URL(signedUrl({ method: "PUT", jobId: "j", attempt: 2, name: "animation.mp4" }, 60));
    expect(verifySignedRequest({ method: "PUT", jobId: "j", name: "animation.mp4" }, url.searchParams)).toEqual({ attempt: 2 });
    expect(() => verifySignedRequest({ method: "GET", jobId: "j", name: "animation.mp4" }, url.searchParams)).toThrow(/invalid or has expired/);
    expect(() => verifySignedRequest({ method: "PUT", jobId: "j", name: "poses.json" }, url.searchParams)).toThrow();
    const forged = new URLSearchParams(url.searchParams);
    forged.set("a", "3");
    expect(() => verifySignedRequest({ method: "PUT", jobId: "j", name: "animation.mp4" }, forged)).toThrow();
    expect(() => verifySignedRequest({ method: "PUT", jobId: "j", name: "animation.mp4" }, url.searchParams, Date.now() + 120_000)).toThrow();
  });
});

describe("uploads", () => {
  it("normalize the movement video to 24 fps H.264 and keep its real facts", () => {
    expect(driving).toMatchObject({ kind: "driving", mime: "video/mp4", fps: 24, hasAudio: false });
    expect(driving.durationSeconds).toBeCloseTo(5, 0);
    expect(character).toMatchObject({ kind: "character", width: 512, height: 768 });
    expect(character.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("render jobs", () => {
  it("run through measured stages, verify the uploaded MP4 and record cost", async () => {
    const job = await create("key-success-1");
    expect(job).toMatchObject({ status: "queued", engine: "fake", synthetic: true, progress: 0 });
    const done = await settled(job.id);
    expect(done.status).toBe("completed");
    expect(done.progress).toBe(1);
    expect(done.verification).toMatchObject({ codec: "h264", pixelFormat: "yuv420p", width: 320, height: 568, fps: 24, blackRatio: 0 });
    expect(done.verification!.frames).toBe(48);
    expect(done.outputs.map((output) => output.name).sort()).toEqual(["animation.mp4", "render_report.json"]);
    expect(done.estimatedCostUsd).toBeCloseTo(0.02, 4);
    expect(done.events.map((event) => event.stage)).toEqual(expect.arrayContaining(["validating", "awaiting_gpu", "generating", "verifying", "completed"]));
    // The manifest carries only signed URLs and checksums of the trimmed inputs.
    const manifest = manifests[0];
    expect(manifest.inputs.driving.url).toContain(`/api/animations/worker/${job.id}/driving.mp4?a=1&exp=`);
    expect(manifest.inputs.character.sha256).toBe(character.checksum);
    expect(Object.keys(manifest.uploads)).toContain("animation.mp4");
    const kept = JSON.parse(await readFile(path.join(process.env.FOCUS_DATA_DIR!, "reference-motion", "jobs", job.id, "manifest.json"), "utf8"));
    expect(JSON.stringify(kept)).not.toContain("sig=");
  });

  it("are idempotent on their key and private to their owner", async () => {
    const first = await create("key-idempotent");
    const again = await create("key-idempotent");
    expect(again.id).toBe(first.id);
    await settled(first.id);
    await expect(getOwnedJob(first.id, "someone-else")).rejects.toMatchObject({ status: 404 });
  });

  it("refuse to start when no engine is ready, before the gate spends anything", async () => {
    services.availability = async () => ({ ...ready, ready: false, engines: [], defaultEngine: null, detail: "asleep" });
    let charged = false;
    await expect(createAnimationJob(OWNER, { characterAssetId: character.id, drivingVideoAssetId: driving.id, startSeconds: 0, idempotencyKey: "key-no-gpu" }, async () => { charged = true; })).rejects.toMatchObject({ code: "GPU_UNAVAILABLE", status: 503 });
    expect(charged).toBe(false);
  });

  it("hold the ZeroGPU demo to what it renders: 2 s or more, 480p", async () => {
    services.availability = async () => ({ ...ready, engines: ["wan-zerogpu"], defaultEngine: "wan-zerogpu" });
    await expect(create("key-zerogpu-short", { engine: "wan-zerogpu", durationSeconds: 1 })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    await expect(create("key-zerogpu-720", { engine: "wan-zerogpu", resolution: "720p" })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    const job = await create("key-zerogpu-ok", { engine: "wan-zerogpu" });
    expect(job).toMatchObject({ engine: "wan-zerogpu", synthetic: false });
    await settled(job.id);
  });

  it("reject a segment past the end of the video", async () => {
    await expect(create("key-too-far", { startSeconds: 4 })).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("never offer a black video as a result", async () => {
    script = async (manifest) => { await upload(manifest, "color=c=black:size=320x568:rate=24"); return status(manifest, "completed"); };
    const done = await settled((await create("key-black")).id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ code: "OUTPUT_INVALID", recoverable: true });
    expect(done.outputs).toEqual([]);
  });

  it("fail recoverably when the worker loses the run, and retry once per key", async () => {
    script = async () => null;
    const failed = await settled((await create("key-lost")).id);
    expect(failed.error).toMatchObject({ code: "GPU_UNAVAILABLE", recoverable: true });
    script = succeed;
    const retried = await retryAnimationJob(failed.id, OWNER, "retry-key-1");
    expect(retried.attempt).toBe(2);
    expect((await retryAnimationJob(failed.id, OWNER, "retry-key-1")).attempt).toBe(2);
    const done = await settled(failed.id);
    expect(done).toMatchObject({ status: "completed", attempt: 2 });
    // Links of the first attempt are dead.
    await expect(receiveWorkerOutput(failed.id, 1, "animation.mp4", Readable.toWeb(Readable.from([Buffer.from("x")])) as ReadableStream<Uint8Array>)).rejects.toMatchObject({ status: 403 });
  });

  it("map a worker failure to its error code", async () => {
    script = async (manifest) => status(manifest, "failed", { error: { code: "MODEL_OOM", message: "CUDA out of memory" } });
    const done = await settled((await create("key-oom-1")).id);
    expect(done.error).toMatchObject({ code: "MODEL_OOM", recoverable: true, message: "CUDA out of memory" });
    expect(cancels).toContain(done.id);
  });

  it("cancel a running job and tell the worker", async () => {
    script = async (manifest) => status(manifest, "generating");
    const job = await create("key-cancel");
    for (let i = 0; i < 1000 && manifests.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    await cancelAnimationJob(job.id, OWNER);
    const done = await settled(job.id);
    expect(done.status).toBe("cancelled");
    expect(done.error?.code).toBe("CANCELLED");
    expect(cancels).toContain(job.id);
  });
});

describe("Flipbook import", () => {
  it("by default makes the render the movement Muse Image draws from, without importing its frames", async () => {
    process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
    script = async (manifest) => {
      await upload(manifest, "color=c=white:size=320x568:rate=24[bg];color=c=0x3355cc:size=90x240:rate=24[box];[bg][box]overlay=x='60+t*40':y=180");
      return status(manifest, "completed");
    };
    const done = await settled((await create("key-import-muse")).id);
    expect(done.status).toBe("completed");
    const analyze = flipbookServices.analyze;
    const analyzed: number[] = [];
    // Stops the flipbook before any paid call: what matters here is how it was set up.
    flipbookServices.analyze = async (input) => { analyzed.push(input.imagePng.byteLength); throw new AppError("meta_not_configured", 503, "No model in tests."); };
    try {
      const gated: Array<[number, boolean]> = [];
      const { flipbookId } = await importToFlipbook(done.id, OWNER, undefined, async (frames, options) => { gated.push([frames, Boolean(options?.continuation)]); });
      for (let i = 0; i < 2400 && flipbookRunning(flipbookId); i++) await new Promise((resolve) => setTimeout(resolve, 25));
      const flipbook = await getFlipbook(flipbookId);
      expect(flipbook).toMatchObject({ ownerId: OWNER, motionSource: "video", sequence: { durationSeconds: 2, drawingFps: 12 }, motionReference: { start: 0, durationSeconds: 2 } });
      expect(flipbook.importedFrom).toBeUndefined();
      expect(flipbook.prompt).toContain("rigid stand-in");
      expect(analyzed).toHaveLength(1);
      // One new generation, then its continuation.
      expect(gated.map(([, continuation]) => continuation)).toEqual([false, true]);
      // Every tick of the render is a guide for its drawing.
      expect(await motionGuide(flipbookId, flipbook.motionReference!, 0)).toBeInstanceOf(Buffer);
      expect(await motionGuide(flipbookId, flipbook.motionReference!, 47)).toBeInstanceOf(Buffer);
      expect((await peekJob(done.id))).toMatchObject({ flipbookId, flipbookImport: "muse" });
      expect((await importToFlipbook(done.id, OWNER)).flipbookId).toBe(flipbookId);
    } finally {
      flipbookServices.analyze = analyze;
    }
  });

  it("turns a verified render into a private 24-per-second sequence, once, with no redraws", async () => {
    process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
    // A character on a flat background, moving: what the engines' simple-background mode returns.
    script = async (manifest) => {
      await upload(manifest, "color=c=white:size=320x568:rate=24[bg];color=c=0x3355cc:size=90x240:rate=24[box];[bg][box]overlay=x='60+t*40':y=180");
      return status(manifest, "completed");
    };
    const done = await settled((await create("key-import")).id);
    expect(done.status).toBe("completed");
    const { flipbookId } = await importToFlipbook(done.id, OWNER, "background");
    for (let i = 0; i < 2400 && flipbookRunning(flipbookId); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    const flipbook = await getFlipbook(flipbookId);
    expect(flipbook).toMatchObject({ status: "ready", ownerId: OWNER, importedFrom: { kind: "reference-motion", jobId: done.id, engine: "fake", synthetic: true }, sequence: { durationSeconds: 2, drawingFps: 24 } });
    expect(flipbook.frames).toHaveLength(48);
    expect(flipbook.frames.every((frame) => !frame.warnings.some((warning) => warning.code === "key_extraction"))).toBe(true);
    expect(flipbook.frames.filter((frame) => !(frame.status === "ready" && frame.versions[0]?.source === "imported" && frame.metrics?.extraction === "key")).map((frame) => [frame.id, frame.status, frame.metrics?.extraction, frame.error])).toEqual([]);
    expect(Object.keys(flipbook.alignment?.transforms ?? {})).toHaveLength(48);
    // The box moves right: registration keeps where each frame was rendered.
    const first = flipbook.alignment!.transforms.s0!, last = flipbook.alignment!.transforms.s47!;
    expect(last.left).toBeGreaterThan(first.left);
    expect((await importToFlipbook(done.id, OWNER, "background")).flipbookId).toBe(flipbookId);
    expect((await peekJob(done.id)).flipbookId).toBe(flipbookId);
    await expect(applyFrameAction(flipbookId, "s0", { action: "regenerate" })).rejects.toMatchObject({ code: "imported_frames" });
    await expect(importToFlipbook(done.id, "someone-else", "background")).rejects.toMatchObject({ status: 404 });
  });

  it("cuts frames out with one SAM pass when asked, gates it, and keeps the render's audio", async () => {
    process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
    // A busy background the flat-color cut-out can't remove, with sound.
    script = async (manifest) => {
      await upload(manifest, "testsrc2=size=320x568:rate=24[bg];color=c=0x3355cc:size=90x240:rate=24[box];[bg][box]overlay=x='60+t*40':y=180", true);
      return status(manifest, "completed");
    };
    const done = await settled((await create("key-import-sam")).id);
    expect(done.verification?.hasAudio).toBe(true);
    const codec = await import(pathToFileURL(path.join(process.cwd(), "node_modules/@meta-sam/parser/dist/mask-codec.js")).href) as {
      encodeSegmentationMask(raster: Uint8Array, width: number, height: number): { encoding: "one_bit"; payload: string; width: number; height: number };
    };
    const calls: string[] = [];
    const original = importServices.segment;
    // The box moves 40 px/s: its mask, frame by frame, is what SAM would return.
    importServices.segment = async (input) => {
      calls.push(input.prompt.kind === "concept" ? input.prompt.concept : input.prompt.kind);
      const mask = codec.encodeSegmentationMask(new Uint8Array(90 * 240).fill(1), 90, 240);
      const frames = Array.from({ length: input.media.frameCount }, (_, frameIndex) => {
        const left = Math.round(60 + (frameIndex / 24) * 40);
        return { frameIndex, timestamp: frameIndex / 24, objects: [{ objectId: "0", box: { left, top: 180, right: left + 90, bottom: 420 }, confidence: 0.9, mask }] };
      });
      const frameCount = input.media.frameCount;
      return {
        id: input.id, videoId: input.videoId, source: "concept" as const, prompt: "person", width: input.media.width, height: input.media.height, fps: 24, frameCount, frames,
        objects: [{ id: "0", framesPresent: frameCount, firstFrame: 0, lastFrame: frameCount - 1, meanConfidence: 0.9, meanArea: 21600, source: "concept" as const }],
        missingFrames: [], diagnostics: [], outcome: { status: "completed" as const }, videoFramesProcessed: frameCount, createdAt: new Date().toISOString(),
      };
    };
    try {
      const gated: number[] = [];
      const background = await importToFlipbook(done.id, OWNER, "background");
      const { flipbookId } = await importToFlipbook(done.id, OWNER, "sam", async (frames) => { gated.push(frames); });
      expect(flipbookId).not.toBe(background.flipbookId);
      expect(gated).toEqual([48]);
      expect(calls).toEqual(["person"]);
      for (let i = 0; i < 2400 && flipbookRunning(flipbookId); i++) await new Promise((resolve) => setTimeout(resolve, 25));
      const flipbook = await getFlipbook(flipbookId);
      expect(flipbook.frames.filter((frame) => !(frame.status === "ready" && frame.metrics?.extraction === "alpha")).map((frame) => [frame.id, frame.status, frame.error?.code])).toEqual([]);
      const first = flipbook.alignment!.transforms.s0!, last = flipbook.alignment!.transforms.s47!;
      expect(last.left).toBeGreaterThan(first.left);
      expect(flipbook.audio).toMatchObject({ name: "Reference Motion soundtrack", offset: 0, startsAt: 0, volume: 1 });
      expect(flipbook.audio!.durationSeconds).toBeGreaterThan(1.5);
      expect((await peekJob(done.id)).flipbookImport).toBe("sam");
      // The same method again opens what it made, without another paid pass.
      expect((await importToFlipbook(done.id, OWNER, "sam", async () => { gated.push(-1); })).flipbookId).toBe(flipbookId);
      expect(gated).toEqual([48]);
      // The flat-color cut-out can't separate this background: its frames fail and say why.
      const plain = await getFlipbook(background.flipbookId);
      expect(plain.frames.some((frame) => frame.status === "failed" && frame.error?.code === "extraction_failed")).toBe(true);
    } finally {
      importServices.segment = original;
    }
  });

  it("refuses an unfinished render", async () => {
    script = async () => null;
    const failed = await settled((await create("key-import-failed")).id);
    await expect(importToFlipbook(failed.id, OWNER)).rejects.toMatchObject({ code: "job_not_completed" });
  });
});

describe("verifyVideo", () => {
  it("refuses a duration that doesn't match the segment", async () => {
    const out = path.join(work, "short.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=128x128:rate=24:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    await expect(verifyVideo(out, 3)).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
    await expect(verifyVideo(out, 1)).resolves.toMatchObject({ frames: 24 });
  });
});
