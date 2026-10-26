import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VideoAssetSchema } from "../shared/schemas";
import { AppError } from "./errors";
import { ffmpeg, probe } from "./ffmpeg";
import { deleteVideo, getVideo, ingestVideo, mediaFile } from "./videos";

// End-to-end through real FFmpeg: generated fixtures, real probe, real encode.

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-test-"));
  process.env.FOCUS_DATA_DIR = path.join(work, "data");
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

async function fixture(name: string, args: string[]): Promise<string> {
  const file = path.join(work, name);
  await ffmpeg([...args, file]);
  return file;
}

async function bodyOf(file: string): Promise<ReadableStream<Uint8Array>> {
  return Readable.toWeb(Readable.from(await readFile(file))) as ReadableStream<Uint8Array>;
}

describe("ingestVideo", () => {
  it("normalizes a 1080p 30 fps MOV with audio to 720p 24 fps H.264", async () => {
    const source = await fixture("clip.mov", [
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    ]);
    const asset = await ingestVideo({ body: await bodyOf(source), fileName: "clip.mov" });

    expect(VideoAssetSchema.parse(asset)).toBeTruthy();
    expect(asset.source).toMatchObject({ width: 1920, height: 1080, hasAudio: true });
    expect(asset.normalized).toMatchObject({ width: 1280, height: 720, fps: 24, hasAudio: true, codec: "h264" });
    expect(asset.normalized.frameCount).toBe(48);

    const normalized = await mediaFile(asset.id, "normalized");
    const facts = await probe(normalized.path);
    const video = facts.streams.find((stream) => stream.codec_type === "video");
    expect(video).toMatchObject({ codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "24/1" });

    expect((await getVideo(asset.id)).id).toBe(asset.id);
    await deleteVideo(asset.id);
    await expect(getVideo(asset.id)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a clip over 10 seconds and leaves nothing behind", async () => {
    const source = await fixture("long.mp4", [
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=11",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]);
    await expect(ingestVideo({ body: await bodyOf(source), fileName: "long.mp4" })).rejects.toMatchObject({ code: "duration_too_long" });
  });

  it("rejects a file that only pretends to be a video", async () => {
    const body = Readable.toWeb(Readable.from([Buffer.from("not a video at all")])) as ReadableStream<Uint8Array>;
    await expect(ingestVideo({ body, fileName: "fake.mp4" })).rejects.toMatchObject({ code: "unreadable_media" });
  });

  it("rejects unsupported extensions before reading the body", async () => {
    const body = Readable.toWeb(Readable.from([Buffer.from("x")])) as ReadableStream<Uint8Array>;
    await expect(ingestVideo({ body, fileName: "clip.webm" })).rejects.toMatchObject({ code: "unsupported_type" });
  });
});
