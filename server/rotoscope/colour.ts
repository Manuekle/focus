import sharp from "sharp";
import type { Rgba } from "./alpha";
import type { Check } from "./run-state";

// Colour held to the character's palette. A generator drifts in tone from
// frame to frame (a greyer blouse, a cooler skin, black shorts gone dark grey,
// darker shadows) and a reviewer looking at a whole figure lets it through.
// The sheet's flat cel colours are clustered once per run (k-means in CIELAB,
// where distance is how different two colours look) and named by what they
// paint: that is the run's palette. Each drawing's colours are clustered the
// same way, every cluster is matched to the palette colour of its kind nearest
// to it, and its pixels are pulled onto that colour, keeping a quarter of
// their own variation for soft edges: every frame ends up in the same tones.
// The check fails on a colour the character doesn't have, on tones still far
// from the palette, and on a palette colour whose area jumps against the
// previous frame (a colour given to the wrong part).

type Lab = [number, number, number];

const linear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gamma = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const WHITE = [0.95047, 1, 1.08883] as const;
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const fi = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);

export function toLab(r: number, g: number, b: number): Lab {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / WHITE[0]);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / WHITE[2]);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function fromLab([L, a, b]: Lab): [number, number, number] {
  const y = (L + 16) / 116;
  const [X, Y, Z] = [fi(y + a / 500) * WHITE[0], fi(y), fi(y - b / 200) * WHITE[2]];
  return [gamma(3.2406 * X - 1.5372 * Y - 0.4986 * Z), gamma(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), gamma(0.0557 * X - 0.204 * Y + 1.057 * Z)];
}

const distance = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** k-means with farthest-point seeding: deterministic, so the same drawing always gives the same clusters. */
function kmeans(points: readonly Lab[], k: number, iterations = 12): { centres: Lab[]; shares: number[] } {
  if (!points.length) return { centres: [], shares: [] };
  const centres: Lab[] = [[...points[0]] as Lab];
  const nearest = points.map((p) => distance(p, centres[0]));
  while (centres.length < k) {
    let far = 0;
    for (let i = 1; i < points.length; i++) if (nearest[i] > nearest[far]) far = i;
    if (nearest[far] < 2) break;
    centres.push([...points[far]] as Lab);
    for (let i = 0; i < points.length; i++) nearest[i] = Math.min(nearest[i], distance(points[i], points[far]));
  }
  const assign = new Int32Array(points.length);
  for (let round = 0; round < iterations; round++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      for (let c = 1; c < centres.length; c++) if (distance(points[i], centres[c]) < distance(points[i], centres[best])) best = c;
      assign[i] = best;
      const s = sums[best];
      s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3]++;
    }
    for (let c = 0; c < centres.length; c++) if (sums[c][3]) centres[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  const counts = centres.map(() => 0);
  for (const c of assign) counts[c]++;
  return { centres, shares: counts.map((count) => count / points.length) };
}

const chroma = (p: Lab) => Math.hypot(p[1], p[2]);
const hue = (p: Lab) => Math.atan2(p[2], p[1]);
/** Below this chroma a colour reads as grey, white or black: its hue means nothing. */
const NEUTRAL = 8;

/** Up to this chroma a tone is only tinted (a pinkish white, a bluish grey): it may still go to a neutral colour. */
const TINTED = 12;

/** Whether `target` may take `centre`'s place: never a clear colour drained to grey or turned another hue. */
function sameKind(centre: Lab, target: Lab): boolean {
  if (chroma(centre) < NEUTRAL) return true;
  if (chroma(target) < NEUTRAL) return chroma(centre) < TINTED;
  if (chroma(target) < chroma(centre) / 2) return false;
  const turn = Math.abs(hue(centre) - hue(target));
  return Math.min(turn, 2 * Math.PI - turn) < Math.PI / 3;
}

/** Clusters per image: enough for skin, its cel shadow, hair, blouse, its shadow, shorts, socks, shoes, eyes, outlines. */
const CLUSTERS = 14;
/** Sample every Nth figure pixel for the clustering: a figure is ~200k pixels. */
const STRIDE = 7;
/** A drawing cluster farther than this (ΔE) from every palette colour is a colour the character doesn't have. */
const MAX_SHIFT = 26;
/** That much of the figure in such colours fails the check. */
const FOREIGN_SHARE = 0.03;
/**
 * How much of its own variation a pixel keeps around its palette colour: enough for the soft edge
 * between an outline and a fill, too little for a tone to drift (a greyer blouse, darker shadows).
 */
