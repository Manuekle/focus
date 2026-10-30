import path from "node:path";
import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { frameName } from "./extract";

// The rotoscope run on disk and its firewall. Frames are drawn strictly in
// order; a frame advances only when every check passes. After maxAttempts
// failures, or any error, the run halts on that frame with the reason saved.
// The next run resumes there. An approved frame is immutable: its hash is
// checked on every resume and it is never drawn again.

export type Check = {
  readonly name: string;
  readonly passed: boolean;
  /** One line for the console and the report. */
  readonly detail: string;
  /** What the next attempt should fix, said to the generator. */
  readonly feedback?: string;
  readonly score?: number;
};

export type Attempt = {
  readonly attempt: number;
  readonly at: string;
  readonly file: string;
  readonly passed: boolean;
  readonly checks: readonly Check[];
};

export type FrameState = {
  readonly index: number;
  readonly source: string;
  status: "pending" | "approved" | "failed";
  attempts: Attempt[];
  approved?: { readonly file: string; readonly sha256: string; readonly attempt: number; readonly manual?: boolean };
  /** A person's note for the next drawing of this frame: their pencil marks over an earlier drawing and a comment. Cleared on approval. */
  correction?: FrameCorrection;
};

export type FrameCorrection = {
  readonly comment: string;
  /** The earlier drawing with the pencil marks over it, relative to the run folder. */
  readonly marked: string;
  /** The attempt the marks were drawn on. */
  readonly attempt: number;
  readonly at: string;
};

export type Manifest = {
  readonly version: 1;
  /** Runs made in the app belong to an account; console runs have none. */
  readonly ownerId?: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly video: string;
  readonly fps: number;
  readonly start: number;
  readonly seconds: number | null;
  readonly crop: { width: number; height: number; x: number; y: number } | null;
  readonly character: { readonly file: string; readonly sha256: string };
  readonly maxAttempts: number;
  frames: FrameState[];
  halted?: { readonly frame: number; readonly reason: string; readonly at: string } | null;
};

export type DrawContext = {
  readonly frame: FrameState;
  readonly attempt: number;
  /** The last approved drawing before this frame, if any. */
  readonly previous: Buffer | null;
  /** Feedback from this frame's earlier failed attempts in this run, newest last. */
  readonly feedback: readonly string[];
};

export type RunSteps = {
  readonly draw: (context: DrawContext) => Promise<Buffer>;
  readonly validate: (png: Buffer, context: DrawContext) => Promise<readonly Check[]>;
  readonly log?: (line: string) => void;
};

export type RunOutcome =
  | { readonly kind: "complete"; readonly approved: number }
  | { readonly kind: "halted"; readonly frame: number; readonly reason: string }
  | { readonly kind: "stopped"; readonly frame: number }
  | { readonly kind: "limit"; readonly approved: number; readonly next: number };

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const manifestPath = (dir: string) => path.join(dir, "manifest.json");
export const attemptFile = (index: number, attempt: number) => `attempts/${frameName(index).replace(".png", "")}_a${attempt}.png`;

export async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(manifestPath(dir), "utf8")) as Manifest;
}

