import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderExport, type ExportFrame } from "./export";
import { ffmpeg, probe } from "../ffmpeg";
import { readFrames } from "../video/frames";
import { audioGraph } from "./flipbook-audio";
import { listZip } from "./zip";
import type { ExportRequest, FlipbookAlignment } from "../../shared/flipbook";

let work: string;
const frames: ExportFrame[] = [];
const alignment: FlipbookAlignment = { cellWidth: 32, cellHeight: 48, targetHeight: 48, baselineY: 48, strideX: 0, strideMeasured: false, transforms: {} };
const request: ExportRequest = { format: "mp4", settings: { drawingFps: 24, durationSeconds: 4, motion: "in_place", aspect: "16:9", speed: 1 }, background: { kind: "color", color: "#ffffff" } };

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-sequence-export-"));
  for (let index = 0; index < 96; index++) {
    const file = path.join(work, `pose-${index}.png`);
    await writeFile(file, await sharp({ create: { width: 32, height: 48, channels: 4, background: { r: index * 2, g: 40, b: 80, alpha: 1 } } }).png().toBuffer());
    frames.push({ frameId: `s${index}`, phase: `sample_${index}`, label: `At ${index / 24}`, spritePath: file });
  }
});
afterAll(async () => { await rm(work, { recursive: true, force: true }); });

describe("finite sequence exports", () => {
  it("decodes all four seconds without wrapping to an earlier pose and retains short offset audio", async () => {
    const tone = path.join(work, "tone.wav"), padded = path.join(work, "padded.m4a");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", tone]);
    await ffmpeg(["-i", tone, "-af", audioGraph({ offset: 0, startsAt: 1, volume: 0.5 }, 4), "-c:a", "aac", padded]);
    const result = await renderExport({ request, frames, alignment, plate: null, outputDir: path.join(work, "mp4"), baseName: "sequence", finite: true, audioFrom: padded });
    expect(result.facts).toMatchObject({ frames: 240, fps: 60 });
    expect(result.facts.durationSeconds).toBeCloseTo(4, 2);
    const file = result.files[0].path;
    expect((await probe(file)).streams.some((stream) => stream.codec_type === "audio")).toBe(true);
    const colors = new Map<number, number>();
    let index = 0;
    for await (const frame of readFrames(file, result.facts.width, result.facts.height)) {
      if ([0, 60, 239].includes(index)) colors.set(index, frame[(24 * result.facts.width + Math.floor(result.facts.width / 2)) * 4]);
      index++;
    }
    expect(index).toBe(240);
    expect(colors.get(0)).toBeLessThan(8);
    expect(colors.get(60)).toBeGreaterThan(40);
    expect(colors.get(60)).toBeLessThan(56);
    expect(colors.get(239)).toBeGreaterThan(180);
    const raw = path.join(work, "decoded.pcm");
    await ffmpeg(["-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", raw]);
    const samples = await readFile(raw);
    const rms = (from: number, to: number) => {
      let sum = 0, count = 0;
      for (let i = Math.floor(from * 48000); i < Math.min(samples.length / 2, Math.floor(to * 48000)); i++) { sum += samples.readInt16LE(i * 2) ** 2; count++; }
      return Math.sqrt(sum / count);
    };
    expect(rms(0.1, 0.8)).toBeLessThan(20);
    expect(rms(1.1, 1.4)).toBeGreaterThan(500);
    expect(rms(2, 3.8)).toBeLessThan(20);
  });
  it("exports all 480 PNG entries with exact total timing using a streamed archive", async () => {
    const all = Array.from({ length: 480 }, (_, i) => ({ ...frames[i % frames.length], frameId: `s${i}`, phase: `sample_${i}` }));
    const result = await renderExport({ request: { ...request, format: "frames", settings: { ...request.settings, durationSeconds: 20 } }, frames: all, alignment, plate: null, outputDir: path.join(work, "zip"), baseName: "sequence", finite: true });
    expect(listZip(await readFile(result.files[0].path))).toHaveLength(481);
    expect(result.facts).toMatchObject({ frames: 480, durationSeconds: 20 });
  });
  it("pages an atlas within 4096 pixels while preserving global order and per-frame durations", async () => {
    const all = Array.from({ length: 480 }, (_, i) => ({ ...frames[i % frames.length], frameId: `s${i}`, phase: `sample_${i}` }));
    const result = await renderExport({ request: { ...request, format: "spritesheet", settings: { ...request.settings, durationSeconds: 20 } }, frames: all, alignment: { ...alignment, cellWidth: 256, cellHeight: 256 }, plate: null, outputDir: path.join(work, "atlas"), baseName: "sequence", finite: true });
    const manifest = result.files.find((file) => file.type === "application/json")!;
    const atlas = JSON.parse(await readFile(manifest.path, "utf8"));
    expect(atlas.pages).toHaveLength(2);
    expect(Object.keys(atlas.frames)).toHaveLength(480);
    expect(atlas.meta.loop).toBe(false);
    expect(atlas.meta.frameDurationsMs.reduce((sum: number, value: number) => sum + value, 0)).toBe(20000);
    for (const page of result.files.filter((file) => file.type === "image/png")) {
      const meta = await sharp(page.path).metadata();
      expect(meta.width).toBeLessThanOrEqual(4096);
      expect(meta.height).toBeLessThanOrEqual(4096);
    }
  });
});
