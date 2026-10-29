import path from "node:path";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  PlaybackSettingsSchema,
  drawingAtOutputFrame,
  exposures,
  outputFrameAtTick,
  type ExportRequest,
  type FlipbookAlignment,
} from "../../shared/flipbook";
import { probe } from "../ffmpeg";
import { readFrames } from "../video/frames";
import { renderExport, type ExportFrame } from "./export";

let work: string;
let frames: ExportFrame[];
const alignment: FlipbookAlignment = {
  cellWidth: 64,
  cellHeight: 96,
  targetHeight: 56,
  baselineY: 96,
  strideX: 20,
  strideMeasured: true,
  transforms: {},
};
const request = (
  drawingFps: 8 | 12,
  motion: "in_place" | "right" = "in_place",
): ExportRequest => ({
  format: "mp4",
  settings: {
    drawingFps,
    motion,
    durationSeconds: 2,
    aspect: "9:16",
    speed: 1,
    renderMode: "smooth",
  },
  background: { kind: "color", color: "#ffffff" },
});
const diff = (a: Buffer, b: Buffer) =>
  a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-smooth-"));
  const reze = await sharp(
    await readFile(path.join(process.cwd(), "public/characters/reze.jpeg")),
  )
    .resize(28, 56)
    .png()
    .toBuffer();
  frames = [];
  for (let i = 0; i < 8; i++) {
    const file = path.join(work, `reze-${i}.png`);
    await sharp({
      create: { width: 64, height: 96, channels: 4, background: "#ffffff" },
    })
      .composite([{ input: reze, left: 4 + i * 3, top: 20 }])
      .png()
      .toFile(file);
    frames.push({
      frameId: `f${i}`,
      label: `Reze ${i}`,
      phase: "wave_rest",
      spritePath: file,
    });
  }
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

it("preserves legacy timing and validates the optional playback mode", () => {
  const old = { ...request(8).settings, renderMode: undefined };
  expect(PlaybackSettingsSchema.parse(old).renderMode).toBeUndefined();
  expect(
    PlaybackSettingsSchema.safeParse({ ...old, renderMode: "smooth" }).success,
  ).toBe(true);
  expect(
    PlaybackSettingsSchema.safeParse({ ...old, renderMode: "arbitrary-filter" })
      .success,
  ).toBe(false);
});

it.each([8, 12] as const)(
  "renders a legacy smooth request as held drawings at 60 fps, %i drawings/s, never blended",
  async (fps) => {
    const result = await renderExport({
      request: request(fps),
      frames,
      alignment,
      plate: null,
      outputDir: path.join(work, `legacy-${fps}`),
      baseName: "legacy",
    });
    const facts = await probe(result.files[0].path);
    const stream = facts.streams.find((item) => item.codec_type === "video")!;
    expect(stream.avg_frame_rate).toBe("60/1");
    expect(result.facts).toMatchObject({ frames: 120, durationSeconds: 2, fps: 60 });
    const decoded: Buffer[] = [];
    for await (const frame of readFrames(result.files[0].path, result.facts.width, result.facts.height)) decoded.push(frame);
    expect(decoded).toHaveLength(120);
    const holds = exposures(frames.map((frame) => frame.phase), fps);
    // Inside a hold the picture repeats; it only changes on a new drawing.
    for (let index = 0; index < decoded.length; index++) {
      const { tick } = drawingAtOutputFrame(index, holds);
      const start = outputFrameAtTick(tick, holds);
      expect(diff(decoded[index], decoded[start])).toBeLessThan(1);
      if (index === start && index > 0) expect(diff(decoded[index], decoded[index - 1])).toBeGreaterThan(0.15);
    }
    expect(await readdir(path.dirname(result.files[0].path))).toEqual(["legacy.mp4"]);
  },
);