/** Write-then-rename: a crash leaves the previous manifest whole. */
export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  const temp = `${manifestPath(dir)}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, manifestPath(dir));
}

/** One process per run. A lock left by a dead process is taken over. */
export async function acquireLock(dir: string): Promise<() => Promise<void>> {
  const file = path.join(dir, "run.lock");
  for (let tries = 0; tries < 2; tries++) {
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
      return () => rm(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as { pid?: number };
      if (owner.pid && alive(owner.pid)) throw new Error(`run is locked by process ${owner.pid}`);
      await rm(file, { force: true });
    }
  }
  throw new Error("could not lock the run");
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Every approved frame must still be the exact file that passed. */
export async function verifyApproved(dir: string, manifest: Manifest): Promise<void> {
  for (const frame of manifest.frames) {
    if (frame.status !== "approved") continue;
    if (!frame.approved) throw new Error(`frame ${frame.index} is approved without a file`);
    const data = await readFile(path.join(dir, frame.approved.file)).catch(() => null);
    if (!data) throw new Error(`approved frame ${frame.index} is missing: ${frame.approved.file}`);
    if (sha256(data) !== frame.approved.sha256) throw new Error(`approved frame ${frame.index} was modified after approval: ${frame.approved.file}`);
  }
}

async function approve(dir: string, frame: FrameState, attempt: number, png: Buffer, manual = false): Promise<void> {
  const file = `frames/${frameName(frame.index)}`;
  await mkdir(path.join(dir, "frames"), { recursive: true });
  await writeFile(path.join(dir, file), png);
  frame.status = "approved";
  frame.approved = { file, sha256: sha256(png), attempt, ...(manual ? { manual } : {}) };
  delete frame.correction;
}

/**
 * Draws every open frame in order. With `only`, it draws just that frame: an approved one is reopened,
 * but its drawing is kept until a new attempt passes, so a redraw can never leave it worse off.
 */
export async function runFrames(dir: string, steps: RunSteps, options: { limit?: number; signal?: AbortSignal; only?: number } = {}): Promise<RunOutcome> {
  const log = steps.log ?? (() => undefined);
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    await verifyApproved(dir, manifest);
    await mkdir(path.join(dir, "attempts"), { recursive: true });
    const firstOpen = manifest.frames.findIndex((frame) => frame.status !== "approved");
    if (firstOpen > 0) log(`resuming at frame ${manifest.frames[firstOpen].index}; frames 1–${manifest.frames[firstOpen - 1].index} stay approved`);
    manifest.halted = null;
    await writeManifest(dir, manifest);

    let drawn = 0;
    let previous: Buffer | null = null;
    for (const frame of manifest.frames) {
      const only = options.only;
      if (only !== undefined && frame.index !== only) {
        if (frame.index > only) break;
        if (frame.status === "approved") previous = await readFile(path.join(dir, frame.approved!.file));
        continue;
      }
      const prior = only !== undefined && frame.status === "approved" ? frame.approved : undefined;
      if (prior) {
        frame.status = "pending";
        delete frame.approved;
      }
      const keepPrior = () => {
        if (prior && (frame.status as FrameState["status"]) !== "approved") {
          frame.status = "approved";
          frame.approved = prior;
        }
      };
      if (only === undefined && frame.status === "approved") {
        previous = await readFile(path.join(dir, frame.approved!.file));
        continue;
      }
      if (options.limit !== undefined && drawn >= options.limit) {
        return { kind: "limit", approved: manifest.frames.filter((f) => f.status === "approved").length, next: frame.index };
      }
      drawn++;
      const feedback: string[] = [];
      for (let tries = 0; tries < manifest.maxAttempts; tries++) {
        // A stop asked between attempts leaves the frame open, not failed: the next run tries it fresh.
        if (options.signal?.aborted) {
          keepPrior();
          await writeManifest(dir, manifest);
          return { kind: "stopped", frame: frame.index };
        }
        const attempt = (frame.attempts.at(-1)?.attempt ?? 0) + 1;
        const context: DrawContext = { frame, attempt, previous, feedback: [...feedback] };
        log(`frame ${frame.index}: attempt ${tries + 1}/${manifest.maxAttempts}`);
        let png: Buffer;
        let checks: readonly Check[];
        try {
          png = await steps.draw(context);
          await writeFile(path.join(dir, attemptFile(frame.index, attempt)), png);
          checks = await steps.validate(png, context);
        } catch (error) {
          if (options.signal?.aborted) {
            if (frame.attempts.length === 0) frame.status = "pending";
            keepPrior();
            await writeManifest(dir, manifest);
            return { kind: "stopped", frame: frame.index };
          }
          // Infrastructure failure (network, quota, a crashed tool): stop without spending an attempt.
          const reason = `error: ${error instanceof Error ? error.message : String(error)}`;
          // A redraw never halts the run: the frame goes back to the drawing it had.
          if (prior) keepPrior();
          else {
            frame.status = "failed";
            manifest.halted = { frame: frame.index, reason, at: new Date().toISOString() };
          }
          await writeManifest(dir, manifest);
          return { kind: "halted", frame: frame.index, reason };
        }
        const passed = checks.every((check) => check.passed);
        frame.attempts.push({ attempt, at: new Date().toISOString(), file: attemptFile(frame.index, attempt), passed, checks });
        for (const check of checks) log(`  ${check.passed ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
        if (passed) {
          await approve(dir, frame, attempt, png);
          await writeManifest(dir, manifest);
          previous = png;
          log(`frame ${frame.index}: approved`);
          break;
        }
        feedback.push(checks.filter((check) => !check.passed).map((check) => check.feedback ?? check.detail).join(" "));
        await writeManifest(dir, manifest);
      }
      if ((frame.status as FrameState["status"]) !== "approved") {
        const last = frame.attempts.at(-1);
        const reason = `failed ${manifest.maxAttempts} attempts; last: ${last?.checks.filter((c) => !c.passed).map((c) => `${c.name} (${c.detail})`).join("; ") ?? "no attempt"}`;
        if (prior) keepPrior();
        else {
          frame.status = "failed";
          manifest.halted = { frame: frame.index, reason, at: new Date().toISOString() };
        }
        await writeManifest(dir, manifest);
        return { kind: "halted", frame: frame.index, reason };
      }
    }
    return { kind: "complete", approved: options.only === undefined ? manifest.frames.length : manifest.frames.filter((entry) => entry.status === "approved").length };
  } finally {
    await release();
  }
}

