import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { WALK_POSES, cellLeftAt, cellTopAt, stageSize, type ExportRequest, type FlipbookAlignment, type FrameId, type PlaybackSettings } from "../../shared/flipbook";
import { probe } from "../ffmpeg";
import { readFrames } from "../video/frames";
import { DRIFT, walkerPng } from "./__fixtures__/walker";
import { renderExport, type ExportFrame } from "./export";
import { computeAlignment, extractSubject, renderSprite, segmentation, type Measure } from "./frame-alignment";
import { checkFrames, type QcEntry } from "./quality-control";

// Exports from deterministic sprites, verified the way a player would see
// them: FFprobe facts, decoded frames compared with the expected drawing at
// the expected place, GIF structure, sprite-sheet cells, archive contents.

segmentation.segment = null;

let work: string;
let alignment: FlipbookAlignment;
let frames: ExportFrame[];
let sprites: Buffer[];

type Rgba = { data: Buffer; width: number; height: number };

const rgba = async (png: Buffer): Promise<Rgba> => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Expected stage picture: the sprite of `tick` over a flat color, at the shared placement. */
async function expectedFrame(tick: number, settings: PlaybackSettings, background: [number, number, number]): Promise<Buffer> {
  const cell = { width: alignment.cellWidth, height: alignment.cellHeight, strideX: alignment.strideX };
  const stage = stageSize(settings, cell);
  const left = cellLeftAt(tick, settings, cell, 8);
  const top = cellTopAt(settings, cell);
  const sprite = sprites[tick % 8];
  const base = sharp({ create: { width: stage.width, height: stage.height, channels: 3, background: { r: background[0], g: background[1], b: background[2] } } });
  const x0 = Math.max(0, left);
  const x1 = Math.min(stage.width, left + cell.width);
  if (x1 <= x0) return base.raw().toBuffer();
  const visible = await sharp(sprite).extract({ left: x0 - left, top: 0, width: x1 - x0, height: cell.height }).png().toBuffer();
  return base.composite([{ input: visible, left: x0, top }]).removeAlpha().raw().toBuffer();
}

function meanDiff(a: Buffer, aChannels: number, b: Buffer, bChannels: number, pixels: number): number {
  let sum = 0;
  for (let index = 0; index < pixels; index++) for (let c = 0; c < 3; c++) sum += Math.abs(a[index * aChannels + c] - b[index * bChannels + c]);
  return sum / (pixels * 3);
}

function alphaIou(a: Rgba, b: Rgba): number {
  let both = 0, either = 0;
  for (let index = 0; index < a.width * a.height; index++) {
    const x = a.data[index * 4 + 3] >= 128, y = b.data[index * 4 + 3] >= 128;
    if (x || y) either++;
    if (x && y) both++;
  }
  return either ? both / either : 1;
}

const cellOf = () => ({ width: alignment.cellWidth, height: alignment.cellHeight, strideX: alignment.strideX });

const settings = (overrides: Partial<PlaybackSettings> = {}): PlaybackSettings => ({ drawingFps: 8, durationSeconds: 2, motion: "in_place", aspect: "16:9", speed: 1, ...overrides });
const request = (format: ExportRequest["format"], overrides: Partial<ExportRequest> = {}): ExportRequest => ({ format, settings: settings(), background: { kind: "color", color: "#ffffff" }, ...overrides });
const exportTo = async (name: string, value: ExportRequest) =>
  renderExport({ request: value, frames, alignment, plate: null, outputDir: path.join(work, name), baseName: "walk" });

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-flipbook-export-"));
  const extractions = await Promise.all(DRIFT.map(async (drift) => extractSubject({ png: await walkerPng(drift.phase, drift), concept: "walker", flipbookId: "test", allowAlpha: false })));
  const entries = extractions.map((extraction, index) => ({ frameId: `f${index}` as FrameId, version: `v-00000000000${index}`, phase: WALK_POSES[index].phase, relativeRootY: WALK_POSES[index].relativeRootY, measure: extraction.measure }));
  alignment = computeAlignment(entries, null);
  sprites = await Promise.all(entries.map((entry, index) => renderSprite(extractions[index].cutout, entry.measure, alignment.transforms[entry.frameId]!, { width: alignment.cellWidth, height: alignment.cellHeight })));
  frames = await Promise.all(sprites.map(async (sprite, index) => {
    const spritePath = path.join(work, `sprite-${index}.png`);
    await writeFile(spritePath, sprite);
    return { frameId: `f${index}`, label: WALK_POSES[index].label, phase: WALK_POSES[index].phase, spritePath };
  }));
});

