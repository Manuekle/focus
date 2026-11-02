import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompareOptionsSchema } from "../../shared/rotoscope";
import { frameName } from "./extract";
import { writeManifest, type FrameState, type Manifest } from "./run-state";
import { comparisonFile, exportCompare, importConsoleRun } from "./service";

const hasFfmpeg = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;
let root: string;
let previous: string | undefined;

/** A console run of real pictures: frames 1, 2 and 4 approved, frame 3 failed. */
async function consoleRun(): Promise<string> {
  const dir = path.join(root, "console", "dance-1s");
  for (const folder of ["source", "frames", "attempts"]) await mkdir(path.join(dir, folder), { recursive: true });
  await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toFile(path.join(dir, "character.png"));
  const frames: FrameState[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const source = `source/${frameName(index)}`;
    const drawing = `frames/${frameName(index)}`;
    await sharp({ create: { width: 90, height: 160, channels: 3, background: { r: 60 * index, g: 90, b: 140 } } }).png().toFile(path.join(dir, source));
    await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.8 } } }).png().toFile(path.join(dir, drawing));
    const approved = index !== 3;
    frames.push({
      index, source, status: approved ? "approved" : "failed",
      attempts: [{ attempt: 1, at: "t", file: drawing, passed: approved, checks: [] }],
      ...(approved ? { approved: { file: drawing, sha256: createHash("sha256").update(drawing).digest("hex"), attempt: 1 } } : {}),
    });
  }
  const manifest: Manifest = { version: 1, createdAt: "2026-10-29T00:00:00.000Z", video: "clip.mov", fps: 9, start: 0, seconds: 1, crop: null, character: { file: "character.png", sha256: "x" }, maxAttempts: 3, frames };
  await writeManifest(dir, manifest);
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "roto-service-compare-"));
  previous = process.env.FOCUS_DATA_DIR;
  process.env.FOCUS_DATA_DIR = root;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = previous;
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)("rotoscope comparison clip", () => {
  it("has the unbroken run of approved frames from the first, as the Preview plays, and is the owner's alone", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    const result = await exportCompare(run.id, "owner-a", CompareOptionsSchema.parse({ size: "small" }));
    expect(result).toMatchObject({ frames: 2, format: "mp4", name: "dance-1s_side-by-side.mp4", sound: false });

    const served = await comparisonFile(run.id, "owner-a", result.file);
    expect(served.type).toBe("video/mp4");
    expect((await stat(served.file)).size).toBe(result.bytes);
    await expect(comparisonFile(run.id, "owner-b", result.file)).rejects.toThrow(/doesn’t exist/);
    await expect(exportCompare(run.id, "owner-b", CompareOptionsSchema.parse({}))).rejects.toThrow(/doesn’t exist/);
    await expect(comparisonFile(run.id, "owner-a", "../run.json")).rejects.toThrow(/no longer available/);
  });

  it("says so when the sound can't be had, and when nothing is approved", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    await expect(exportCompare(run.id, "owner-a", CompareOptionsSchema.parse({ sound: true }))).rejects.toThrow(/no longer available/);
    // GIFs are silent, so asking for sound there is not an error.
    await expect(exportCompare(run.id, "owner-a", CompareOptionsSchema.parse({ format: "gif", sound: true, size: "small" }))).resolves.toMatchObject({ format: "gif", sound: false });
  });
});
