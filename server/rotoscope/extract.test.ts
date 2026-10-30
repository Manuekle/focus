import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpeg } from "../ffmpeg";
import { detectCrop, extractFrames, frameName, mostFrequentCrop } from "./extract";

let dir: string;
let video: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "roto-extract-"));
  video = path.join(dir, "clip.mp4");
  // A 60 fps phone-style recording: 200×280 picture between black bars, 3 s long.
  await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=200x280:rate=60:duration=3", "-vf", "pad=200:360:0:40:black", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe("extract", () => {
  it("finds the letterbox", async () => {
    expect(await detectCrop(video, 0, 1)).toEqual({ width: 200, height: 280, x: 0, y: 40 });
  });

  it("takes exactly 9 cropped frames from one second at 9 fps", async () => {
    const out = path.join(dir, "one");
    expect(await extractFrames({ video, out, fps: 9, start: 0, seconds: 1, crop: { width: 200, height: 280, x: 0, y: 40 } })).toBe(9);
    expect(await sharp(path.join(out, frameName(1))).metadata()).toMatchObject({ width: 200, height: 280 });
  });

  it("takes every frame of the whole clip when no length is given", async () => {
    expect(await extractFrames({ video, out: path.join(dir, "all"), fps: 9, start: 0, crop: null })).toBe(27);
  });

  it("picks the most frequent crop from the log", () => {
    expect(mostFrequentCrop("crop=10:10:0:0\ncrop=8:6:1:2\ncrop=8:6:1:2")).toEqual({ width: 8, height: 6, x: 1, y: 2 });
    expect(mostFrequentCrop("nothing")).toBeNull();
  });
});
