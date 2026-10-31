import path from "node:path";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describeFace } from "../../server/rotoscope/body-map";
import { framePrompt, isFrameSpec } from "../../server/rotoscope/draw";
import { lessonLines } from "../../server/rotoscope/lessons";
import { layoutRun, PALETTE_FILE, PALETTE_IMAGE, readingFile } from "../../server/rotoscope/pipeline";
import { armLengths, describePose, measureArms, type Pose } from "../../server/rotoscope/pose-match";
import { paletteText, type Palette } from "../../server/rotoscope/colour";
import { readManifest } from "../../server/rotoscope/run-state";
import { recordReferences } from "../../server/rotoscope/provenance";

// The Muse Image prompt of a past attempt, rebuilt from the run's files the way generateRun built it
// (runs drawn before the pipeline kept each prompt). No model call. The earlier attempts of the same
// frame are taken as one session: their failures are the "rejected, fix:" feedback, as runFrames passes them.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/attempt-prompt.ts --run <run dir> --frame 4 --attempt 3

const { values } = parseArgs({ options: { run: { type: "string" }, frame: { type: "string" }, attempt: { type: "string" } } });
if (!values.run || !values.frame || !values.attempt) throw new Error("usage: attempt-prompt.ts --run <dir> --frame N --attempt K");
const dir = path.resolve(values.run);
const [index, number] = [Number(values.frame), Number(values.attempt)];
const manifest = await readManifest(dir);
const frame = manifest.frames.find((entry) => entry.index === index)!;
const before = frame.attempts.filter((attempt) => attempt.attempt < number);
const { character, poseImages } = await layoutRun(dir);
const { guide, sourceGrey, marks, spec } = await poseImages(index);
const sources = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as { frames: Pose[] };
const source = sources.frames[index - 1];
// The reading as it was kept when the attempt was drawn, whatever its revision.
const kept = await readFile(path.join(dir, readingFile(index)), "utf8").catch(() => "");
const palette = existsSync(path.join(dir, PALETTE_FILE)) ? JSON.parse(await readFile(path.join(dir, PALETTE_FILE), "utf8")) as Palette : null;
const previous = manifest.frames.find((entry) => entry.index === index - 1)?.approved;
const first = manifest.frames.find((entry) => entry.approved);
// The manifest as it stood when this attempt was drawn: later attempts of this frame removed.
const then = manifest.frames.map((entry) => (entry.index === index ? { ...entry, attempts: before } : entry));
const feedback = before.map((attempt) => attempt.checks.filter((check) => !check.passed).map((check) => check.feedback ?? check.detail).join(" "));
const { prompt, references } = framePrompt({
  character, description: (await readFile(path.join(dir, "character.txt"), "utf8")).trim(), guide, sourceGrey,
  previous: previous ? Buffer.from("previous") : null,
  anchor: first?.approved && previous && first.index !== index - 1 ? Buffer.from("anchor") : null,
  mannequin: Buffer.from("mannequin"), marks, poseText: describePose(source), measured: measureArms(source, armLengths(sources.frames)),
  palette: palette ? { image: await readFile(path.join(dir, PALETTE_IMAGE)), text: paletteText(palette) } : null,
  bodyMap: spec?.text ?? "", face: describeFace(source), reading: isFrameSpec(kept) ? kept.trim() : "",
  correction: null, feedback, lessons: lessonLines(then, index, feedback.length === 0),
});
console.log(recordReferences(references).map((reference) => `Image ${reference.position} [${reference.entity}]: ${reference.role}`).join("\n"));
console.log(`\n${prompt}`);
