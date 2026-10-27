import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import type { EditJob } from "../shared/schemas";
import type { Tracking } from "../shared/tracking";
import { ffmpeg } from "./ffmpeg";
import { activeJobCount, createJob, getJob, resultFile, services, setSelection, startRender } from "./jobs";
import { ingestVideo } from "./videos";
import { readFrames } from "./video/frames";
import { verifyOutput } from "./video/compositor";

// Opt-in bounded manager load, not a cloud capacity benchmark. Providers are
// replaced and keys blank; normalization, masks, queue, rendering and I/O run.
it.skipIf(process.env.FOCUS_RUN_LOAD_TESTS !== "1")("handles three waves of six jobs with simultaneous polling and cached-mask reuse", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "focus-load-"));
  const original = { ...services };
  const counts = { plans: 0, segmentations: 0, polls: 0, maxActiveJobs: 0 };
  const waves: { wave: number; durationMs: number; renders: number }[] = [];
  vi.stubEnv("FOCUS_DATA_DIR", path.join(work, "data"));
  vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "true");
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("META_API_KEY", "");
  try {
    const clip = path.join(work, "clip.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "color=c=0x1e3cd2:s=320x180:r=24:d=3", "-f", "lavfi", "-i", "color=c=0xdc1e28:s=40x40:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-filter_complex", "[0:v][1:v]overlay=x='8+n*4':y=70:eval=frame,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip]);
    const bytes = await readFile(clip);
    const videos = [];
    for (let i = 0; i < 3; i++) videos.push(await ingestVideo({ body: Readable.toWeb(Readable.from(bytes)) as ReadableStream<Uint8Array>, fileName: `load-${i}.mp4` }));
    const media = videos[0].normalized;
    const codec = await import(pathToFileURL(path.join(process.cwd(), "node_modules/@meta-sam/parser/dist/mask-codec.js")).href) as {
      encodeSegmentationMask(raster: Uint8Array, width: number, height: number): { encoding: "one_bit"; payload: string; width: number; height: number };
    };
    const frames: Tracking["frames"][number][] = [];
    for await (const pixels of readFrames(path.join(work, "data/videos", videos[0].id, "normalized.mp4"), media.width, media.height)) {
      let left = media.width, top = media.height, right = 0, bottom = 0;
      const red = (i: number) => pixels[i * 4] > 150 && pixels[i * 4 + 1] < 110 && pixels[i * 4 + 2] < 110;
      for (let i = 0; i < media.width * media.height; i++) if (red(i)) {
        left = Math.min(left, i % media.width); top = Math.min(top, Math.floor(i / media.width));
        right = Math.max(right, i % media.width + 1); bottom = Math.max(bottom, Math.floor(i / media.width) + 1);
      }
      const w = right - left, h = bottom - top;
      expect(w * h).toBeGreaterThan(0);
      const raster = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raster[y * w + x] = Number(red((y + top) * media.width + x + left));
      frames.push({ frameIndex: frames.length, timestamp: frames.length / media.fps, objects: [{ objectId: "0", box: { left, top, right, bottom }, confidence: 0.9, mask: codec.encodeSegmentationMask(raster, w, h) }] });
    }
    expect(frames).toHaveLength(media.frameCount);
    services.interpret = async ({ request }) => {
      counts.plans++;
      const wave = Number(request.prompt.match(/wave (\d)/)![1]);
      return { supported: true, target: { concept: "runner", selection: "several" }, effect: request.effect === "time-freeze" ? "time_freeze_echo" : "selective_color", parameters: { intensity: 0.4 + wave * 0.2, freezeDurationMs: 500 + wave * 500, echoCount: 3, echoSpacingMs: 320 }, needsClarification: false };
    };
    services.segment = async (input) => {
      counts.segmentations++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { id: input.id, videoId: input.videoId, source: "concept", prompt: "runner", ...media, frames, objects: [{ id: "0", framesPresent: frames.length, firstFrame: 0, lastFrame: frames.length - 1, meanConfidence: 0.9, meanArea: 1600, source: "concept" }], missingFrames: [], diagnostics: [], outcome: { status: "completed" }, videoFramesProcessed: frames.length, createdAt: new Date().toISOString() };
    };
    async function wait(jobs: readonly EditJob[], status: "awaiting_selection" | "ready_to_render" | "completed") {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const snapshots = await Promise.all(jobs.flatMap((job) => Array.from({ length: 3 }, () => getJob(job.id))));
        counts.polls += snapshots.length;
        counts.maxActiveJobs = Math.max(counts.maxActiveJobs, activeJobCount());
        expect(snapshots.filter((job) => job.status === "failed").map((job) => job.error)).toEqual([]);
        if (snapshots.every((job) => job.status === status)) return Promise.all(jobs.map((job) => getJob(job.id)));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Load jobs did not reach ${status}`);
    }
    for (let wave = 0; wave < 3; wave++) {
      const started = Date.now();
      const jobs = await Promise.all(videos.flatMap((video) => (["reality-shift", "time-freeze"] as const).map((effect) => createJob({ videoId: video.id, effect, prompt: `wave ${wave} ${effect} runner` }))));
      await wait(jobs, "awaiting_selection");
      await Promise.all(jobs.map((job) => setSelection(job.id, ["0"])));
      const temporal = await wait(jobs.filter((job) => job.request.effect === "time-freeze"), "ready_to_render");
      await Promise.all(temporal.map((job) => startRender(job.id, { ...job.params!, effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1500 } })));
      const completed = await wait(jobs, "completed");
      const files = [];
      for (const job of completed) {
        const file = await resultFile(job.id, "output");
        files.push(file.path);
        await verifyOutput(file.path, { width: media.width, height: media.height, fps: media.fps, frameCount: job.render!.frameCount, hasAudio: true, timingToleranceSeconds: 1 / media.fps });
        const repeat = await startRender(job.id, job.render!.params);
        expect((await wait([repeat], "completed"))[0].render!.key).toBe(job.render!.key);
      }
      expect(new Set(files).size).toBe(6);
      expect(counts.segmentations).toBe(3);
      waves.push({ wave, durationMs: Date.now() - started, renders: completed.length });
    }
    expect(counts.plans).toBe(18);
    const artifacts = path.resolve(".focus-data/phase10");
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, "load-report.json"), JSON.stringify({ status: "passed", finishedAt: new Date().toISOString(), scope: "single-process job manager; fake providers, real FFmpeg; not HTTP admission or cloud capacity", media, jobs: 18, waves, counts, providerCalls: 0 }, null, 2));
  } finally {
    Object.assign(services, original);
    vi.unstubAllEnvs();
    await rm(work, { recursive: true, force: true });
  }
}, 240_000);
