import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { remeasureAttempt } from "../../server/rotoscope/pipeline";
import { readManifest } from "../../server/rotoscope/run-state";

// Offline baseline: every kept attempt of a rotoscope run measured again with the current
// checks, beside what the run recorded when it drew it. No model call (DWPose is local).
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/baseline.ts --run .focus-data/rotoscope/<id> [--redetect] [--out file.json]

const { values } = parseArgs({ options: { run: { type: "string" }, redetect: { type: "boolean" }, out: { type: "string" } } });
if (!values.run) throw new Error("usage: baseline.ts --run <run dir> [--redetect] [--out file.json]");
const dir = path.resolve(values.run);
const manifest = await readManifest(dir);
const rows = [];
for (const frame of manifest.frames) {
  for (const attempt of frame.attempts) {
    const now = await remeasureAttempt(dir, frame.index, attempt.attempt, { redetect: values.redetect }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    const diagnostics = await readFile(path.join(dir, "mapping", "diagnostics", `frame_${String(frame.index).padStart(4, "0")}_a${attempt.attempt}.json`), "utf8").then((text) => JSON.parse(text) as { boneError?: Record<string, number> }, () => null);
    rows.push({
      frame: frame.index,
      attempt: attempt.attempt,
      recorded: attempt.checks.map(({ name, passed, detail, score }) => ({ name, passed, detail, score })),
      now: "error" in now ? now : now.checks.map(({ name, passed, detail, score, ...rest }) => ({ name, passed, detail, score, ...("status" in rest ? { status: rest.status } : {}) })),
      // The mapping diagnostics' 14-bone comparison against the frame's target skeleton: an independent view of the pose.
      boneError: diagnostics?.boneError ?? null,
    });
  }
}
for (const row of rows) {
  console.log(`frame ${row.frame} attempt ${row.attempt}`);
  const now = Array.isArray(row.now) ? row.now : [];
  for (const check of row.recorded) {
    const current = now.find((entry) => entry.name === check.name);
    console.log(`  ${check.name.padEnd(12)} recorded ${check.passed ? "PASS" : "FAIL"} ${check.detail.slice(0, 90)}`);
    if (current) console.log(`  ${"".padEnd(12)} now      ${current.passed ? "PASS" : "FAIL"}${"status" in current ? ` [${String(current.status)}]` : ""} ${current.detail.slice(0, 90)}`);
  }
  if (!Array.isArray(row.now)) console.log(`  now: ${row.now.error}`);
  if (row.boneError) console.log(`  14-bone error vs target: ${Object.entries(row.boneError).map(([bone, degrees]) => `${bone} ${degrees}°`).join(", ")}`);
}
if (values.out) {
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify({ run: path.basename(dir), at: new Date().toISOString(), redetect: Boolean(values.redetect), rows }, null, 2)}\n`);
}