/** A person looked at an attempt and accepts it as the frame's drawing, whatever the checks said: a rejected one for the next open frame, or a different one for a frame already approved. */
export async function approveManually(dir: string, index: number, attempt: number): Promise<void> {
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    const target = manifest.frames.find((frame) => frame.index === index);
    if (!target) throw new Error(`frame ${index} doesn't exist`);
    const next = manifest.frames.find((frame) => frame.status !== "approved");
    // The next open frame can be approved, and so can one that is already approved (to choose a different attempt);
    // a frame further on cannot, so the approved frames always form an unbroken run from the first.
    if (target.status !== "approved" && next?.index !== index) throw new Error(`only the next open frame (${next?.index ?? "none"}) can be approved`);
    const record = target.attempts.find((entry) => entry.attempt === attempt);
    if (!record) throw new Error(`frame ${index} has no attempt ${attempt}`);
    await approve(dir, target, attempt, await readFile(path.join(dir, record.file)), true);
    if (manifest.halted?.frame === index) manifest.halted = null;
    await writeManifest(dir, manifest);
  } finally {
    await release();
  }
}

/**
 * A person marked what is wrong on a drawing of this frame. An approved frame
 * opens again (the only way it is ever redrawn); the frames after it keep
 * their approval. The next run draws it first, with the marks and the note.
 */
export async function requestCorrection(dir: string, index: number, correction: Omit<FrameCorrection, "marked" | "at">, marked: Buffer): Promise<void> {
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    const frame = manifest.frames.find((entry) => entry.index === index);
    if (!frame) throw new Error(`frame ${index} doesn't exist`);
    if (!frame.attempts.some((entry) => entry.attempt === correction.attempt)) throw new Error(`frame ${index} has no attempt ${correction.attempt}`);
    const file = `corrections/${frameName(index).replace(".png", "")}_a${correction.attempt}_${Date.now()}.png`;
    await mkdir(path.join(dir, "corrections"), { recursive: true });
    await writeFile(path.join(dir, file), marked);
    frame.correction = { ...correction, marked: file, at: new Date().toISOString() };
    if (frame.status === "approved") {
      frame.status = "pending";
      delete frame.approved;
    }
    await writeManifest(dir, manifest);
  } finally {
    await release();
  }
}

export async function copyInto(dir: string, from: string, name: string): Promise<{ file: string; sha256: string }> {
  await copyFile(from, path.join(dir, name));
  return { file: name, sha256: sha256(await readFile(path.join(dir, name))) };
}
