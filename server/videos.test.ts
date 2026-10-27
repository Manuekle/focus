import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../shared/media";
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

  // Small frames keep long fixtures fast; the duration is what is under test.
  const clipOf = (seconds: number) => fixture(`clip-${seconds}s.mp4`, [
    "-f", "lavfi", "-i", `testsrc2=size=160x120:rate=24:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
  ]);

  it.each([10, 30, 60])("accepts a %i second clip and normalizes every frame", async (seconds) => {
    const asset = await ingestVideo({ body: await bodyOf(await clipOf(seconds)), fileName: `clip-${seconds}s.mp4` });
    expect(asset.source.durationSeconds).toBeCloseTo(seconds, 1);
    expect(asset.normalized.frameCount).toBe(seconds * 24);
    expect(asset.normalized.durationSeconds).toBeCloseTo(seconds, 1);
    await deleteVideo(asset.id);
  });

  it("rejects a 61 second clip and leaves nothing behind", async () => {
    const before = await readdir(path.join(work, "data", "videos")).catch(() => []);
    await expect(ingestVideo({ body: await bodyOf(await clipOf(61)), fileName: "clip-61s.mp4" })).rejects.toMatchObject({ code: "duration_too_long", status: 422 });
    expect(await readdir(path.join(work, "data", "videos")).catch(() => [])).toEqual(before);
  });

  it("rejects a declared size over 150 MB before reading the body", async () => {
    const body = Readable.toWeb(Readable.from([Buffer.from("x")])) as ReadableStream<Uint8Array>;
    await expect(ingestVideo({ body, fileName: "big.mp4", declaredBytes: MAX_UPLOAD_BYTES + 1 })).rejects.toMatchObject({ code: "file_too_large", status: 413 });
  });

  it("stops a streamed upload as soon as it passes 150 MB, without a size header", async () => {
    const chunk = Buffer.alloc(1024 * 1024);
    let sent = 0;
    async function* stream() {
      for (let index = 0; index < 151; index++) { sent++; yield chunk; }
    }
    const before = await readdir(path.join(work, "data", "videos")).catch(() => []);
    await expect(ingestVideo({ body: Readable.toWeb(Readable.from(stream())) as ReadableStream<Uint8Array>, fileName: "big.mp4" })).rejects.toMatchObject({ code: "file_too_large" });
    expect(sent).toBeGreaterThan(150);
    expect(await readdir(path.join(work, "data", "videos")).catch(() => [])).toEqual(before);
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
