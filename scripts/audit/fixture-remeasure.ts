import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { measureDrawing } from "../../server/rotoscope/pipeline";
import { decide } from "../../server/rotoscope/decision";
import type { Pose } from "../../server/rotoscope/pose-match";

// The three original frame-1 attempts of the wave run (kept as half-size cut-outs and their DWPose
// poses in the fixtures; the run itself was deleted) measured with the current checks on the rebuilt
// run, and the decision engine's verdict. Offline, no model call (the poses are the kept ones).
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/fixture-remeasure.ts --run debug_runs/runs/wave [--out file.json]

const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" } } });
if (!values.run) throw new Error("usage: fixture-remeasure.ts --run <rebuilt wave run> [--out file.json]");
const fixture = path.join(process.cwd(), "server/rotoscope/__fixtures__/wave");
const poses = JSON.parse(await readFile(path.join(fixture, "poses.json"), "utf8")) as { attempts: Pose[]; human: string[] };
const rows = [];
for (const [i, drawn] of poses.attempts.entries()) {
  // Back to the canvas the generator drew on: full size, on the key colour.
  const raw = await sharp(path.join(fixture, `a${i + 1}_cutout_512.png`)).resize(1024, 1536, { kernel: "nearest" }).flatten({ background: "#ff00ff" }).png().toBuffer();
  const { checks } = await measureDrawing(path.resolve(values.run), 1, raw, { work: path.join(tmpdir(), "focus-fixture-remeasure"), name: `a${i + 1}`, drawn });
  const verdict = decide(checks);
  rows.push({ attempt: i + 1, human: poses.human[i], decision: verdict.decision, reasons: verdict.reasons, checks: checks.map(({ name, passed, status, severity, detail }) => ({ name, passed, status, severity, detail })) });
  console.log(`a${i + 1} (human: ${poses.human[i]}) → ${verdict.decision}`);
  for (const check of checks) console.log(`  ${(check.status ?? (check.passed ? "pass" : "fail")).padEnd(12)} ${check.severity ? `[${check.severity}] ` : ""}${check.name}: ${check.detail.slice(0, 150)}`);
}
if (values.out) {
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)}\n`);
}