describe("MP4", () => {
  it("is H.264 yuv420p at 24 fps with the exact duration, each drawing held on threes", async () => {
    const result = await exportTo("mp4", request("mp4"));
    const file = result.files[0].path;
    const facts = await probe(file);
    const video = facts.streams.find((stream) => stream.codec_type === "video")!;
    expect(video.codec_name).toBe("h264");
    expect((video as { pix_fmt?: string }).pix_fmt).toBe("yuv420p");
    expect(video.avg_frame_rate).toBe("24/1");
    expect(Number(video.nb_frames)).toBe(48);
    expect(Math.abs(Number(facts.format.duration) - 2)).toBeLessThan(0.05);
    expect(facts.streams.some((stream) => stream.codec_type === "audio")).toBe(false);
    const stage = stageSize(settings(), cellOf());
    expect(result.facts).toMatchObject({ width: stage.width, height: stage.height, frames: 48 });

    // Decoded frame k is drawing floor(k/3) mod 8: the real sequence, looping after 24 frames.
    const decoded: Buffer[] = [];
    for await (const frame of readFrames(file, stage.width, stage.height)) decoded.push(frame);
    expect(decoded.length).toBe(48);
    const pixels = stage.width * stage.height;
    for (const k of [0, 2, 3, 10, 23, 24, 47]) {
      const expected = await expectedFrame(Math.floor(k / 3), settings(), [255, 255, 255]);
      expect(meanDiff(decoded[k], 4, expected, 3, pixels)).toBeLessThan(4);
    }
    expect(meanDiff(decoded[0], 4, decoded[2], 4, pixels)).toBeLessThan(1);
    expect(meanDiff(decoded[2], 4, decoded[3], 4, pixels)).toBeGreaterThan(1);
    expect(meanDiff(decoded[0], 4, decoded[24], 4, pixels)).toBeLessThan(1);
  });

  it("carries the walk across the stage when walking right", async () => {
    const value = request("mp4", { settings: settings({ motion: "right" }) });
    const result = await exportTo("mp4-right", value);
    const cell = { width: alignment.cellWidth, height: alignment.cellHeight, strideX: alignment.strideX };
    const stage = stageSize(value.settings, cell);
    expect(result.facts.width).toBe(stage.width);
    const decoded: Buffer[] = [];
    for await (const frame of readFrames(result.files[0].path, stage.width, stage.height)) decoded.push(frame);
    for (const k of [0, 3, 12, 30]) {
      expect(meanDiff(decoded[k], 4, await expectedFrame(Math.floor(k / 3), value.settings, [255, 255, 255]), 3, stage.width * stage.height)).toBeLessThan(4);
    }
    expect(cellLeftAt(4, value.settings, cell, 8)).toBeGreaterThan(cellLeftAt(0, value.settings, cell, 8));
  });

  it("renders a 9:16 portrait stage with the drawing standing on the bottom", async () => {
    const value = request("mp4", { settings: settings({ aspect: "9:16" }) });
    const result = await exportTo("mp4-portrait", value);
    const stage = stageSize(value.settings, cellOf());
    expect(stage.height).toBeGreaterThan(stage.width);
    expect(result.facts).toMatchObject({ width: stage.width, height: stage.height });
    const decoded: Buffer[] = [];
    for await (const frame of readFrames(result.files[0].path, stage.width, stage.height)) decoded.push(frame);
    for (const k of [0, 10, 30]) {
      expect(meanDiff(decoded[k], 4, await expectedFrame(Math.floor(k / 3), value.settings, [255, 255, 255]), 3, stage.width * stage.height)).toBeLessThan(4);
    }
  });

  it("is never transparent", async () => {
    await expect(exportTo("mp4-alpha", request("mp4", { background: { kind: "transparent" } }))).rejects.toMatchObject({ code: "mp4_needs_background" });
  });
});

