import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { layoutRun, measureDrawing } from "../../server/rotoscope/pipeline";
import { decide } from "../../server/rotoscope/decision";
import { readManifest, writeManifest } from "../../server/rotoscope/run-state";

// Moves a run laid out before the current rules onto them without drawing anything: the layout is
// recomputed, every approved drawing is measured again from its kept raw output and re-registered on
// the new layout (its review verdict is kept: the drawing is the same), and open frames are reopened.
// A frame whose drawing no longer passes every measurement is reopened instead of kept.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/migrate-run.ts --run <run dir>

const { values } = parseArgs({ options: { run: { type: "string" } } });
if (!values.run) throw new Error("usage: migrate-run.ts --run <run dir>");
const dir = path.resolve(values.run);
await rm(path.join(dir, "layout.json"), { force: true });
await layoutRun(dir);
const manifest = await readManifest(dir);
for (const frame of manifest.frames) {
  if (frame.status !== "approved" || !frame.approved) {
    if (frame.status === "failed") frame.status = "pending";
    continue;
  }
  const attempt = frame.attempts.find((entry) => entry.attempt === frame.approved!.attempt)!;
  const raw = path.join(dir, "work", `frame_${String(frame.index).padStart(4, "0")}_a${attempt.attempt}_muse_raw.png`);
  const { checks, placed } = await measureDrawing(dir, frame.index, await readFile(raw), { work: path.join(tmpdir(), "focus-migrate"), name: `f${frame.index}` });
  const review = attempt.checks.find((check) => check.name === "review");
  const all = [...checks, ...(review ? [review] : [])];
  const verdict = decide(all);
  console.log(`frame ${frame.index}: ${verdict.decision}${verdict.reasons.length ? ` — ${verdict.reasons.join("; ")}` : ""}`);
  if (verdict.decision !== "ACCEPTED") {
    frame.status = "pending";
    delete frame.approved;
    continue;
  }
  await writeFile(path.join(dir, frame.approved.file), placed);
  await writeFile(path.join(dir, attempt.file), placed);
  frame.approved = { ...frame.approved, sha256: createHash("sha256").update(placed).digest("hex") };
  frame.attempts[frame.attempts.indexOf(attempt)] = { ...attempt, checks: all, decision: verdict.decision };
}
manifest.halted = null;
await writeManifest(dir, manifest);
console.log(manifest.frames.map((frame) => `${frame.index}:${frame.status}`).join(" "));
