import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseVideoStream, type ResponsesEvent } from "@meta-sam/parser";
import type { EditJob, EditPlan, VideoAsset } from "../shared/schemas";
import { buildTracking, type Tracking } from "../shared/tracking";
import { AppError } from "./errors";
import { ffmpeg } from "./ffmpeg";
import { cancelJob, createJob, getJob, refineWithPoint, reopenSelection, resultFile, services, setSelection, startRender } from "./jobs";
import { ingestVideo } from "./videos";

// The job lifecycle with the two paid services replaced by fakes: no network,
// and every call is counted so cache reuse can be asserted.

let work: string;
let video: VideoAsset;
const calls = { interpret: 0, segment: 0 };
let nextPlan: Partial<EditPlan> = {};
let objectCount = 1;
let segmentDelayMs = 0;

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "ai", "__fixtures__", name), "utf8");
const BRIDGE = fixture("bridge-96f.sam.txt");
const ROCKS = fixture("rock-12f.sam.txt");

async function* replay(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  if (text) yield { type: "response.output_text.delta", delta: text, ...lane };
  yield { type: "response.output_text.done", text, ...lane };
  yield { type: "response.completed" };
}

async function fakeTracking(id: string, text: string): Promise<Tracking> {
  const result = await parseVideoStream(replay(text)).finalResult;
  return buildTracking({
    id, videoId: video.id, source: "concept", prompt: "fake", width: video.normalized.width, height: video.normalized.height,
    fps: video.normalized.fps, frameCount: video.normalized.frameCount, records: result.records, diagnostics: result.diagnostics,
    outcome: result.outcome, videoFramesProcessed: null,
  });
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-jobs-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
  const source = path.join(work, "clip.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1280x674:rate=24:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  video = await ingestVideo({ body: Readable.toWeb(Readable.from(await readFile(source))) as ReadableStream<Uint8Array>, fileName: "clip.mp4" });

  services.interpret = async () => {
    calls.interpret++;
    return {
      supported: true,
      target: { concept: "bridge", selection: "single" },
      effect: "selective_color",
      parameters: { intensity: 0.8 },
      needsClarification: false,
      ...nextPlan,
    } as EditPlan;
  };
  services.segment = async (input) => {
    calls.segment++;
    if (segmentDelayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, segmentDelayMs);
        input.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new AppError("canceled", 499, "Proceso cancelado."));
        });
      });
    }
    if (input.prompt.kind === "point") return fakeTracking(input.id, ROCKS.split("\n")[0].replace(/^<0f>\d+/, "<0f>100").split(/,(?=\d+<\|box)/)[0] + "\n");
    return fakeTracking(input.id, objectCount === 0 ? "" : objectCount === 1 ? BRIDGE : ROCKS);
  };
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

beforeEach(() => {
  calls.interpret = 0;
  calls.segment = 0;
  nextPlan = {};
  objectCount = 1;
  segmentDelayMs = 0;
});

