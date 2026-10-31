import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { writeAtomic } from "../animation/store";
import { dataRoot } from "../storage";
import { frameName } from "./extract";
import type { Manifest } from "./run-state";

// What Muse Spark learns from earlier prompts: each prompt a frame was drawn with, with how its drawing fared. Read
// off the run itself (work/frame_NNNN_aK_prompt.txt and the manifest), and kept with the character's kit when the run
// came from one (prompt-memory/<run>.json), so the next run of that character starts with what this one learnt.

/** One prompt and how the drawing it gave fared. */
export type MemoryEntry = {
  readonly run: string;
  readonly frame: number;
  readonly attempt: number;
  readonly at: string;
  /** Who wrote it: Muse Spark (writeFramePrompt) or the template (swapFramePrompt). */
  readonly writer: "spark" | "template";
  readonly approved: boolean;
  /** What the checks found wrong with the drawing, in words; empty when it passed. */
  readonly problems: string;
  /** The prompt's target pose part: what the writer said of this frame's pose, the part worth learning from. */
  readonly pose: string;
};

/** Where a run made from a kit says which (initRun): relative to the data root, so the folder can move with it. */
export const KIT_ORIGIN = "kit-origin.json";
const MEMORY_FOLDER = "prompt-memory";
/** At most this many examples of each kind reach the writer. */
const WORKED = 3;
const FAILED = 4;

/** The target pose part of a prompt (its "TARGET POSE" section); the start of the prompt when it has none. */
export function posePart(prompt: string): string {
  // Up to the next section heading (a blank line, then a line in capitals) or the end of the prompt.
  const match = prompt.match(/^TARGET POSE[^\n]*\n([\s\S]*?)(?=\n\s*\n[A-Z][A-Z0-9 (),.'-]{3,}\n|(?![\s\S]))/m);
  return (match ? match[1] : prompt).trim().slice(0, 1500);
}

/** Every prompt the run's attempts were drawn with, oldest first, with their outcome. */
export async function runMemory(dir: string, manifest: Manifest): Promise<MemoryEntry[]> {
  const run = path.basename(dir);
  const entries: MemoryEntry[] = [];
  for (const frame of manifest.frames) {
    for (const attempt of frame.attempts) {
      const stem = path.join(dir, "work", `${frameName(frame.index).replace(".png", "")}_a${attempt.attempt}`);
      const file = await readFile(`${stem}_prompt.txt`, "utf8").catch(() => null);
      if (!file) continue;
      // The prompt file is the images' roles, a blank line, then the prompt.
      const prompt = file.slice(file.indexOf("\n\n") + 2);
      entries.push({
        run, frame: frame.index, attempt: attempt.attempt, at: attempt.at,
        writer: existsSync(`${stem}_template_prompt.txt`) ? "spark" : "template",
        approved: attempt.passed || frame.approved?.attempt === attempt.attempt,
        problems: attempt.checks.filter((check) => !check.passed).map((check) => check.feedback ?? check.detail).join(" ").slice(0, 600),
        pose: posePart(prompt),
      });
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

async function kitOf(dir: string): Promise<string | null> {
  const origin = await readFile(path.join(dir, KIT_ORIGIN), "utf8").then((text) => JSON.parse(text) as { kit?: string }, () => null);
  return origin?.kit ? path.join(dataRoot(), origin.kit) : null;
}

/** Writes where a run's kit is, for keepMemory to find it later. */
export async function noteKitOrigin(dir: string, kit: string): Promise<void> {
  await writeAtomic(path.join(dir, KIT_ORIGIN), JSON.stringify({ kit: path.relative(dataRoot(), kit) }));
}

/** Saves the run's memory beside its kit (one file per run, replaced each time): later runs of the character read it. */
export async function keepMemory(dir: string, manifest: Manifest): Promise<void> {
  const kit = await kitOf(dir);
  if (!kit || !existsSync(kit)) return;
  const entries = await runMemory(dir, manifest);
  if (!entries.length) return;
  await mkdir(path.join(kit, MEMORY_FOLDER), { recursive: true });
  await writeAtomic(path.join(kit, MEMORY_FOLDER, `${path.basename(dir)}.json`), JSON.stringify(entries));
}

/**
 * What the writer is shown before a frame's prompt: the latest prompts whose drawings were approved and the latest
 * whose drawings failed, with what was wrong. This run's own come first; the character's earlier runs fill the rest.
 * Never this frame's own attempts in this run: they are its feedback already.
 */
export async function recallMemory(dir: string, manifest: Manifest, frame: number): Promise<{ readonly worked: readonly MemoryEntry[]; readonly failed: readonly MemoryEntry[] }> {
  const own = (await runMemory(dir, manifest)).filter((entry) => entry.frame !== frame);
  const kit = await kitOf(dir);
  const folder = kit ? path.join(kit, MEMORY_FOLDER) : null;
  const names = folder ? (await readdir(folder).catch(() => [] as string[])).filter((name) => name.endsWith(".json") && name !== `${path.basename(dir)}.json`) : [];
  const earlier = (await Promise.all(names.map((name) => readFile(path.join(folder!, name), "utf8").then((text) => JSON.parse(text) as MemoryEntry[], () => [])))).flat()
    .sort((a, b) => a.at.localeCompare(b.at));
  // Latest first within each source, this run before the earlier ones.
  const ranked = [...own.reverse(), ...earlier.reverse()];
  return { worked: ranked.filter((entry) => entry.approved).slice(0, WORKED), failed: ranked.filter((entry) => !entry.approved && entry.problems).slice(0, FAILED) };
}
