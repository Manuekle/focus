import path from "node:path";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { measureDrawing } from "../../server/rotoscope/pipeline";
import { readManifest } from "../../server/rotoscope/run-state";
import type { Pose } from "../../server/rotoscope/pose-match";

// The proportions check on drawings a person accepted: every approved frame of a run measured again
// (kept poses, no model call). How far good drawings already sit from the limits is the check's noise.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/proportion-spread.ts --run <run dir>

const { values } = parseArgs({ options: { run: { type: "string" } } });
if (!values.run) throw new Error("usage: proportion-spread.ts --run <run dir>");
const dir = path.resolve(values.run);
for (const frame of (await readManifest(dir)).frames) {
  for (const attempt of frame.attempts) {
    const stem = path.join(dir, "work", `frame_${String(frame.index).padStart(4, "0")}_a${attempt.attempt}`);
    const raw = [`${stem}_muse_raw.png`, `${stem}_raw.png`].find((file) => existsSync(file));
    const pose = [`${stem}_muse_pose.json`, `${stem}_pose.json`].find((file) => existsSync(file));
    if (!raw || !pose) continue;
    const drawn = (JSON.parse(await readFile(pose, "utf8")) as { frames: Pose[] }).frames[0];
    const { checks } = await measureDrawing(dir, frame.index, await readFile(raw), { work: path.join(tmpdir(), "focus-spread"), name: `f${frame.index}a${attempt.attempt}`, drawn });
    const proportions = checks.find((check) => check.name === "proportions")!;
    console.log(`frame ${frame.index} a${attempt.attempt} ${frame.approved?.attempt === attempt.attempt ? "APPROVED" : "rejected"}: ${proportions.passed ? "pass" : "FAIL"} ${proportions.detail.slice(0, 110)}`);
  }
}
