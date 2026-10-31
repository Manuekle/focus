import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { poseToolAvailable } from "../mapping/pose-estimator";

// single_frame_debug on a real run, dry: the request it would send for each prompt strategy,
// built from the run's own files, with no Meta call (Muse Image is replaced by a spy that must
// not be called; the palette is named offline). Local only: debug_runs/ is not in the repository.

vi.mock("../animation/muse-image", async (original) => ({ ...(await original<typeof import("../animation/muse-image")>()), generateImage: vi.fn() }));
vi.mock("../rotoscope/draw", async (original) => ({ ...(await original<typeof import("../rotoscope/draw")>()), namePalette: vi.fn(async (_: Buffer, colours: readonly unknown[]) => colours.map((_, i) => `colour ${i + 1}`)) }));

const { pipelineFrameDebug } = await import("./pipeline-frame");
const { generateImage } = await import("../animation/muse-image");

// The wave run rebuilt by scripts/audit/rebuild-wave-run.ts (the original was deleted).
const run = path.join(process.cwd(), "debug_runs/runs/wave");
const available = existsSync(path.join(run, "manifest.json")) && poseToolAvailable();

describe.skipIf(!available)("single_frame_debug on the wave run (dry)", () => {
  it.each(["existing", "structured"] as const)("%s: same four references, character first and byte-exact, no generation", async (strategy) => {
    const out = await mkdtemp(path.join(tmpdir(), "focus-debug-"));
    try {
      const { dir, record } = await pipelineFrameDebug({ run, frame: 1, strategy, out, dry: true });
      expect(generateImage).not.toHaveBeenCalled();
      expect(record.generation.source).toBe("skipped");
      const manifest = JSON.parse(await readFile(path.join(run, "manifest.json"), "utf8")) as { character: { sha256: string } };
      expect(record.target.references.map((reference) => reference.entity)).toEqual(["B", "A+B", "A", "aid"]);
      expect(record.target.references[0].sha256).toBe(manifest.character.sha256);
      const request = JSON.parse(await readFile(path.join(dir, "muse_request.json"), "utf8")) as { body: { input: { content: { type: string; image_url?: { sha256: string } }[] }[] } };
      const sent = request.body.input[0].content.filter((part) => part.type === "input_image");
      // Every image sent is accounted for: its own bytes, or the resized bytes the record names.
      expect(sent.map((part) => part.image_url!.sha256)).toEqual(record.target.references.map((reference) => reference.sent ?? reference.sha256));
      // The character went unresized (690×753): what was checked is what was sent.
      expect(record.target.references[0].sent).toBeUndefined();
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