describe("in-betweens", () => {
  it("plays each one for a frame taken from the key before it, and exports it with its duration", async () => {
    // Keys and in-betweens alternate; an in-between borrows a sprite unlike both of its keys, so every change shows.
    const cycle: ExportFrame[] = frames.flatMap((frame, index) => [frame, { ...frames[(index + 2) % frames.length], frameId: `i${index}`, label: "in-between", phase: frame.phase, inbetween: true }]);
    const value = request("mp4", { background: { kind: "color", color: "#ffffff" } });
    const result = await renderExport({ request: value, frames: cycle, alignment, plate: null, outputDir: path.join(work, "inbetween-mp4"), baseName: "walk" });
    expect(result.facts.frames).toBe(48);
    const stage = stageSize(value.settings, cellOf());
    const decoded: Buffer[] = [];
    for await (const frame of readFrames(result.files[0].path, stage.width, stage.height)) decoded.push(frame);
    // H.264 adds a little noise to a held picture; a new drawing moves far more.
    const moved = (a: Buffer, b: Buffer) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length > 0.3;
    const changes = decoded.slice(1, 24).map((frame, index) => (moved(frame, decoded[index]) ? 1 : 0));
    // Key on twos, in-between on ones: changes after frames 2, 3, 5, 6, … of the 24-frame cycle.
    expect(changes.join("")).toBe("01101101101101101101101");
    const zip = await renderExport({ request: request("frames", { background: { kind: "transparent" } }), frames: cycle, alignment, plate: null, outputDir: path.join(work, "inbetween-zip"), baseName: "walk" });
    expect(zip.facts.frames).toBe(16);
  });
});

describe("GIF", () => {
  it("loops one cycle forever with each drawing held on threes at 24 fps, in order, with transparency", async () => {
    const result = await exportTo("gif", request("gif", { background: { kind: "transparent" } }));
    // 8 drawings × 3 frames: the GIF keeps the 24 fps exposure sheet; a repeated frame costs almost nothing.
    expect(result.facts.frames).toBe(24);
    expect(result.facts.durationSeconds).toBeGreaterThan(0.95);
    expect(result.facts.durationSeconds).toBeLessThan(1.05);
    const { width, height } = result.facts;
    expect(Math.max(width, height)).toBeLessThanOrEqual(640);
    const decoded: Rgba[] = [];
    for await (const frame of readFrames(result.files[0].path, width, height)) decoded.push({ data: frame, width, height });
    expect(decoded.length).toBe(24);
    // The drawing sits centered on the stage; compare that region, scaled like the GIF.
    const stage = stageSize(settings(), cellOf());
    const scale = width / stage.width;
    const region = { left: Math.round(cellLeftAt(0, settings(), cellOf(), 8) * scale), width: Math.round(alignment.cellWidth * scale), height: Math.round(alignment.cellHeight * scale) };
    const crop = (frame: Rgba): Rgba => {
      const data = Buffer.alloc(region.width * region.height * 4);
      for (let y = 0; y < region.height; y++) frame.data.copy(data, y * region.width * 4, (y * frame.width + region.left) * 4, (y * frame.width + region.left + region.width) * 4);
      return { data, width: region.width, height: region.height };
    };
    const expected = await Promise.all(sprites.map(async (sprite) => rgba(await sharp(sprite).resize(region.width, region.height, { fit: "fill" }).png().toBuffer())));
    // Each decoded frame matches its own drawing best. The fixture's two half-cycles share
    // silhouettes (only the leg shading swaps), so the phase is compared modulo four.
    decoded.forEach((frame, outputFrame) => {
      const index = Math.floor(outputFrame / 3);
      const scores = expected.map((sprite) => alphaIou(crop(frame), sprite));
      expect(scores[index]).toBeGreaterThan(0.85);
      expect(scores.indexOf(Math.max(...scores)) % 4).toBe(index % 4);
    });
    // Transparent outside the character.
    expect(decoded[0].data[3]).toBe(0);
  });
});

