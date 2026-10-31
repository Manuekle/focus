import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { fromRgba, keyOut, toRgba } from "../../server/rotoscope/alpha";
// The three frame-1 attempts of the wave run, cut out (magenta keyed) but with their colours as Muse Image drew them, at half size.
const run = ".focus-data/rotoscope/60bd847f-d485-4c71-a27d-2b3336ed6d62";
for (const a of [1, 2, 3]) {
  const cut = await fromRgba(keyOut(await toRgba(await readFile(`${run}/work/frame_0001_a${a}_muse_raw.png`))));
  await sharp(cut).resize(512, 768, { kernel: "nearest" }).png({ compressionLevel: 9 }).toFile(`server/rotoscope/__fixtures__/wave/a${a}_cutout_512.png`);
}