const KEEP = 0.25;
/**
 * The drawing's colours must sit this close to the palette (100 − mean ΔE, after holding them). Below it
 * the frame isn't approved and isn't drawn again for it (a minor finding: decision.ts): the run goes on
 * with the next frame and the one under the bar waits for a person.
 */
const MIN_SIMILARITY = 98;
/** A palette colour covering this much more or less of the figure than in the previous frame was given to the wrong part. */
const SHARE_JUMP = 0.06;
/** Palette colours this close look alike (the black of the shorts and of the outlines): their areas are compared together. */
const ALIKE = 15;

export const hex = (rgb: readonly number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** One flat colour of the character's design, named by what it paints ("hair", "hair shadow", "blouse"). */
export type PaletteColour = { readonly lab: Lab; readonly hex: string; readonly share: number; readonly name: string };
export type Palette = {
  readonly version?: number;
  readonly colours: readonly PaletteColour[];
  /**
   * Every colour on the sheet's figure, shading, accents and blends included (sheetGamut): what
   * "a colour the character doesn't have" is judged against. The palette is only what drawings are held to.
   */
  readonly gamut?: readonly Lab[];
  /**
   * How much of the sheet's own figure each palette colour covers. Not a reference a frame is held to (the
   * sheet's pose changes the areas too much), only a direction: a frame whose areas move back toward the
   * sheet's is correcting an earlier frame's mistake, not making one.
   */
  readonly sheetShares?: readonly number[];
};

/** Bumped when the palette is measured differently: a run's palette.json from before is measured again. */
export const PALETTE_VERSION = 6;
/** A sheet pixel counts as flat colour when every pixel this far around it is within FLAT ΔE of it. */
const FLAT_RADIUS = 2;
const FLAT = 4;
/** Sheet colours closer than this are one colour (dark brown shoes beside black socks are not); colours covering less than MIN_SHARE are specks. */
const MERGE = 5;
const MIN_SHARE = 0.008;
/** The darkest share of the figure: its outlines, measured apart because a thin line has no flat area. */
const LINE_SHARE = 0.02;
/**
 * Softly shaded areas (anime skin and hair): every neighbour within this ΔE. A cel gradient changes a
 * few ΔE per pixel and an outline-to-fill edge 30 or more, so this keeps shading and leaves edges out.
 */
const SOFT = 10;

/** Whether some palette colour may stand for `colour` in holdColours: of its kind and within MAX_SHIFT. */
const explains = (palette: readonly Lab[], colour: Lab) => palette.some((lab) => sameKind(colour, lab) && distance(colour, lab) <= MAX_SHIFT);

/**
 * The character sheet's colours, not yet named. The sheet has no alpha: its backdrop is everything
 * near the corner colour that connects to the image's edge, so a white blouse inside its outlines
 * stays figure even when it is as light as the backdrop. Only flat areas are measured: the soft
 * edge where two colours meet (black shorts over skin) is a blend, and a blend taken for a colour
 * of the design gets painted as one (a grey stripe on the shorts, glossy streaks in the hair).
 * The outline colour is measured apart, on the darkest pixels of the figure.
 */
/** The sheet in CIELAB with its backdrop marked: everything near the corner colour that connects to the image's edge. */
async function sheetPixels(sheet: Buffer): Promise<{ lab: Lab[]; outside: Uint8Array; width: number; height: number; rgb: Buffer }> {
  const { data, info } = await sharp(sheet).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const lab: Lab[] = Array.from({ length: width * height }, (_, p) => toLab(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]));
  const backdrop = lab[0];
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (outside[p] || distance(lab[p], backdrop) >= 6) continue;
    outside[p] = 1;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < (height - 1) * width) stack.push(p + width);
  }
  return { lab, outside, width, height, rgb: data };
}

