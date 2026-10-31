import path from "node:path";
import { parseArgs } from "node:util";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mapFrame, openMapping } from "../../server/mapping/engine";
import { onCanvas } from "../../server/rotoscope/body-map";
import { CANVAS } from "../../server/rotoscope/draw";
import { layoutRun } from "../../server/rotoscope/pipeline";
import { readManifest } from "../../server/rotoscope/run-state";

// The character rig on every frame of a run, offline: a copy of the run, the local segmenter
// (FOCUS_MAPPING_SAM=off, no Meta call), each frame planned and deformed from the character sheet,
// and the deformation's structure statistics and constraint outcomes recorded.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/rig-benchmark.ts --run .focus-data/rotoscope/<id> --out file.json

const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" } } });
if (!values.run) throw new Error("usage: rig-benchmark.ts --run <run dir> [--out file.json]");
process.env.FOCUS_MAPPING_SAM = "off";
const work = await mkdtemp(path.join(tmpdir(), "focus-rig-"));
const dir = path.join(work, "run");
await cp(path.resolve(values.run), dir, { recursive: true, filter: (from) => !from.includes(`${path.sep}work${path.sep}`) });
try {
  const manifest = await readManifest(dir);
  const { guides, fit, poseImages } = await layoutRun(dir);
  const engine = await openMapping(dir, { manifest });
  const rows = [];
  for (const frame of manifest.frames) {
    const { marks } = await poseImages(frame.index);
    const started = Date.now();
    try {
      const mapped = await mapFrame(engine, { index: frame.index, manifest, guide: onCanvas(guides.frames[frame.index - 1], fit), marks, canvas: CANVAS });
      const { stats, plan } = mapped.result;
      rows.push({
        frame: frame.index, base: mapped.decision.base?.id ?? null, ms: Date.now() - started,
        triangles: stats.triangles, flipped: stats.flipped, collapsed: (stats as { collapsed?: number }).collapsed ?? null, foldedBy: (stats as { foldedBy?: unknown }).foldedBy ?? null,
        distortedShare: stats.coverageArea ? Math.round((stats.distortedArea / stats.coverageArea) * 1000) / 1000 : null,
        exposedArea: stats.exposedArea, clamped: plan.clamped, torsoFit: (plan as { torsoFit?: string }).torsoFit ?? null,
        failed: mapped.outcomes.filter((outcome) => !outcome.passed && outcome.kind === "constraint").map((outcome) => `${outcome.id}: ${outcome.detail}`),
      });
    } catch (error) {
      rows.push({ frame: frame.index, error: error instanceof Error ? error.message : String(error) });
    }
    console.log(JSON.stringify(rows.at(-1)));
  }
  if (values.out) {
    await mkdir(path.dirname(values.out), { recursive: true });
    await writeFile(values.out, `${JSON.stringify({ run: path.basename(path.resolve(values.run)), at: new Date().toISOString(), rows }, null, 2)}\n`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
