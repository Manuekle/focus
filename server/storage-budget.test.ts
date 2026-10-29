import path from "node:path";
import { tmpdir } from "node:os";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertStorageAvailable, storageBudgetStatus, writeMediaFile } from "./storage-budget";
import { writeAtomic } from "./animation/store";
import { guardAiRequest, guardUpload } from "./guard";

let root: string;
async function encoderFixture() {
  const executable = path.join(root, "fake-encoder");
  await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
let n = 0;
const timer = setInterval(() => {
  fs.writeFileSync(path.join(process.env.FOCUS_DATA_DIR, "encoded-" + n), Buffer.alloc(250000));
  if (++n === 12) { clearInterval(timer); process.exit(0); }
}, 100);
`, { mode: 0o755 });
  vi.stubEnv("FFMPEG_PATH", executable);
  vi.resetModules();
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "focus-storage-budget-"));
  vi.stubEnv("FOCUS_DATA_DIR", root);
  vi.stubEnv("FOCUS_MAX_DATA_MB", "1");
  vi.stubEnv("FOCUS_MIN_FREE_MB", "0");
  vi.stubEnv("FOCUS_AI_DISABLED", "0");
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("demo storage budget", () => {
  it("omits protected filesystem recovery metadata while keeping the real free-space reserve", async () => {
    const metadata = path.join(root, "lost+found");
    await mkdir(metadata);
    await writeFile(path.join(metadata, "recovered"), Buffer.alloc(2 * 1024 * 1024));
    await chmod(metadata, 0o000);
    try {
      const status = await storageBudgetStatus();
      expect(status?.usedBytes).toBe(0);
      await expect(writeAtomic(path.join(root, "reference.png"), Buffer.alloc(100))).resolves.toBeUndefined();
      vi.stubEnv("FOCUS_MIN_FREE_MB", String(Math.ceil(status!.freeBytes / 1024 / 1024)));
      await expect(assertStorageAvailable()).rejects.toMatchObject({ code: "storage_full" });
    } finally { await chmod(metadata, 0o700); }
  });
  it("measures existing data and refuses a write before it fills the allowance", async () => {
    await writeFile(path.join(root, "existing.png"), Buffer.alloc(800_000));
    await expect(writeAtomic(path.join(root, "new.png"), Buffer.alloc(300_000))).rejects.toMatchObject({ code: "storage_full", status: 507 });
    expect(await readdir(root)).toEqual(["existing.png"]);
    expect((await readFile(path.join(root, "existing.png"))).byteLength).toBe(800_000);
  });
  it("serializes concurrent binary writes instead of spending the same remaining space twice", async () => {
    const results = await Promise.allSettled([writeAtomic(path.join(root, "a.png"), Buffer.alloc(600_000)), writeAtomic(path.join(root, "b.png"), Buffer.alloc(600_000))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await storageBudgetStatus())?.usedBytes).toBe(600_000);
  });
  it("also protects export frames and archives", async () => {
    await writeMediaFile(path.join(root, "frame.png"), Buffer.alloc(800_000));
    await expect(writeMediaFile(path.join(root, "export.zip"), Buffer.alloc(300_000))).rejects.toMatchObject({ code: "storage_full" });
  });
  it("still records errors and allows files to be removed when media space is exhausted", async () => {
    const file = path.join(root, "full.png");
    await writeFile(file, Buffer.alloc(1_048_576));
    await writeAtomic(path.join(root, "state.json"), JSON.stringify({ status: "failed", code: "storage_full" }));
    await rm(file);
    await expect(assertStorageAvailable(100)).resolves.toBeUndefined();
  });
  it("refuses uploads and paid work before either starts when there is no working margin", async () => {
    const request = new Request("http://focus.test/api", { method: "POST" });
    await expect(guardUpload(request)).rejects.toMatchObject({ code: "storage_full" });
    await expect(guardAiRequest(request, { activeJobs: 0, estimatedFrames: 1 })).rejects.toMatchObject({ code: "storage_full" });
  });
  it("doesn't follow links outside the data directory", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "focus-outside-"));
    try {
      await writeFile(path.join(outside, "external.bin"), Buffer.alloc(2_000_000));
      await symlink(outside, path.join(root, "external"));
      expect((await storageBudgetStatus())?.usedBytes).toBe(0);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
  it("preserves the existing unlimited mode unless the demo budget is configured", async () => {
    vi.stubEnv("FOCUS_MAX_DATA_MB", "0");
    await expect(assertStorageAvailable(10_000_000_000)).resolves.toBeUndefined();
    expect(await storageBudgetStatus()).toBeNull();
  });
  it("stops an encoder that grows past the data allowance", async () => {
    await encoderFixture();
    const { ffmpeg } = await import("./ffmpeg");
    await expect(ffmpeg([], 5000)).rejects.toMatchObject({ code: "storage_full", status: 507 });
    const count = (await readdir(root)).length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await readdir(root)).length).toBe(count);
    expect(count).toBeLessThan(13);
  });
  it("keeps the storage error when an encoder closes a backpressured frame pipe", async () => {
    await encoderFixture();
    const { writeFrames } = await import("./video/frames");
    const writer = writeFrames({ output: path.join(root, "output.mp4"), width: 1, height: 1, fps: 1, frameCount: 1 });
    try {
      await expect(writer.write(Buffer.alloc(8 * 1024 * 1024))).rejects.toMatchObject({ code: "storage_full" });
    } finally { writer.abort(); }
  });
});
