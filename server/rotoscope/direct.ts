import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { concurrency } from "../ai/meta";
import { runPoseTool } from "../mapping/pose-estimator";
import { fromRgba, keyBackground, toRgba } from "./alpha";
import { CANVAS, drawSwap, fitCanvas, swapFramePrompt } from "./draw";
import { frameName } from "./extract";
import { faceReference, swappedSides } from "./likeness";
import { scaledCharacter, type LiveEvent } from "./pipeline";
import type { Pose } from "./pose-match";
import { acquireLock, approve, attemptFile, readManifest, writeManifest, type Check, type RunOutcome } from "./run-state";

// Direct drawing, as on the test page (/rotoscope?test=…): each frame is one Muse Image edit of the whole video frame
// with the run's prompt (swapFramePrompt: the pose from the picture alone) and is approved as drawn. No rig, no checks,
// no retries. What keeps it the character in the video's pose (likeness.ts):
//   - every drawing gets a close-up of the sheet's face with the prompt: the face and the head's size held to the sheet;
//   - Muse Spark compares it with the frame; one with a limb's pose on the other side of the picture (the arm raised
//     to the head on the right instead of the left, about 1 in 10) is drawn once more from the mirrored frame with the
//     mirrored character and face, and turned back: the pose comes out right and the bun and fringe stay on their side;
//   - a transparent one is moved and scaled onto the video person (nose, shoulders, hips; DWPose, no model call).
// Drawings stay on the canvas Muse Image drew on, the video frame letterboxed: the preview shows them over the video as
// they are. With the video's background ("scene") the room comes back around the character, as drawn.

export type DirectBackground = "scene" | "none";

/** What a direct attempt's only check says: how it was made, so the preview knows it is on the video's own framing. */
export const DIRECT_CHECK = "direct";

/** Nose, shoulders, hips, ankles: the body's extent whatever the arms do; a left/right swap moves neither centroid nor spread. */
const BODY = [0, 5, 6, 11, 12, 15, 16];

type PoseFile = { readonly frames: readonly Pose[] };

async function detect(png: Buffer, stem: string): Promise<Pose | null> {
  await writeFile(`${stem}.png`, png);
  await runPoseTool(["detect", "--image", `${stem}.png`, "--out", `${stem}_pose.json`]);
  return (JSON.parse(await readFile(`${stem}_pose.json`, "utf8")) as PoseFile).frames[0] ?? null;
}

/** The scale and offset that put the drawn body on the video person's (least squares over BODY), or null with too few joints. */
export function onPerson(drawn: Pose, person: Pose): { readonly scale: number; readonly x: number; readonly y: number } | null {
  const pairs = BODY.flatMap((joint) => {
    const [d, p] = [drawn.keypoints[joint], person.keypoints[joint]];
    return d?.[0] != null && d[1] != null && p?.[0] != null && p[1] != null ? [[[d[0], d[1]], [p[0], p[1]]] as const] : [];
  });
  if (pairs.length < 4) return null;
  const mean = (side: 0 | 1) => [pairs.reduce((sum, pair) => sum + pair[side][0], 0) / pairs.length, pairs.reduce((sum, pair) => sum + pair[side][1], 0) / pairs.length];
  const spread = (side: 0 | 1, [cx, cy]: number[]) => Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[side][0] - cx) ** 2 + (pair[side][1] - cy) ** 2, 0) / pairs.length);
  const [cd, cp] = [mean(0), mean(1)];
  const drawnSpread = spread(0, cd);
  if (!drawnSpread) return null;
  const scale = spread(1, cp) / drawnSpread;
  return { scale, x: cp[0] - cd[0] * scale, y: cp[1] - cd[1] * scale };
}

async function placed(png: Buffer, move: { readonly scale: number; readonly x: number; readonly y: number }): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const [left, top] = [Math.round(move.x), Math.round(move.y)];
  const scaled = await sharp(png).resize(Math.max(1, Math.round(width * move.scale)), Math.max(1, Math.round(height * move.scale))).png().toBuffer();
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const padded = await sharp(scaled).extend({ left: Math.max(0, left), top: Math.max(0, top), right: CANVAS.width, bottom: CANVAS.height, background: clear }).png().toBuffer();
  return sharp(padded).extract({ left: Math.max(0, -left), top: Math.max(0, -top), width: CANVAS.width, height: CANVAS.height }).png().toBuffer();
}

/**
 * Draws every open frame directly (or only `only`, or the picked `frames`, approved or not), a few at a time, and
 * approves each as drawn.
 * A frame Muse Image can't draw (an error) stays open and the others go on.
 */
