import path from "node:path";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { layoutRun, PALETTE_IMAGE } from "../../server/rotoscope/pipeline";
import { framePrompt } from "../../server/rotoscope/draw";
import { describePose } from "../../server/rotoscope/pose-match";
import { readManifest } from "../../server/rotoscope/run-state";
import { assertIsolation, recordReferences, sha256 } from "../../server/rotoscope/provenance";

// Reference isolation on a real run: every frame's references built from the run's own files the
// way generateRun builds them, recorded by entity and hash, and checked by assertIsolation. No model call.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/isolation.ts --run .focus-data/rotoscope/<id>

const { values } = parseArgs({ options: { run: { type: "string" } } });
if (!values.run) throw new Error("usage: isolation.ts --run <run dir>");
const dir = path.resolve(values.run);
const manifest = await readManifest(dir);
const { character, poseImages, fit } = await layoutRun(dir);
const palette = await readFile(path.join(dir, PALETTE_IMAGE));
const sources = JSON.parse(await readFile(path.join(dir, "source-poses.json"), "utf8")) as { frames: Parameters<typeof describePose>[0][] };
/** Every drawing the run made: none may stand in for the video or the character. */
const outputs = new Set<string>();
for (const frame of manifest.frames) for (const attempt of frame.attempts) outputs.add(sha256(await readFile(path.join(dir, attempt.file))));
let checked = 0;
for (const frame of manifest.frames) {
  const { guide, sourceGrey, marks } = await poseImages(frame.index);
  const { references } = framePrompt({ character, description: "", guide, sourceGrey, previous: null, marks, poseText: describePose(sources.frames[frame.index - 1]), bodyMap: "", face: "", correction: null, feedback: [], palette: { image: palette, text: "" } });
  const target = {
    kind: "generation-target" as const, frame: frame.index, attempt: 0,
    pose: { kind: "pose-source" as const, frame: frame.index, file: frame.source, sha256: sha256(await readFile(path.join(dir, frame.source))), crop: manifest.crop, layout: fit },
    identity: { kind: "character-identity" as const, file: manifest.character.file, sha256: manifest.character.sha256 },
    references: recordReferences(references),
  };
  assertIsolation(target, outputs);
  checked++;
  console.log(`frame ${frame.index}: ${target.references.map((reference) => `Image ${reference.position} ${reference.entity} ${reference.sha256.slice(0, 8)}`).join(", ")}`);
}
console.log(`isolation holds on ${checked} frames; character ${manifest.character.sha256.slice(0, 12)} = sha256(character.png) ${sha256(character).slice(0, 12)}; ${outputs.size} earlier outputs excluded`);
