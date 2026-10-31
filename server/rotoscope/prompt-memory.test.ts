import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "./run-state";
import { keepMemory, noteKitOrigin, posePart, recallMemory, runMemory } from "./prompt-memory";

const prompt = (pose: string) => `TASK\nEdit Image 1.\n\nTARGET POSE (Image 1)\n${pose}\nSides as seen in the picture, never mirrored.\n\nRENDERING\nClean line art.`;
const check = (name: string, passed: boolean, feedback?: string) => ({ name, passed, detail: `${name} detail`, ...(feedback ? { feedback } : {}) });

let root: string;
const oldData = process.env.FOCUS_DATA_DIR;

/** A run folder with one attempt per frame: its prompt file (written by Muse Spark when `spark`) and its outcome. */
async function run(name: string, frames: readonly { pose: string; passed: boolean; problem?: string; spark?: boolean; at: string }[]): Promise<{ dir: string; manifest: Manifest }> {
  const dir = path.join(root, "rotoscope", name);
  await mkdir(path.join(dir, "work"), { recursive: true });
  const manifest = {
    frames: await Promise.all(frames.map(async (frame, i) => {
      const stem = path.join(dir, "work", `frame_${String(i + 1).padStart(4, "0")}_a1`);
      await writeFile(`${stem}_prompt.txt`, `Image 1: REFERENCE C\nImage 2: REFERENCE A\n\n${prompt(frame.pose)}\n`);
      if (frame.spark) await writeFile(`${stem}_template_prompt.txt`, "the template");
      return {
        index: i + 1, source: "", status: frame.passed ? "approved" : "failed",
        attempts: [{ attempt: 1, at: frame.at, file: "", passed: frame.passed, checks: [check("pose", frame.passed, frame.problem)] }],
        ...(frame.passed ? { approved: { file: "", sha256: "", attempt: 1 } } : {}),
      };
    })),
  } as unknown as Manifest;
  return { dir, manifest };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "focus-memory-"));
  process.env.FOCUS_DATA_DIR = root;
});
afterAll(async () => {
  if (oldData === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = oldData;
  await rm(root, { recursive: true, force: true });
});

describe("prompt memory", () => {
  it("takes the target pose part of a prompt, or its start when it has none", () => {
    expect(posePart(prompt("The arm on the right of the image is raised."))).toBe("The arm on the right of the image is raised.\nSides as seen in the picture, never mirrored.");
    expect(posePart("Edit Image 1 so the character waves.")).toBe("Edit Image 1 so the character waves.");
  });

  it("reads each attempt's prompt, its writer and how its drawing fared", async () => {
    const { dir, manifest } = await run("memory-a", [
      { pose: "Right arm raised.", passed: true, spark: true, at: "2026-10-31T08:00:00.000Z" },
      { pose: "Arms out wide.", passed: false, problem: "The drawing is a mirror image of the pose.", at: "2026-10-31T08:01:00.000Z" },
    ]);
    const entries = await runMemory(dir, manifest);
    expect(entries.map(({ frame, writer, approved, problems }) => ({ frame, writer, approved, problems }))).toEqual([
      { frame: 1, writer: "spark", approved: true, problems: "" },
      { frame: 2, writer: "template", approved: false, problems: "The drawing is a mirror image of the pose." },
    ]);
    expect(entries[0].pose).toContain("Right arm raised.");
  });

  it("keeps a run's memory with its character's kit, and the next run reads it after its own", async () => {
    const kit = path.join(root, "characters", "c1", "kits", "v-1");
    await mkdir(kit, { recursive: true });
    const first = await run("memory-first", [
      { pose: "First run: both hands on the head.", passed: true, at: "2026-10-31T07:00:00.000Z" },
      { pose: "First run: arms out.", passed: false, problem: "Four arms were drawn.", at: "2026-10-31T07:01:00.000Z" },
    ]);
    await noteKitOrigin(first.dir, kit);
    await keepMemory(first.dir, first.manifest);

    const next = await run("memory-next", [
      { pose: "Next run: right arm raised.", passed: true, at: "2026-10-31T09:00:00.000Z" },
      { pose: "Next run: this frame.", passed: false, problem: "The arm is mirrored.", at: "2026-10-31T09:01:00.000Z" },
    ]);
    await noteKitOrigin(next.dir, kit);
    const memory = await recallMemory(next.dir, next.manifest, 2);
    // This run's approved frame first, then the earlier run's; never frame 2's own attempts.
    expect(memory.worked.map((entry) => entry.pose.split("\n")[0])).toEqual(["Next run: right arm raised.", "First run: both hands on the head."]);
    expect(memory.failed.map((entry) => entry.problems)).toEqual(["Four arms were drawn."]);
  });

  it("has nothing to keep or recall for a run that wasn't made from a kit", async () => {
    const { dir, manifest } = await run("memory-alone", [{ pose: "Alone.", passed: true, at: "2026-10-31T10:00:00.000Z" }]);
    await keepMemory(dir, manifest);
    expect(await recallMemory(dir, manifest, 2)).toMatchObject({ worked: [{ pose: expect.stringContaining("Alone.") }], failed: [] });
  });
});