export async function sheetColours(sheet: Buffer): Promise<Omit<PaletteColour, "name">[]> {
  const { lab, outside, width, height } = await sheetPixels(sheet);
  const r = FLAT_RADIUS;
  const flat: Lab[] = [];
  const figure: Lab[] = [];
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      const p = y * width + x;
      if (outside[p]) continue;
      if (p % STRIDE === 0) figure.push(lab[p]);
      if (p % STRIDE !== 0) continue;
      const around = [p - r, p + r, p - r * width, p + r * width, p - r * width - r, p - r * width + r, p + r * width - r, p + r * width + r];
      if (around.every((q) => !outside[q] && distance(lab[q], lab[p]) < FLAT)) flat.push(lab[p]);
    }
  }
  const { centres, shares } = kmeans(flat, CLUSTERS);
  // Merge clusters that are one colour split in two, weighting by how much each covers.
  const merged: { lab: Lab; share: number }[] = [];
  for (const [i, centre] of centres.map((c, i) => [i, c] as const).sort((a, b) => shares[b[0]] - shares[a[0]])) {
    const into = merged.find((m) => distance(m.lab, centre) < MERGE);
    if (!into) { merged.push({ lab: centre, share: shares[i] }); continue; }
    const total = into.share + shares[i];
    into.lab = [0, 1, 2].map((k) => (into.lab[k] * into.share + centre[k] * shares[i]) / total) as Lab;
    into.share = total;
  }
  const colours = merged.filter(({ share }) => share >= MIN_SHARE);
  // The outlines: the median of the darkest pixels of the whole figure (lines are too thin to be flat).
  const dark = [...figure].sort((a, b) => a[0] - b[0]).slice(0, Math.max(1, Math.round(figure.length * LINE_SHARE)));
  const line: Lab = [0, 1, 2].map((k) => [...dark].sort((a, b) => a[k] - b[k])[Math.floor(dark.length / 2)][k]) as Lab;
  if (!colours.some((colour) => distance(colour.lab, line) < MERGE)) colours.push({ lab: line, share: LINE_SHARE });
  // Softly shaded parts (skin, hair) are rarely flat enough for the pass above and would be missing from
  // the palette, so every drawing's skin would read as "a colour the character doesn't have". The palette
  // must explain the sheet itself by holdColours' own rule: a softly shaded colour covering MIN_SHARE of
  // the figure that no palette colour may stand for is added.
  const soft: Lab[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (outside[p] || p % STRIDE !== 0) continue;
      if ([p - 1, p + 1, p - width, p + width].every((q) => !outside[q] && distance(lab[q], lab[p]) < SOFT)) soft.push(lab[p]);
    }
  }
  const shaded = kmeans(soft, CLUSTERS);
  for (const i of shaded.centres.map((_, i) => i).sort((a, b) => shaded.shares[b] - shaded.shares[a])) {
    const centre = shaded.centres[i];
    const share = (shaded.shares[i] * soft.length) / Math.max(1, figure.length);
    if (share >= MIN_SHARE && !explains(colours.map((colour) => colour.lab), centre)) colours.push({ lab: centre, share });
  }
  const total = colours.reduce((sum, { share }) => sum + share, 0) || 1;
  return colours.map(({ lab, share }) => ({ lab, hex: hex(fromLab(lab)), share: Math.round((share / total) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share);
}

/** The palette as one picture: a named swatch per colour, for the generator and for people. */
export async function paletteImage(palette: Palette): Promise<Buffer> {
  const row = 64;
  const width = 640;
  const height = row * palette.colours.length + 16;
  const escape = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = palette.colours.map((colour, i) => `
    <rect x="16" y="${16 + i * row}" width="120" height="${row - 12}" fill="${colour.hex}" stroke="#222" stroke-width="2"/>
    <text x="156" y="${16 + i * row + 34}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#111">${escape(colour.name)}  ${colour.hex}</text>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/>${rows}</svg>`)).png().toBuffer();
}

/** The palette in words for a prompt: "hair #2c2b5c; hair shadow #1d1c40; …". */
export const paletteText = (palette: Palette) => palette.colours.map((colour) => `${colour.name} ${colour.hex}`).join("; ");

/** Clusters over the whole figure, finer than the palette's: small accents (a shoe's red trim) get their own. */
const GAMUT_CLUSTERS = 32;
/** A gamut colour must cover this much of the sheet's figure: a few stray pixels are not a colour of the design. */
const GAMUT_SHARE = 0.002;

/** Every colour on the sheet's figure (see Palette.gamut). */
export async function sheetGamut(sheet: Buffer): Promise<Lab[]> {
  const { lab, outside } = await sheetPixels(sheet);
  const figure = lab.filter((_, p) => !outside[p] && p % STRIDE === 0);
  const { centres, shares } = kmeans(figure, GAMUT_CLUSTERS);
  return centres.filter((_, i) => shares[i] >= GAMUT_SHARE).map((centre) => centre.map((v) => Math.round(v * 10) / 10) as Lab);
}

/** The sheet's figure as a cut-out (its backdrop transparent), measured like any drawing. */
export async function sheetCutout(sheet: Buffer): Promise<Rgba> {
  const { outside, width, height, rgb } = await sheetPixels(sheet);
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], outside[p] ? 0 : 255], p * 4);
  return { data, width, height };
}