export async function drawDirect(dir: string, options: {
  readonly background: DirectBackground;
  readonly only?: number;
  /** These frames only, approved or not (the frames a person picked to redraw). */
  readonly frames?: readonly number[];
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
  readonly onLive?: (event: LiveEvent) => void;
}): Promise<RunOutcome> {
  const log = options.log ?? (() => undefined);
  const release = await acquireLock(dir);
  try {
    const manifest = await readManifest(dir);
    manifest.halted = null;
    await writeManifest(dir, manifest);
    const picked = options.frames ? new Set(options.frames) : options.only !== undefined ? new Set([options.only]) : null;
    const open = manifest.frames.filter((frame) => (picked ? picked.has(frame.index) : frame.status !== "approved"));
    const character = await scaledCharacter(dir);
    const characterSheet = await readFile(path.join(dir, "character.png"));
    const description = await readFile(path.join(dir, "character.txt"), "utf8").then((text) => text.trim(), () => "");
    const face = await faceReference(dir).catch(() => null);
    if (!face) log("the character sheet's face wasn't found: drawing without the face close-up");
    const people = (JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as PoseFile & { readonly width: number; readonly height: number });
    // The video frame letterboxed on the canvas, as Muse Image is shown it: the video person's joints there.
    const box = Math.min(CANVAS.width / people.width, CANVAS.height / people.height);
    const [bx, by] = [(CANVAS.width - people.width * box) / 2, (CANVAS.height - people.height * box) / 2];
    const personAt = (index: number): Pose | null => {
      const person = people.frames[index - 1];
      return person ? { ...person, keypoints: person.keypoints.map(([x, y]) => (x === null || y === null ? [null, null] : [x * box + bx, y * box + by])) } : null;
    };
    await mkdir(path.join(dir, "work"), { recursive: true });
    await mkdir(path.join(dir, "attempts"), { recursive: true });
    log(`drawing ${open.length} frame${open.length === 1 ? "" : "s"} directly, ${options.background === "scene" ? "with the video's background" : "on transparency"}: no checks`);

    const failed: number[] = [];
    // Manifest writes one at a time: frames finish in any order.
    let writing = Promise.resolve();
    const record = (change: () => Promise<void>) => (writing = writing.then(change, change));

    const drawOne = async (index: number) => {
      const frame = manifest.frames.find((entry) => entry.index === index)!;
      const attempt = (frame.attempts.at(-1)?.attempt ?? 0) + 1;
      const stem = path.join(dir, "work", `${frameName(index).replace(".png", "")}_a${attempt}_direct`);
      options.onLive?.({ frame: index, attempt, tries: 1, of: 1, stage: "drawing" });
      const source = await readFile(path.join(dir, "source", frameName(index)));
      const corner = await sharp(source).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      const shown = await fitCanvas(source, `rgb(${corner[0]},${corner[1]},${corner[2]})`);
      // Mirrored, the frame, the character and its face are all flopped, and the drawing flopped back.
      const draw = async (mirrored: boolean) => {
        const flop = async (png: Buffer) => (mirrored ? sharp(png).flop().png().toBuffer() : png);
        const built = swapFramePrompt({
          frame: await flop(shown), character: await flop(character), characterSheet, description, face: face ? await flop(face) : null,
          correction: null, feedback: [], background: options.background === "scene" ? "scene" : "key",
        });
        const turned = await flop(await drawSwap(built, options.signal));
        return options.background === "scene" ? turned : fromRgba(keyBackground(await toRgba(turned)).image);
      };
      let png = await draw(false);
      const notes: string[] = [];
      options.onLive?.({ frame: index, attempt, tries: 1, of: 1, stage: "checking" });
      // A transparent drawing is read on white, as a person would see it.
      const seen = options.background === "scene" ? png : await sharp(png).flatten({ background: "#ffffff" }).png().toBuffer();
      const sides = await swappedSides({ frame: shown, drawing: seen, signal: options.signal }).catch((error: unknown) => {
        options.signal?.throwIfAborted();
        log(`frame ${index}: the sides couldn't be read (${error instanceof Error ? error.message.slice(0, 120) : String(error)}); kept as drawn`);
        return null;
      });
      if (sides?.swapped) {
        log(`frame ${index}: a limb came out on the other side (${sides.leftOfImage} | ${sides.rightOfImage}); drawing it once more from the mirrored frame`);
        options.onLive?.({ frame: index, attempt, tries: 1, of: 1, stage: "drawing" });
        png = await draw(true);
        notes.push("drawn from the mirrored frame (a limb first came out on the other side)");
      }
      if (options.background === "none") {
        const person = personAt(index);
        const body = await detect(png, stem).catch(() => null);
        const move = body && person ? onPerson(body, person) : null;
        if (move) {
          png = await placed(png, move);
          notes.push(`placed on the video person, scaled ${move.scale.toFixed(2)}`);
        } else notes.push("left where it was drawn (body not found)");
      }
      const checks: Check[] = [{ name: DIRECT_CHECK, passed: true, detail: `drawn directly ${options.background === "scene" ? "with the video's background" : "on transparency"}, not checked${notes.length ? `; ${notes.join("; ")}` : ""}` }];
      await writeFile(path.join(dir, attemptFile(index, attempt)), png);
      await record(async () => {
        frame.attempts.push({ attempt, at: new Date().toISOString(), file: attemptFile(index, attempt), passed: true, checks });
        await approve(dir, frame, attempt, png);
        await writeManifest(dir, manifest);
      });
      options.onLive?.({ frame: index, attempt, tries: 1, of: 1, stage: "approved" });
      log(`frame ${index}: drawn${notes.length ? ` (${notes.join("; ")})` : ""}`);
    };

    const queue = open.map((frame) => frame.index);
    // As many at once as Muse Image draws at once (FOCUS_IMAGE_CONCURRENCY).
    await Promise.all(Array.from({ length: Math.min(queue.length, concurrency("FOCUS_IMAGE_CONCURRENCY", 2)) }, async () => {
      for (let index = queue.shift(); index !== undefined && !options.signal?.aborted; index = queue.shift()) {
        try {
          await drawOne(index);
        } catch (error) {
          if (options.signal?.aborted) break;
          failed.push(index);
          log(`frame ${index}: couldn't be drawn (${error instanceof Error ? error.message.slice(0, 160) : String(error)}); it stays open`);
        }
      }
    }));
    await writing;
    const left = queue[0] ?? open.find((frame) => frame.status !== "approved" && !failed.includes(frame.index))?.index;
    if (options.signal?.aborted) return { kind: "stopped", frame: left ?? open.at(-1)?.index ?? 1 };
    const approved = manifest.frames.filter((frame) => frame.status === "approved").length;
    return failed.length ? { kind: "partial", approved, failed: failed.sort((a, b) => a - b) } : { kind: "complete", approved };
  } finally {
    await release();
  }
}
