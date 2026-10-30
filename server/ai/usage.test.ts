import os from "node:os";
import path from "node:path";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concurrency } from "./meta";
import { recordUsage, samFramesSince } from "./usage";

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "focus-usage-"));
  vi.stubEnv("FOCUS_DATA_DIR", work);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true });
});

describe("SAM budget", () => {
  it("counts only billed frames since the moment, reading new lines as they arrive", async () => {
    const since = new Date(Date.now() - 60_000);
    await recordUsage({ model: "sam", kind: "segment", cached: false, ok: true, videoFramesProcessed: 120 });
    await recordUsage({ model: "sam", kind: "segment", cached: true, ok: true, videoFramesProcessed: 999 });
    await recordUsage({ model: "sam", kind: "segment_image", cached: false, ok: true });
    expect(await samFramesSince(since)).toBe(121);

    await recordUsage({ model: "sam", kind: "segment", cached: false, ok: true, videoFramesProcessed: 30 });
    expect(await samFramesSince(since)).toBe(151);
    expect(await samFramesSince(new Date(Date.now() + 60_000))).toBe(0);
  });

  it("waits for a line still being written and starts over when the log is replaced", async () => {
    const file = path.join(work, "usage.jsonl");
    const line = (frames: number) => JSON.stringify({ at: new Date().toISOString(), model: "sam", kind: "segment", cached: false, ok: true, videoFramesProcessed: frames });
    await writeFile(file, `${line(10)}\n${line(20).slice(0, 12)}`);
    expect(await samFramesSince(new Date(0))).toBe(10);
    await appendFile(file, `${line(20).slice(12)}\n`);
    expect(await samFramesSince(new Date(0))).toBe(30);

    await rm(file);
    await writeFile(file, `${line(5)}\n`);
    expect(await samFramesSince(new Date(0))).toBe(5);
  });
});

describe("concurrency", () => {
  it("reads whole numbers from 1 to 16 and falls back otherwise", () => {
    expect(concurrency("X", 2, { X: "4" })).toBe(4);
    expect(concurrency("X", 2, {})).toBe(2);
    expect(concurrency("X", 2, { X: "0" })).toBe(2);
    expect(concurrency("X", 2, { X: "1.5" })).toBe(2);
    expect(concurrency("X", 2, { X: "99" })).toBe(2);
  });
});
