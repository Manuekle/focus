// Regenerates the synthetic character fixtures under server/rotoscope/__fixtures__/wave/.
//
// Everything is drawn here from flat shapes, so the repository carries no third-party artwork. The
// sheet matches the keypoints in poses.json (nose, shoulders, ankles) and the three cut-outs reuse
// its colours with different arm positions, which is all the colour and hair-top checks look at.
// Edges are not anti-aliased: flat colour areas with hard edges are what a cel-shaded sheet measures as.
//
//   node scripts/make-wave-fixtures.mjs
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const out = new URL("../server/rotoscope/__fixtures__/wave/", import.meta.url);

const C = {
  skin: "#f5d0bc",
  hair: "#1c3b3a",
  blouse: "#75b57c",
  blouseShadow: "#447555",
  skirt: "#823c56",
  skirtShadow: "#4f2037",
  shoe: "#2b5a4a",
  ribbon: "#4a6fd0",
  line: "#241920",
};

const stroke = `stroke="${C.line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

/** One arm as a thick tube with an outline: shoulder → elbow → wrist. */
const arm = (points) => {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${C.blouse}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const hand = (x, y, rx = 18, ry = 14) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${C.skin}" ${stroke}/>`;

/** The figure in the sheet's own coordinates (690 × 753). `arms` picks the cut-out's pose. */
function figure(arms) {
  const back = `<path d="M286 78 Q282 20 350 26 Q418 20 414 78 L424 196 L276 196 Z" fill="${C.hair}" ${stroke}/>
    <circle cx="395" cy="22" r="20" fill="${C.hair}" ${stroke}/>
    <path d="M370 30 L386 36 L372 46 Z" fill="${C.ribbon}" ${stroke}/>`;
  const body = `
    <rect x="334" y="140" width="32" height="28" fill="${C.skin}" ${stroke}/>
    <path d="M303 154 L403 154 L396 336 L311 336 Z" fill="${C.blouse}" ${stroke}/>
    <path d="M372 160 L403 154 L396 336 L366 336 Z" fill="${C.blouseShadow}"/>
    <path d="M311 322 L396 322 Q478 520 472 716 Q330 748 158 716 Q170 520 311 322 Z" fill="${C.skirt}" ${stroke}/>
    <path d="M311 326 Q196 520 158 716 Q214 728 262 730 Q262 520 340 326 Z" fill="${C.skirtShadow}"/>
    <path d="M396 326 Q470 520 472 716 Q440 728 408 734 Q420 520 380 326 Z" fill="${C.skirtShadow}"/>
    <ellipse cx="322" cy="736" rx="24" ry="10" fill="${C.shoe}" ${stroke}/>
    <ellipse cx="388" cy="736" rx="24" ry="10" fill="${C.shoe}" ${stroke}/>`;
  const poses = {
    clasped: `${arm([[303, 162], [264, 249], [306, 262]])}${arm([[403, 162], [420, 250], [352, 261]])}${hand(330, 262, 30, 14)}`,
    wave: `${arm([[303, 162], [262, 252], [318, 268]])}${hand(332, 270)}${arm([[403, 162], [448, 96], [440, 30]])}${hand(440, 12, 16, 20)}`,
    open: `${arm([[303, 162], [214, 214], [160, 262]])}${hand(146, 266)}${arm([[403, 162], [480, 214], [534, 262]])}${hand(548, 266)}`,
  }[arms];
  const head = `
    <ellipse cx="350" cy="96" rx="52" ry="62" fill="${C.skin}" ${stroke}/>
    <path d="M298 82 Q300 32 350 33 Q402 32 402 82 Q372 56 350 70 Q326 54 298 82 Z" fill="${C.hair}" ${stroke}/>
    <ellipse cx="332" cy="80" rx="6" ry="8" fill="${C.line}"/>
    <ellipse cx="364" cy="77" rx="6" ry="8" fill="${C.line}"/>
    <path d="M338 116 Q348 122 358 116" fill="none" ${stroke}/>`;
  return `${back}${body}${head}`;
}

const svg = (width, height, content, background = "") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">${background}${content}</svg>`);

const sheet = await sharp(svg(690, 753, figure("clasped"), `<rect width="100%" height="100%" fill="#ffffff"/>`)).flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
await writeFile(new URL("character.png", out), sheet);

// The cut-outs: a 512 × 768 transparent canvas, the figure centred and sitting on the bottom edge.
for (const [n, arms] of [[1, "clasped"], [2, "wave"], [3, "open"]]) {
  const cutout = await sharp(svg(512, 768, `<g transform="translate(-94 15)">${figure(arms)}</g>`)).png().toBuffer();
  await writeFile(new URL(`a${n}_cutout_512.png`, out), cutout);
}
console.log("wrote character.png and a1–a3_cutout_512.png");
