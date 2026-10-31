import path from "node:path";
import { parseArgs } from "node:util";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { runPoseTool } from "../../server/mapping/pose-estimator";
import { figureBox } from "../../server/rotoscope/grid";
import { copyInto, writeManifest, type Manifest } from "../../server/rotoscope/run-state";

// Rebuilds the wave run (60bd847f: 9 frames at 9 fps of the screen recording, crop 828×1472+0+160,
// the green-hanfu character) as a fresh run with no attempts, offline: the source frames and their
// poses from a run cut from the same recording (--from), the character from the test fixture, DWPose
// on it and the guides redrawn locally, and the character description the original run had.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/rebuild-wave-run.ts --from .focus-data/rotoscope/test-1s-v4 --out debug_runs/runs/wave
//   … [--character other.png --description other.txt] [--max-attempts 1]   the same frames with another character

const { values } = parseArgs({ options: { from: { type: "string" }, out: { type: "string" }, character: { type: "string" }, description: { type: "string" }, "max-attempts": { type: "string" } } });
if (!values.from || !values.out) throw new Error("usage: rebuild-wave-run.ts --from <run cut from the same recording> --out <new run dir>");
const [from, dir] = [path.resolve(values.from), path.resolve(values.out)];
const donor = JSON.parse(await readFile(path.join(from, "manifest.json"), "utf8")) as Manifest;
await mkdir(dir, { recursive: true });
await cp(path.join(from, "source"), path.join(dir, "source"), { recursive: true });
await cp(path.join(from, "source-poses.json"), path.join(dir, "source-poses.json"));
const character = await copyInto(dir, path.resolve(values.character ?? "server/rotoscope/__fixtures__/wave/character.png"), "character.png");
await runPoseTool(["detect", "--image", path.join(dir, "character.png"), "--out", path.join(dir, "character-pose.json")]);
const { top } = await figureBox(await readFile(path.join(dir, "character.png")));
await runPoseTool(["guides", "--source", path.join(dir, "source-poses.json"), "--character", path.join(dir, "character-pose.json"), "--out", path.join(dir, "guides"), "--head-top", String(top)]);
// Muse Spark's description of this sheet from the original run, kept verbatim: no model call here.
if (values.description) await writeFile(path.join(dir, "character.txt"), await readFile(values.description));
else await writeFile(path.join(dir, "character.txt"), "Young woman with slim petite build about six heads tall, legs long but hidden, torso short, arms long to hips. Dark teal-black hair with straight blunt bangs, half-up topknot, two thin short braids framing front to chest. Large round purple-blue eyes, thin brows, small mouth, neutral serious expression. Light green cross-collar hanfu top with wide long sleeves, darker green trim and pale mint inner collar over white underlayer, lime-green cuffs. Long full ankle-length dark plum-purple skirt. Dark teal flat slipper shoes, no socks visible. Small light blue ribbon bow on top. Clean thin black anime outlines, flat cel colors with soft fold shading.\n");
const names = (await readdir(path.join(dir, "source"))).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort();
await writeManifest(dir, {
  version: 1, createdAt: new Date().toISOString(), name: "wave (rebuilt)", video: donor.video, fps: donor.fps, start: donor.start, seconds: donor.seconds, crop: donor.crop,
  character, maxAttempts: Number(values["max-attempts"] ?? 3), frames: names.map((name, i) => ({ index: i + 1, source: `source/${name}`, status: "pending", attempts: [] })),
});
console.log(`rebuilt ${names.length} frames in ${dir}; character ${character.sha256.slice(0, 12)}`);