/** A palette made complete with the sheet's gamut, what foreign colours are judged against. */
export async function profiledPalette(sheet: Buffer, palette: Palette): Promise<Palette> {
  const gamut = await sheetGamut(sheet);
  const sheetShares = holdColours(await sheetCutout(sheet), { ...palette, gamut }, null).shares.map((share) => Math.round(share * 1000) / 1000);
  return { ...palette, gamut, sheetShares };
}

/** How much of the figure each palette colour covers, with no change to the drawing: what the next frame is held to. */
export function paletteShares(image: Rgba, palette: Palette): number[] {
  return holdColours(image, palette, null).shares;
}

/**
 * Holds the drawing's colours to the palette (see the top of the file) and checks the result:
 * no colour the character doesn't have, every tone within reach of its palette colour, and every
 * palette colour covering about as much of the figure as in the previous frame (`previous`, the
 * shares of paletteShares), which catches a colour given to the wrong part (hair painted as the
 * shorts' black). Transparent pixels are left alone.
 */
export function holdColours(image: Rgba, palette: Palette, previous: readonly number[] | null): { image: Rgba; check: Check; shares: number[]; largestJump: number | null } {
  const { width, height, data } = image;
  const roles = palette.colours.map((colour) => colour.lab);
  const figure: number[] = [];
  for (let p = 0; p < width * height; p++) if (data[p * 4 + 3] >= 128) figure.push(p);
  if (!figure.length || !roles.length) return { image, check: { name: "colour", passed: true, detail: "nothing to compare" }, shares: roles.map(() => 0), largestJump: null };
  const labs = figure.map((p) => toLab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]));
  const { centres } = kmeans(labs.filter((_, i) => i % STRIDE === 0), Math.max(CLUSTERS, roles.length + 2));
  const targets = centres.map((centre) => {
    // Nearest palette colour of the same kind: a coloured cluster (dark navy hair, brown shoes) may only
    // go to a colour of a similar hue and at least half its chroma, never to the black of the shorts
    // that happens to be nearer; a neutral cluster may go to any colour.
    const options = roles.map((lab, role) => ({ lab, role })).filter(({ lab }) => sameKind(centre, lab));
    if (!options.length) return { role: -1, off: Infinity };
    // How far, plus how different in colourfulness: a faintly pink white is the white blouse, not the skin
    // that happens to be as near in plain distance.
    const cost = (lab: Lab) => distance(centre, lab) + Math.abs(chroma(centre) - chroma(lab));
    const best = options.reduce((a, b) => (cost(b.lab) < cost(a.lab) ? b : a));
    return { role: best.role, off: distance(centre, best.lab) };
  });
  // How far each cluster is from the nearest colour the sheet has (of its kind); without a gamut, the palette is all there is.
  const gamut = palette.gamut ?? [];
  const onSheet = centres.map((centre, c) => Math.min(targets[c].off, ...gamut.filter((lab) => sameKind(centre, lab)).map((lab) => distance(centre, lab))));
  const out = Buffer.from(data);
  const counts = centres.map(() => 0);
  const roleCounts = roles.map(() => 0);
  let residual = 0;
  for (let i = 0; i < figure.length; i++) {
    let c = 0;
    for (let j = 1; j < centres.length; j++) if (distance(labs[i], centres[j]) < distance(labs[i], centres[c])) c = j;
    counts[c]++;
    const { role, off } = targets[c];
    // A colour off the palette is left as drawn, not forced onto the nearest one: that would paint it wrong.
    // One the sheet has (a shading tone, an accent) costs its distance to the sheet; a foreign one the most.
    if (role < 0 || off > MAX_SHIFT) { residual += Math.min(100, onSheet[c]); continue; }
    roleCounts[role]++;
    const target = roles[role];
    const held: Lab = [0, 1, 2].map((k) => target[k] + KEEP * (labs[i][k] - centres[c][k])) as Lab;
    residual += distance(held, target);
    const rgb = fromLab(held);
    const p = figure[i] * 4;
    out[p] = rgb[0]; out[p + 1] = rgb[1]; out[p + 2] = rgb[2];
  }
  const shares = counts.map((count) => count / figure.length);
  const roleShares = roleCounts.map((count) => count / figure.length);
  const before = 100 - targets.reduce((sum, { off }, c) => sum + Math.min(100, off) * shares[c], 0);
  const similarity = 100 - residual / figure.length;
  const foreign = targets.map((_, c) => ({ off: onSheet[c], share: shares[c], colour: fromLab(centres[c]) })).filter(({ off, share }) => off > MAX_SHIFT && share > 0.002);
  const foreignShare = foreign.reduce((sum, { share }) => sum + share, 0);
  // Colours that look alike are one group: which of two near-blacks a line lands on changes nothing visible.
  const groups: number[][] = [];
  for (const [role, colour] of palette.colours.entries()) {
    const group = groups.find((members) => members.some((other) => distance(palette.colours[other].lab, colour.lab) < ALIKE));
    if (group) group.push(role); else groups.push([role]);
  }
  const sum = (shares: readonly number[], members: readonly number[]) => members.reduce((total, role) => total + (shares[role] ?? 0), 0);
  // Against the previous frame only. A first frame against the sheet's own shares was tried and can't be
  // calibrated: the sheet's pose changes the areas as much as a part painted the wrong colour does
  // (docs/focus-pipeline-repair/PHASE_05.md); that error is left to the review.
  const moves = previous ? groups.map((members) => ({ name: members.map((role) => palette.colours[role].name).join(" + "), from: sum(previous, members), to: sum(roleShares, members) })) : [];
  // A change back toward the sheet's own areas corrects the previous frame (dark stockings of the video drawn
  // on as shading, then dropped): holding a drawing to a wrong previous frame would pass the mistake on.
  const towardSheet = (members: readonly number[], from: number, to: number) => palette.sheetShares !== undefined && Math.abs(to - sum(palette.sheetShares, members)) < Math.abs(from - sum(palette.sheetShares, members));
  const jumps = moves.filter(({ from, to }, i) => Math.abs(to - from) > SHARE_JUMP && !towardSheet(groups[i], from, to));
  const largestJump = previous ? Math.round(Math.max(0, ...moves.map(({ from, to }) => Math.abs(to - from))) * 1000) / 1000 : null;
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  const problems = [
    foreignShare > FOREIGN_SHARE && `${pct(foreignShare)} of the figure in colours the character doesn't have (${foreign.map(({ colour, off }) => `${hex(colour)} ${Number.isFinite(off) ? `ΔE ${off.toFixed(0)}` : "no palette colour of that hue"}`).join(", ")})`,
    similarity < MIN_SIMILARITY && `colours ${similarity.toFixed(1)} % similar to the palette (needs ${MIN_SIMILARITY} %)`,
    jumps.length && `colours on the wrong parts: ${jumps.map(({ name, from, to }) => `${name} ${pct(from)} of the figure last frame, ${pct(to)} now`).join("; ")}`,
  ].filter(Boolean) as string[];
  const detail = `${similarity.toFixed(1)} % similar to the palette (${before.toFixed(1)} % as drawn)${problems.length ? `; ${problems.join("; ")}` : ""}`;
  const feedback = `Paint every part with exactly its colour from the colour palette, flat, as on the character sheet: ${paletteText(palette)}. Shadows use only the palette's shadow tones; no tint or gradient anywhere on the character. Accents the sheet has (trim and embroidery, closures, eyes) stay exactly as on the sheet.`;
  const passed = problems.length === 0;
  // A foreign colour or a colour on the wrong part is a real defect. A low similarity alone is not: it is
  // measured after the drawing was held to the palette and doesn't separate right from wrong drawings
  // (docs/focus-pipeline-repair/PHASE_05.md), so it is a minor finding, never a reason to redraw.
  const severity = foreignShare > FOREIGN_SHARE || jumps.length ? "major" : "minor";
  return {
    image: { data: out, width, height },
    check: { name: "colour", passed, detail, score: Math.round(similarity * 10) / 10, ...(passed ? {} : { feedback, severity }) },
    shares: roleShares,
    largestJump,
  };
}
