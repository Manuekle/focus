import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VideoAsset } from "../../shared/schemas";
import { ffmpeg } from "../ffmpeg";
import { VIDEO_FILES, videoDir } from "../storage";
import { ingestVideo } from "../videos";
import { readMetaConfig } from "./meta";
import { interpretInstruction } from "./planner";
import { segmentVideo } from "./sam";

// Paid, opt-in: `pnpm test:live`. Uses real Meta API credits (one Muse Spark
// call and one SAM 3.1 pass over ~48 frames). Skips without a key or footage.

const SOURCE = process.env.FOCUS_LIVE_VIDEO ?? "/System/Library/Wallpapers/.default/Golden Gate.mov";
const enabled = readMetaConfig() !== null && existsSync(SOURCE);

describe.skipIf(!enabled)("Meta API (live)", () => {
  let work: string;
  let video: VideoAsset;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "focus-live-"));
    process.env.FOCUS_DATA_DIR = path.join(work, "data");
    const clip = path.join(work, "clip.mp4");
    await ffmpeg(["-ss", "5", "-t", "2", "-i", SOURCE, "-an", "-vf", "scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip], 120_000);
    video = await ingestVideo({ body: Readable.toWeb(Readable.from(await readFile(clip))) as ReadableStream<Uint8Array>, fileName: "clip.mp4" });
  }, 180_000);

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("Muse Spark turns a Spanish instruction into a concept plan", async () => {
    const plan = await interpretInstruction({
      request: { videoId: video.id, effect: "reality-shift", prompt: "Deja el puente en color y el resto en blanco y negro" },
      posterPath: path.join(videoDir(video.id), VIDEO_FILES.poster),
      media: video.normalized,
    });
    expect(plan.supported).toBe(true);
    expect(plan.effect).toBe("selective_color");
    expect(plan.target.concept).toMatch(/bridge/);
  }, 120_000);

  it("SAM 3.1 tracks the concept on every normalized frame", async () => {
    const tracking = await segmentVideo({
      id: "live",
      videoId: video.id,
      videoDir: videoDir(video.id),
      normalizedPath: path.join(videoDir(video.id), VIDEO_FILES.normalized),
      media: video.normalized,
      prompt: { kind: "concept", concept: "bridge" },
    });
    expect(tracking.outcome.status).toBe("completed");
    expect(tracking.objects.length).toBeGreaterThanOrEqual(1);
    expect(tracking.frames.length).toBe(video.normalized.frameCount);
    for (const frame of tracking.frames) {
      for (const object of frame.objects) {
        expect(object.box.right).toBeLessThanOrEqual(video.normalized.width);
        expect(object.box.bottom).toBeLessThanOrEqual(video.normalized.height);
      }
    }
    // SAM bills a 50-frame minimum per request (observed: a 48-frame clip reports 50).
    expect(tracking.videoFramesProcessed).toBe(Math.max(50, video.normalized.frameCount));
  }, 300_000);
});
