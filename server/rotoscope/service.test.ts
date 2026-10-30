import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listZip } from "../animation/zip";
import { frameName } from "./extract";
import { writeManifest, type Manifest } from "./run-state";
import { approveAttempt, deleteRun, exportZip, getRun, importConsoleRun, listRuns, mediaFile, startGeneration } from "./service";

let root: string;
let previous: string | undefined;

/** A console run with frame 1 approved and frame 2 stopped by the firewall after one attempt. */
async function consoleRun(): Promise<string> {
  const dir = path.join(root, "console", "test-1s");
  for (const folder of ["source", "frames", "attempts", "guides"]) await mkdir(path.join(dir, folder), { recursive: true });
  for (const name of [`source/${frameName(1)}`, `source/${frameName(2)}`, `frames/${frameName(1)}`, "attempts/frame_0001_a1.png", "attempts/frame_0002_a1.png", "character.png"]) {
    await writeFile(path.join(dir, name), name);
  }
  const { createHash } = await import("node:crypto");
  const manifest: Manifest = {
    version: 1, createdAt: "2026-10-29T00:00:00.000Z", video: "clip.mov", fps: 9, start: 0, seconds: 1, crop: null,
    character: { file: "character.png", sha256: "x" }, maxAttempts: 3,
    frames: [
      { index: 1, source: `source/${frameName(1)}`, status: "approved", attempts: [{ attempt: 1, at: "t", file: "attempts/frame_0001_a1.png", passed: true, checks: [{ name: "pose", passed: true, detail: "ok" }] }], approved: { file: `frames/${frameName(1)}`, sha256: createHash("sha256").update(`frames/${frameName(1)}`).digest("hex"), attempt: 1 } },
      { index: 2, source: `source/${frameName(2)}`, status: "failed", attempts: [{ attempt: 1, at: "t", file: "attempts/frame_0002_a1.png", passed: false, checks: [{ name: "review", passed: false, detail: "hand differs", feedback: "fix the hand" }] }] },
    ],
    halted: { frame: 2, reason: "failed 3 attempts", at: "t" },
  };
  await writeManifest(dir, manifest);
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "roto-service-"));
  previous = process.env.FOCUS_DATA_DIR;
  process.env.FOCUS_DATA_DIR = root;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = previous;
  await rm(root, { recursive: true, force: true });
});

describe("rotoscope service", () => {
  it("imports a console run into one account only", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    expect(run).toMatchObject({ name: "test-1s", phase: "ready", fps: 9, total: 2, approved: 1, halted: { frame: 2 } });
    expect(run.frames[1].attempts[0].checks[0]).toEqual({ name: "review", passed: false, detail: "hand differs" });
    expect((await listRuns("owner-a")).map((entry) => entry.id)).toEqual([run.id]);
    expect(await listRuns("owner-b")).toEqual([]);
    await expect(getRun(run.id, "owner-b")).rejects.toThrow(/doesn’t exist/);
  });

  it("serves only files the run names", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    expect(await readFile(await mediaFile(run.id, "owner-a", "frame", 1), "utf8")).toBe(`frames/${frameName(1)}`);
    expect(await readFile(await mediaFile(run.id, "owner-a", "attempt", 2, 1), "utf8")).toBe("attempts/frame_0002_a1.png");
    await expect(mediaFile(run.id, "owner-a", "frame", 2)).rejects.toThrow(/no longer available/);
    await expect(mediaFile(run.id, "owner-a", "attempt", 2, 9)).rejects.toThrow(/no longer available/);
    await expect(mediaFile("../../etc", "owner-a", "source", 1)).rejects.toThrow(/doesn’t exist/);
  });

  it("approves the halted frame's attempt by hand and exports approved frames", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    const approved = await approveAttempt(run.id, "owner-a", 2, 1);
    expect(approved).toMatchObject({ approved: 2, halted: null });
    expect(approved.frames[1]).toMatchObject({ status: "approved", manual: true, approvedAttempt: 1 });
    const zip = await exportZip(run.id, "owner-a");
    expect(zip.name).toBe("test-1s_9fps.zip");
    expect(listZip(zip.data).map((entry) => entry.name)).toEqual([frameName(1), frameName(2)]);
  });

  it("refuses to draw a complete run and deletes it", async () => {
    const run = await importConsoleRun(await consoleRun(), "owner-a");
    await approveAttempt(run.id, "owner-a", 2, 1);
    await expect(startGeneration(run.id, "owner-a", async () => {})).rejects.toThrow(/already approved/);
    await deleteRun(run.id, "owner-a");
    expect(await listRuns("owner-a")).toEqual([]);
  });
});
