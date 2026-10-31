import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, approveManually, readManifest, runFrames, writeManifest, type Check, type Manifest, type RunSteps } from "./run-state";
import { frameName } from "./extract";

let dir: string;

function manifest(frames: number, maxAttempts = 3): Manifest {
  return {
    version: 1, createdAt: "2026-10-29T00:00:00Z", video: "v.mov", fps: 9, start: 0, seconds: 1, crop: null,
    character: { file: "character.png", sha256: "x" }, maxAttempts,
    frames: Array.from({ length: frames }, (_, i) => ({ index: i + 1, source: `source/${frameName(i + 1)}`, status: "pending" as const, attempts: [] })),
  };
}

/** Draws "frame-N-aK"; fails the listed (frame, attempt) pairs. */
function scripted(fail: (frame: number, attempt: number) => boolean, calls: string[] = []): RunSteps {
  return {
    draw: async ({ frame, attempt }) => { calls.push(`${frame.index}:${attempt}`); return Buffer.from(`frame-${frame.index}-a${attempt}`); },
    validate: async (_png, { frame, attempt }): Promise<Check[]> => [{ name: "pose", passed: !fail(frame.index, attempt), detail: "d", feedback: `fix ${frame.index}` }],
  };
}

beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "roto-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runFrames", () => {
  it("approves every frame in order when all checks pass", async () => {
    await writeManifest(dir, manifest(3));
    const calls: string[] = [];
    expect(await runFrames(dir, scripted(() => false, calls))).toEqual({ kind: "complete", approved: 3 });
    expect(calls).toEqual(["1:1", "2:1", "3:1"]);
    expect((await readManifest(dir)).frames.every((f) => f.status === "approved")).toBe(true);
    expect(await readFile(path.join(dir, "frames", frameName(2)), "utf8")).toBe("frame-2-a1");
  });

  it("retries a failing frame with the failure as feedback and approves on the third attempt", async () => {
    await writeManifest(dir, manifest(5));
    const feedbacks: string[][] = [];
    const steps = scripted((frame, attempt) => frame === 4 && attempt < 3);
    const outcome = await runFrames(dir, { ...steps, draw: async (context) => { feedbacks.push([...context.feedback]); return steps.draw(context); } });
    expect(outcome.kind).toBe("complete");
    const four = (await readManifest(dir)).frames[3];
    expect(four.attempts.map((a) => a.passed)).toEqual([false, false, true]);
    expect(four.approved?.attempt).toBe(3);
    expect(feedbacks[5]).toEqual(["fix 4", "fix 4"]);
  });

  it("goes past a frame that fails every attempt, draws the rest from the last approved one, and retries it next run", async () => {
    await writeManifest(dir, manifest(6));
    const calls: string[] = [];
    const previous: (string | null)[] = [];
    const steps = scripted((frame) => frame === 4, calls);
    const first = await runFrames(dir, { ...steps, draw: async (context) => { previous.push(context.previous?.toString() ?? null); return steps.draw(context); } });
    expect(first).toEqual({ kind: "partial", approved: 5, failed: [4] });
    expect(calls).toEqual(["1:1", "2:1", "3:1", "4:1", "4:2", "4:3", "5:1", "6:1"]);
    // Frame 5 is drawn from frame 3, never from a drawing that didn't pass.
    expect(previous[6]).toBe("frame-3-a1");
    let state = await readManifest(dir);
    expect(state.frames.map((f) => f.status)).toEqual(["approved", "approved", "approved", "failed", "approved", "approved"]);
    expect(state.halted ?? null).toBeNull();

    const again: string[] = [];
    expect(await runFrames(dir, scripted(() => false, again))).toEqual({ kind: "complete", approved: 6 });
    expect(again).toEqual(["4:4"]);
    state = await readManifest(dir);
    expect(state.frames[3].approved?.attempt).toBe(4);
    expect(await readFile(path.join(dir, "frames", frameName(1)), "utf8")).toBe("frame-1-a1");
  });

  it("redraws only the chosen frame and leaves the others approved", async () => {
    await writeManifest(dir, manifest(3));
    await runFrames(dir, scripted(() => false));
    const calls: string[] = [];
    const previous: (string | null)[] = [];
    const steps = scripted(() => false, calls);
    expect(await runFrames(dir, { ...steps, draw: async (context) => { previous.push(context.previous?.toString() ?? null); return steps.draw(context); } }, { only: 2 })).toEqual({ kind: "complete", approved: 3 });
    expect(calls).toEqual(["2:2"]);
    expect(previous).toEqual(["frame-1-a1"]);
    const state = await readManifest(dir);
    expect(state.frames.map((f) => f.approved?.attempt)).toEqual([1, 2, 1]);
    expect(await readFile(path.join(dir, "frames", frameName(2)), "utf8")).toBe("frame-2-a2");
  });

  it("keeps the earlier drawing when a redraw fails every attempt, and does not halt the run", async () => {
    await writeManifest(dir, manifest(3));
    await runFrames(dir, scripted(() => false));
    const outcome = await runFrames(dir, scripted((frame, attempt) => frame === 2 && attempt > 1), { only: 2 });
    expect(outcome).toMatchObject({ kind: "halted", frame: 2 });
    const state = await readManifest(dir);
    expect(state.halted ?? null).toBeNull();
    expect(state.frames[1].status).toBe("approved");
    expect(state.frames[1].approved?.attempt).toBe(1);
    expect(state.frames[1].attempts).toHaveLength(4);
    expect(await readFile(path.join(dir, "frames", frameName(2)), "utf8")).toBe("frame-2-a1");
  });

  it("passes the last approved drawing to the next frame", async () => {
    await writeManifest(dir, manifest(3));
    const previous: (string | null)[] = [];
    const steps = scripted(() => false);
    await runFrames(dir, { ...steps, draw: async (context) => { previous.push(context.previous?.toString() ?? null); return steps.draw(context); } });
    expect(previous).toEqual([null, "frame-1-a1", "frame-2-a1"]);
  });

  it("halts on an infrastructure error without spending an attempt", async () => {
    await writeManifest(dir, manifest(3));
    const steps = scripted(() => false);
    const outcome = await runFrames(dir, { ...steps, draw: async (context) => { if (context.frame.index === 2) throw new Error("quota exceeded"); return steps.draw(context); } });
    expect(outcome).toEqual({ kind: "halted", frame: 2, reason: "error: quota exceeded" });
    expect((await readManifest(dir)).frames[1].attempts).toHaveLength(0);
  });

  it("refuses to resume when an approved frame was modified", async () => {
    await writeManifest(dir, manifest(2));
    await runFrames(dir, scripted((frame) => frame === 2));
    await writeFile(path.join(dir, "frames", frameName(1)), "tampered");
    await expect(runFrames(dir, scripted(() => false))).rejects.toThrow(/modified after approval/);
  });

  it("stops when asked, leaving the open frame for the next run instead of failing it", async () => {
    await writeManifest(dir, manifest(4));
    const controller = new AbortController();
    const steps = scripted((frame) => frame === 2);
    const outcome = await runFrames(dir, { ...steps, validate: async (png, context) => { if (context.frame.index === 2) controller.abort(); return steps.validate(png, context); } }, { signal: controller.signal });
    expect(outcome).toEqual({ kind: "stopped", frame: 2 });
    const state = await readManifest(dir);
    expect(state.frames.map((f) => f.status)).toEqual(["approved", "pending", "pending", "pending"]);
    expect(state.frames[1].attempts).toHaveLength(1);
    expect(state.halted).toBeNull();
  });

  it("stops after the frame limit and continues later", async () => {
    await writeManifest(dir, manifest(4));
    expect(await runFrames(dir, scripted(() => false), { limit: 2 })).toEqual({ kind: "limit", approved: 2, next: 3 });
    const calls: string[] = [];
    await runFrames(dir, scripted(() => false, calls));
    expect(calls).toEqual(["3:1", "4:1"]);
  });
});