describe("sprite sheet", () => {
  it("lays the drawings out in playback order with alpha and an atlas", async () => {
    const result = await exportTo("sheet", request("spritesheet", { background: { kind: "transparent" } }));
    const [sheetFile, atlasFile] = result.files;
    const meta = await sharp(sheetFile.path).metadata();
    expect(meta.width).toBe(alignment.cellWidth * 4);
    expect(meta.height).toBe(alignment.cellHeight * 2);
    expect(meta.hasAlpha).toBe(true);
    const atlas = JSON.parse(await readFile(atlasFile.path, "utf8"));
    expect(atlas.animations.walk).toEqual(Array.from({ length: 8 }, (_, index) => `frame_00${index}.png`));
    for (let index = 0; index < 8; index++) {
      const box = atlas.frames[`frame_00${index}.png`].frame;
      expect(box).toEqual({ x: (index % 4) * alignment.cellWidth, y: Math.floor(index / 4) * alignment.cellHeight, w: alignment.cellWidth, h: alignment.cellHeight });
      expect(atlas.frames[`frame_00${index}.png`].phase).toBe(WALK_POSES[index].phase);
      const cell = await rgba(await sharp(sheetFile.path).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer());
      expect(alphaIou(cell, await rgba(sprites[index]))).toBeGreaterThan(0.99);
    }
  });

  it("refuses a scene background", async () => {
    await expect(exportTo("sheet-scene", request("spritesheet", { background: { kind: "scene" } }))).rejects.toMatchObject({ code: "sprites_background" });
  });
});

describe("PNG frame archive", () => {
  it("contains frame_000…frame_007 as decodable images of the right drawings, plus timing metadata", async () => {
    const result = await exportTo("zip", request("frames", { background: { kind: "transparent" } }));
    const archive = await readFile(result.files[0].path);
    // Independent reader: walk the local file headers and inflate each entry.
    const entries: { name: string; data: Buffer }[] = [];
    let at = 0;
    while (archive.readUInt32LE(at) === 0x04034b50) {
      const compressed = archive.readUInt32LE(at + 18);
      const nameLength = archive.readUInt16LE(at + 26);
      const extra = archive.readUInt16LE(at + 28);
      const name = archive.subarray(at + 30, at + 30 + nameLength).toString("utf8");
      const start = at + 30 + nameLength + extra;
      entries.push({ name, data: inflateRawSync(archive.subarray(start, start + compressed)) });
      at = start + compressed;
    }
    expect(entries.map((entry) => entry.name)).toEqual([...Array.from({ length: 8 }, (_, index) => `frame_00${index}.png`), "animation.json"]);
    for (let index = 0; index < 8; index++) {
      const image = await rgba(entries[index].data);
      expect(image.width).toBe(alignment.cellWidth);
      expect(image.height).toBe(alignment.cellHeight);
      expect(alphaIou(image, await rgba(sprites[index]))).toBeGreaterThan(0.99);
    }
    const meta = JSON.parse(entries[8].data.toString("utf8"));
    expect(meta).toMatchObject({ loop: true, frameRate: 8, frameDurationMs: 125 });
    expect(meta.order.map((entry: { phase: string }) => entry.phase)).toEqual(WALK_POSES.map((pose) => pose.phase));
  });
});

