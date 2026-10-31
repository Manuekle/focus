import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { estimatePose } from "../../server/mapping/pose-estimator";
import { toRgba } from "../../server/rotoscope/alpha";
import { profiledPalette, sheetColours } from "../../server/rotoscope/colour";
import { readManifest } from "../../server/rotoscope/run-state";
import { sourceMotion, temporalReport, type SequenceFrame } from "../../server/rotoscope/temporal";
import type { Pose } from "../../server/rotoscope/pose-match";

// Temporal consistency of a run's approved frames (server/rotoscope/temporal.ts), offline: DWPose
// (local) on each approved drawing as it was registered on the canvas, the video's poses.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/temporal.ts --run <run dir> [--out file.json]

const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" } } });
if (!values.run) throw new Error("usage: temporal.ts --run <run dir> [--out file.json]");
const dir = path.resolve(values.run);
const manifest = await readManifest(dir);
const sources = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as { frames: Pose[] };
const work = await mkdtemp(path.join(tmpdir(), "focus-temporal-"));
const frames: SequenceFrame[] = [];
for (const frame of manifest.frames) {
  if (!frame.approved) break;
  // The pose kept in work/ was found before registration: the approved drawing is measured again where it was placed.
  const estimate = await estimatePose(path.join(dir, frame.approved.file), path.join(work, `frame_${frame.index}.json`));
  if (!estimate) break;
  frames.push({ index: frame.index, source: sources.frames[frame.index - 1], drawn: estimate.pose, image: await toRgba(await readFile(path.join(dir, frame.approved.file))) });
}
const sheet = await readFile(path.join(dir, "character.png"));
const palette = await profiledPalette(sheet, { colours: (await sheetColours(sheet)).map((colour) => ({ ...colour, name: colour.hex })) });
const report = temporalReport(frames, palette);
const videoMotion = frames.slice(1).map((frame, i) => sourceMotion(frames[i].source, frame.source)).map((value) => (value === null ? null : Math.round(value * 10) / 10));
console.log(JSON.stringify({ ...report, videoMotion }, null, 1).replace(/\n\s+(-?[\d.]+|null),?/g, (m) => m.replace(/\n\s+/, " ")));
if (values.out) {
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify({ run: path.basename(dir), at: new Date().toISOString(), ...report, videoMotion }, null, 2)}\n`);
}
