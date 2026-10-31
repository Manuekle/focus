import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { holdColours, profiledPalette, sheetColours, toLab, fromLab, type Palette } from "../../server/rotoscope/colour";
import { keyOut, toRgba, type Rgba } from "../../server/rotoscope/alpha";
import { readManifest } from "../../server/rotoscope/run-state";

// The colour check against labelled drawings, offline: positives are drawings whose colours a person
// judged right (approved frames of a run, and attempts checked by eye); negatives are the same
// drawings with one part's colour changed (the largest colour region's hue turned by 120° or 180°,
// or its lightness inverted), which the check must fail. Prints and writes every score.
//
//   node --import ./scripts/ts-loader.mjs scripts/audit/colour-calibration.ts --out docs/focus-pipeline-repair/baseline/colour-calibration.json

const { values } = parseArgs({ options: { out: { type: "string" } } });

type Case = { set: string; name: string; label: "positive" | "negative"; image: Rgba; sheet: string };

const cutout = async (file: string): Promise<Rgba> => {
  const image = await toRgba(await readFile(file));
  // Raw generator output on magenta is keyed; a cut-out with alpha is used as it is.
  return image.data.some((_, i) => i % 4 === 3 && image.data[i] < 255) ? image : keyOut(image);
};

/** The drawing with the pixels of its most common colour (within ΔE 20 of it) changed by `change`. */
function recolour(image: Rgba, change: (lab: [number, number, number]) => [number, number, number]): Rgba {
  const counts = new Map<string, { n: number; lab: [number, number, number] }>();
  for (let p = 0; p < image.width * image.height; p++) {
    if (image.data[p * 4 + 3] < 128) continue;
    const lab = toLab(image.data[p * 4], image.data[p * 4 + 1], image.data[p * 4 + 2]);
    const key = lab.map((v) => Math.round(v / 8)).join(",");
    const entry = counts.get(key) ?? { n: 0, lab };
    entry.n++;
    counts.set(key, entry);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0].lab;
  const data = Buffer.from(image.data);
  for (let p = 0; p < image.width * image.height; p++) {
    if (data[p * 4 + 3] < 128) continue;
    const lab = toLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    if (Math.hypot(lab[0] - top[0], lab[1] - top[1], lab[2] - top[2]) > 20) continue;
    const rgb = fromLab(change(lab));
    data[p * 4] = rgb[0]; data[p * 4 + 1] = rgb[1]; data[p * 4 + 2] = rgb[2];
  }
  return { ...image, data };
}
const turn = (degrees: number) => ([L, a, b]: [number, number, number]): [number, number, number] => {
  const t = (degrees * Math.PI) / 180;
  // A neutral colour gets a clear hue instead: turning grey changes nothing.
  const [x, y] = Math.hypot(a, b) < 8 ? [40, 0] : [a, b];
  return [L, x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
};
const invert = ([L, a, b]: [number, number, number]): [number, number, number] => [100 - L, a, b];

const cases: Case[] = [];
const fixture = "server/rotoscope/__fixtures__/wave";
for (const a of [1, 2, 3]) cases.push({ set: "wave attempts (by eye)", name: `a${a}`, label: "positive", image: await cutout(`${fixture}/a${a}_cutout_512.png`), sheet: `${fixture}/character.png` });
for (const dir of ["debug_runs/pipeline/2026-10-31T01-17-05-853Z_f1_existing", "debug_runs/pipeline/2026-10-31T01-17-53-490Z_f1_structured"]) {
  cases.push({ set: "wave real outputs (by eye)", name: path.basename(dir), label: "positive", image: await cutout(`${dir}/generated_raw.png`), sheet: `${fixture}/character.png` });
}
const v4 = ".focus-data/rotoscope/test-1s-v4";
for (const frame of (await readManifest(v4)).frames) {
  if (!frame.approved) continue;
  const raw = `${v4}/work/frame_${String(frame.index).padStart(4, "0")}_a${frame.approved.attempt}_raw.png`;
  cases.push({ set: "second character, approved", name: `frame ${frame.index}`, label: "positive", image: await cutout(raw), sheet: `${v4}/character.png` });
}
for (const positive of [...cases]) {
  for (const [what, change] of [["hue +120°", turn(120)], ["hue 180°", turn(180)], ["lightness inverted", invert]] as const) {
    cases.push({ ...positive, set: `${positive.set} → ${what}`, name: positive.name, label: "negative", image: recolour(positive.image, change) });
  }
}

const palettes = new Map<string, Palette>();
const rows: { set: string; name: string; label: string; passed: boolean; similarity?: number; asDrawn: number; foreign: number; jump: number | null; detail: string }[] = [];
for (const item of cases) {
  if (!palettes.has(item.sheet)) {
    const sheet = await readFile(item.sheet);
    palettes.set(item.sheet, await profiledPalette(sheet, { colours: (await sheetColours(sheet)).map((colour) => ({ ...colour, name: colour.hex })) }));
  }
  const { check, largestJump } = holdColours(item.image, palettes.get(item.sheet)!, null);
  const foreign = Number(/([\d.]+) % of the figure in colours/.exec(check.detail)?.[1] ?? 0);
  const drawn = Number(/\(([\d.]+) % as drawn\)/.exec(check.detail)?.[1]);
  rows.push({ set: item.set, name: item.name, label: item.label, passed: check.passed, similarity: check.score, asDrawn: drawn, foreign, jump: largestJump, detail: check.detail });
}
// Consecutive approved frames held to each other, as generateRun does from frame 2 on: the share rule must not reject them.
const sequence = cases.filter((item) => item.set === "second character, approved" && item.label === "positive");
for (const [i, item] of sequence.entries()) {
  if (!i) continue;
  const palette = palettes.get(item.sheet)!;
  const previous = holdColours(sequence[i - 1].image, palette, null).shares;
  const { check, largestJump } = holdColours(item.image, palette, previous);
  rows.push({ set: "second character, consecutive", name: `${sequence[i - 1].name} → ${item.name}`, label: "positive", passed: check.passed, similarity: check.score, asDrawn: NaN, foreign: 0, jump: largestJump, detail: check.detail });
}
// The same recoloured drawings with a correct previous frame (the unmodified drawing), as from frame 2 on.
for (const item of cases.filter((entry) => entry.label === "negative")) {
  const original = cases.find((entry) => entry.label === "positive" && entry.name === item.name && item.set.startsWith(entry.set))!;
  const palette = palettes.get(item.sheet)!;
  const { check, largestJump } = holdColours(item.image, palette, holdColours(original.image, palette, null).shares);
  rows.push({ set: `${item.set}, after a correct frame`, name: item.name, label: "negative", passed: check.passed, similarity: check.score, asDrawn: NaN, foreign: 0, jump: largestJump, detail: check.detail });
}
for (const row of rows) console.log(`${row.label.padEnd(8)} ${row.passed ? "PASS" : "FAIL"} sim ${row.similarity} drawn ${row.asDrawn} foreign ${row.foreign}% jump ${row.jump}  ${row.set} ${row.name}`);
const tally = (label: string) => rows.filter((row) => row.label === label);
console.log(`positives passed ${tally("positive").filter((row) => row.passed).length}/${tally("positive").length}; negatives failed ${tally("negative").filter((row) => !row.passed).length}/${tally("negative").length}`);
if (values.out) {
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)}\n`);
}