describe("lock and manual approval", () => {
  it("rejects a second process while the lock is held, and takes over a dead owner's lock", async () => {
    const release = await acquireLock(dir);
    await expect(acquireLock(dir)).rejects.toThrow(/locked/);
    await release();
    await writeFile(path.join(dir, "run.lock"), JSON.stringify({ pid: 999_999_999 }));
    await (await acquireLock(dir))();
  });

  it("approves a rejected attempt of a frame the run went past, and refuses a frame never drawn", async () => {
    await writeManifest(dir, manifest(3));
    await runFrames(dir, scripted((frame) => frame === 2), { limit: 2 });
    await expect(approveManually(dir, 3, 1)).rejects.toThrow(/only the next open frame \(2\)/);
    await runFrames(dir, scripted((frame) => frame === 2));
    await approveManually(dir, 2, 2);
    const state = await readManifest(dir);
    expect(state.frames[1]).toMatchObject({ status: "approved", approved: { attempt: 2, manual: true } });
    expect(state.frames[2].status).toBe("approved");
    expect(state.halted ?? null).toBeNull();
  });

  it("lets a person choose a different attempt for a frame that is already approved", async () => {
    await writeManifest(dir, manifest(3));
    await runFrames(dir, scripted((frame, attempt) => frame === 2 && attempt === 1));
    let state = await readManifest(dir);
    expect(state.frames[1].approved?.attempt).toBe(2);
    expect(state.frames[1].attempts.map((a) => a.passed)).toEqual([false, true]);
    // The earlier, rejected attempt looks better to the person: it replaces the approved one.
    await approveManually(dir, 2, 1);
    state = await readManifest(dir);
    expect(state.frames[1]).toMatchObject({ status: "approved", approved: { attempt: 1, manual: true } });
    expect(await readFile(path.join(dir, "frames", frameName(2)), "utf8")).toBe("frame-2-a1");
    // The other frames are untouched.
    expect(state.frames.map((f) => f.approved?.attempt)).toEqual([1, 1, 1]);
  });
});