describe("quality checks", () => {
  const entry = (index: number, sprite: Buffer, overrides: Partial<Measure> = {}): QcEntry => ({
    frameId: `f${index}`, label: WALK_POSES[index].label, phase: WALK_POSES[index].phase, scale: alignment.transforms[`f${index}` as FrameId]!.scale, sprite,
    measure: { rawWidth: 1024, rawHeight: 1536, crop: { left: 0, top: 0, width: 10, height: 10 }, topY: 0, footY: 600, torsoX: 0, lowerSpan: 0, coverage: 0.1, touchesEdge: false, histogram: Array(64).fill(1 / 64), method: "sam" as const, multiple: false, backgroundUniformity: 1, ...overrides },
  });

  it("flags a frame that repeats its neighbor, and nothing on a clean cycle", async () => {
    const clean = await checkFrames(sprites.map((sprite, index) => entry(index, sprite)), Array(64).fill(1 / 64));
    expect([...clean.values()].flatMap((result) => result.warnings.map((warning) => warning.code)).filter((code) => code === "near_duplicate")).toEqual([]);
    const repeated = await checkFrames(sprites.map((sprite, index) => entry(index, index === 3 ? sprites[2] : sprite)), null);
    expect(repeated.get("f3")!.warnings.map((warning) => warning.code)).toContain("near_duplicate");
  });

  it("flags color drift, cropping, size drift and a missing stride", async () => {
    const red = Array(64).fill(0); red[48] = 1;
    const results = await checkFrames(sprites.map((sprite, index) => entry(index, sprite, index === 0 ? { histogram: red, touchesEdge: true, lowerSpan: 1 } : { lowerSpan: 100 })), Array(64).fill(1 / 64));
    const codes = results.get("f0")!.warnings.map((warning) => warning.code);
    expect(codes).toEqual(expect.arrayContaining(["color_shift", "subject_cropped", "stride_unclear"]));
    // A quiet motion: the same drawing twice is expected, not flagged.
    const subtle = await checkFrames(sprites.map((sprite, index) => entry(index, index === 3 ? sprites[2] : sprite)), null, "idle");
    expect(subtle.get("f3")!.warnings.map((warning) => warning.code)).not.toContain("near_duplicate");
    // A crouch planned 20% shorter is scaled 20% less on purpose: no resize warning.
    const crouched = await checkFrames(sprites.map((sprite, index) => ({ ...entry(index, sprite), scale: index === 5 ? 0.8 : 1, relativeRootY: index === 5 ? -0.2 : 0 })), null);
    expect(crouched.get("f5")!.warnings.map((warning) => warning.code)).not.toContain("scale_corrected");
    const scaled = await checkFrames(sprites.map((sprite, index) => ({ ...entry(index, sprite), scale: index === 5 ? 2 : 1 })), null);
    expect(scaled.get("f5")!.warnings.map((warning) => warning.code)).toContain("scale_corrected");
  });
});

describe("moving scenes", () => {
  const plateWithMarks = async (name: string, alpha = false) => {
    const width = 960, height = 540;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = Math.round((x / width) * 255); data[at + 1] = Math.round((y / height) * 255); data[at + 2] = 120;
      data[at + 3] = alpha && y < height / 2 ? 0 : 255;
    }
    const file = path.join(work, name);
    await writeFile(file, await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer());
    return file;
  };
  const corner = (frame: Buffer, width: number) => [...frame.subarray((10 * width + 10) * 4, (10 * width + 10) * 4 + 3)];

  it("zooms the scene in over the clip and back out, under the drawings", async () => {
    const value = request("mp4", { background: { kind: "scene", motion: "zoom" } });
    const result = await renderExport({ request: value, frames, alignment, plate: await plateWithMarks("zoom.png"), outputDir: path.join(work, "zoom"), baseName: "walk" });
    const decoded: Buffer[] = [];
    const stageWidth = stageSize(value.settings, cellOf()).width;
    for await (const frame of readFrames(result.files[0].path, stageWidth, stageSize(value.settings, cellOf()).height)) decoded.push(frame);
    expect(decoded).toHaveLength(48);
    // The corner pixel moves toward the center as the picture zooms in, and comes back at the end.
    const start = corner(decoded[0], stageWidth), middle = corner(decoded[24], stageWidth), end = corner(decoded[47], stageWidth);
    expect(Math.abs(middle[0] - start[0]) + Math.abs(middle[1] - start[1])).toBeGreaterThan(4);
    expect(Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1])).toBeLessThan(Math.abs(middle[0] - start[0]) + Math.abs(middle[1] - start[1]));
  });

  it("slides the far layer slower than the near one in parallax", async () => {
    const value = request("gif", { background: { kind: "scene", motion: "parallax" } });
    const result = await renderExport({ request: value, frames, alignment, plate: await plateWithMarks("near.png", true), far: await plateWithMarks("far.png"), outputDir: path.join(work, "parallax"), baseName: "walk" });
    // A moving background takes the whole length at 24 fps, not one looping cycle.
    expect(result.facts.frames).toBe(48);
  });
});