async function settle(id: string): Promise<EditJob> {
  // Renders are real FFmpeg work (a few seconds for this clip).
  for (let attempt = 0; attempt < 3000; attempt++) {
    const job = await getJob(id);
    if (!["interpreting", "segmenting", "rendering"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not settle");
}

let counter = 0;
const prompt = (text = "keep the bridge in color") => `${text} ${++counter}`;

describe("job lifecycle", () => {
  it("auto-selects a single tracked object and becomes ready to render", async () => {
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt() })).id);
    expect(job.error).toBeNull();
    expect(job.status).toBe("completed");
    expect(job.selection).toEqual(["0"]);
    expect(job.objects[0].framesPresent).toBe(96);
    // Rendered with the plan's defaults and verified.
    expect(job.render).toMatchObject({ width: 1280, height: 674, frameCount: 96, params: { effect: "selective_color" } });
  });

  it("waits for the user when several objects match", async () => {
    objectCount = 16;
    nextPlan = { target: { concept: "rock", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the big rock") })).id);
    expect(job.status).toBe("awaiting_selection");
    expect(job.selection).toEqual([]);
    expect(job.objects.length).toBeGreaterThan(1);

    const chosen = await setSelection(job.id, [job.objects[2].id]);
    expect(chosen).toMatchObject({ status: "rendering", selection: [job.objects[2].id] });
    expect((await settle(job.id)).status).toBe("completed");
    await expect(setSelection(job.id, ["999"])).rejects.toMatchObject({ code: "unknown_object" });
    expect((await reopenSelection(job.id)).status).toBe("awaiting_selection");
  });

  it("selects every instance when the plan asks for all", async () => {
    objectCount = 16;
    nextPlan = { target: { concept: "stone", selection: "all" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("all the stones") })).id);
    expect(job.status).toBe("completed");
    expect(job.selection).toHaveLength(job.objects.length);
  });

  it("fails clearly for unsupported edits without calling SAM", async () => {
    nextPlan = { supported: false, unsupportedReason: "No podemos borrar objetos." };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("remove the people") })).id);
    expect(job).toMatchObject({ status: "failed", error: { code: "unsupported_edit", message: "No podemos borrar objetos." } });
    expect(calls.segment).toBe(0);
  });

  it("asks for clarification when the subject is unclear", async () => {
    nextPlan = { needsClarification: true, clarificationQuestion: "¿Qué quieres destacar?" };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("make it pop") })).id);
    expect(job).toMatchObject({ status: "awaiting_clarification", detail: "¿Qué quieres destacar?" });
  });

  it("reports when SAM finds nothing", async () => {
    objectCount = 0;
    nextPlan = { target: { concept: "unicorn", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the unicorn") })).id);
    expect(job).toMatchObject({ status: "failed", error: { code: "no_match" } });
  });
});

describe("cost protection", () => {
  it("returns the same job for a repeated instruction", async () => {
    const text = prompt("Keep   the BRIDGE");
    const first = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: text })).id);
    const again = await createJob({ videoId: video.id, effect: "reality-shift", prompt: text.toLowerCase().replace(/ +/g, " ") });
    expect(again.id).toBe(first.id);
    expect(calls.interpret).toBe(1);
  });

  it("reuses stored masks when a new instruction names the same concept", async () => {
    nextPlan = { target: { concept: "lighthouse", selection: "single" } };
    await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the lighthouse") })).id);
    const second = await settle((await createJob({ videoId: video.id, effect: "motion-echo", prompt: prompt("trails on the lighthouse") })).id);
    expect(calls.segment).toBe(1);
    expect(second.reused.segmentation).toBe(true);
  });

  it("selects an already-tracked object from a click without a paid call", async () => {
    objectCount = 16;
    nextPlan = { target: { concept: "pebble", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the pebble") })).id);
    const tracking = JSON.parse(await readFile(path.join(process.env.FOCUS_DATA_DIR!, "videos", video.id, "segmentations", `${job.segmentationId}.json`), "utf8")) as Tracking;
    const target = tracking.frames[0].objects.find((object) => object.mask)!;
    // Find a pixel the mask really covers.
    const { decodeMaskToRaster } = await import("@meta-sam/parser");
    const raster = decodeMaskToRaster(target.mask!);
    const index = raster.indexOf(1);
    const x = target.box.left + Math.floor(((index % target.mask!.width) * (target.box.right - target.box.left)) / target.mask!.width);
    const y = target.box.top + Math.floor((Math.floor(index / target.mask!.width) * (target.box.bottom - target.box.top)) / target.mask!.height);
    const before = calls.segment;
    const refined = await refineWithPoint(job.id, { frameIndex: 0, point: { x, y } });
    expect(refined.selection).toEqual([target.objectId]);
    expect(calls.segment).toBe(before);
  });

  it("runs a point prompt only for an uncovered point, then merges the new object", async () => {
    objectCount = 16;
    nextPlan = { target: { concept: "boulder", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the boulder") })).id);
    const refined = await refineWithPoint(job.id, { frameIndex: 0, point: { x: 3, y: 3 } });
    expect(refined.status).toBe("segmenting");
    const done = await settle(job.id);
    expect(done.detail).toBeNull();
    expect(done.status).toBe("awaiting_selection");
    expect(done.objects.some((object) => object.source === "point")).toBe(true);
    expect(done.selection).toEqual(["100"]);
    expect(done.segmentationId).toContain("+p-");
  });
});

describe("render reuse", () => {
  it("re-renders new parameters from cached masks and reuses identical renders", async () => {
    nextPlan = { target: { concept: "pier", selection: "single" }, effect: "background_blur" };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("blur all but the pier") })).id);
    expect(job.render?.params).toMatchObject({ effect: "background_blur", level: "high" });
    const segmentCalls = calls.segment;

    const low = await settle((await startRender(job.id, { effect: "background_blur", level: "low", feather: 1.5 })).id);
    expect(low.render?.params).toMatchObject({ level: "low" });
    expect(low.render?.key).not.toBe(job.render?.key);
    expect(low.render?.urls.video).toContain(low.render!.key);

    const started = Date.now();
    const again = await settle((await startRender(job.id, { effect: "background_blur", level: "low", feather: 1.5 })).id);
    expect(again.render?.key).toBe(low.render?.key);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls.segment).toBe(segmentCalls);
  });

  it("rejects parameters from another effect family", async () => {
    nextPlan = { target: { concept: "lamp", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the lamp") })).id);
    await expect(startRender(job.id, { effect: "motion_echo", trailCount: 3, trailSpacingMs: 120, intensity: 0.6, feather: 1 })).rejects.toMatchObject({ code: "effect_mismatch" });
  });

  it("serves the edited file, never the source", async () => {
    nextPlan = { target: { concept: "boat", selection: "single" } };
    const job = await settle((await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the boat") })).id);
    const file = await resultFile(job.id, "output");
    expect(file.path).toContain(path.join("renders", job.render!.key));
    expect(file.downloadName).toBe("focus-selective-color-clip.mp4");
  });
});

describe("cancellation and recovery", () => {
  it("cancels a running segmentation and keeps the canceled state", async () => {
    segmentDelayMs = 2000;
    nextPlan = { target: { concept: "tower", selection: "single" } };
    const job = await createJob({ videoId: video.id, effect: "reality-shift", prompt: prompt("the tower") });
    for (let attempt = 0; attempt < 100 && (await getJob(job.id)).status !== "segmenting"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const canceled = await cancelJob(job.id);
    expect(canceled.status).toBe("canceled");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await getJob(job.id)).status).toBe("canceled");
  });

  it("allows a canceled instruction to be submitted again", async () => {
    segmentDelayMs = 2000;
    nextPlan = { target: { concept: "cable", selection: "single" } };
    const text = prompt("the cable");
    const job = await createJob({ videoId: video.id, effect: "reality-shift", prompt: text });
    await cancelJob(job.id);
    segmentDelayMs = 0;
    const retry = await createJob({ videoId: video.id, effect: "reality-shift", prompt: text });
    expect(retry.id).not.toBe(job.id);
    expect((await settle(retry.id)).status).toBe("completed");
  });

  it("marks a job interrupted by a restart as failed", async () => {
    const file = path.join(process.env.FOCUS_DATA_DIR!, "jobs", "00000000-0000-4000-8000-000000000000.json");
    const now = new Date().toISOString();
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      id: "00000000-0000-4000-8000-000000000000", videoId: video.id,
      request: { videoId: video.id, effect: "reality-shift", prompt: "orphan" },
      status: "segmenting", detail: null, progress: 0.5, plan: null, segmentationId: null, objects: [], selection: [],
      reused: { plan: false, segmentation: false }, error: null, resultUrl: null, createdAt: now, updatedAt: now,
    }));
    const job = await getJob("00000000-0000-4000-8000-000000000000");
    expect(job).toMatchObject({ status: "failed", error: { code: "interrupted" } });
  });
});
