import sharp from "sharp";
import { generateImage, type ImageReference } from "../animation/muse-image";
import { KEY_COLOR, keyBackground, toRgba, fromRgba, type Rgba } from "../rotoscope/alpha";
import { CANVAS, onColour, toCanvas } from "../rotoscope/draw";
import { area, dilate, type Mask } from "./mask";

// Selective repair with Muse Image: only the surface a deformation exposed
// (or stretched past its limits) is repainted. Muse Image edits the whole
// picture, so its result is pasted back only inside the marked regions,
// feathered: every other pixel — the pose, the line art, the face — stays
// the deformed drawing's own. The caller re-estimates the pose afterwards
// and throws the repair away if it moved anything.

/** Repairs smaller than this share of the canvas are left to the local fill. */
export const MIN_REPAIR_SHARE = 0.0015;

export type Generate = typeof generateImage;

export type Repair = { readonly png: Buffer; readonly applied: boolean; readonly note: string; readonly area: number };

async function marked(png: Buffer, regions: Mask): Promise<Buffer> {
  const overlay = Buffer.alloc(regions.width * regions.height * 4);
  for (let p = 0; p < regions.data.length; p++) {
    if (!regions.data[p]) continue;
    overlay[p * 4] = 255; overlay[p * 4 + 3] = 170;
  }
  const red = await sharp(overlay, { raw: { width: regions.width, height: regions.height, channels: 4 } }).png().toBuffer();
  return sharp(await onColour(png, KEY_COLOR)).composite([{ input: red }]).png().toBuffer();
}

/** `deformed` is the RGBA drawing on the canvas; `regions` what to repaint, in the same grid. */
export async function repairRegions(input: {
  readonly deformed: Rgba;
  readonly regions: Mask;
  readonly character: Buffer;
  readonly description: string;
  readonly hints: readonly string[];
  readonly signal?: AbortSignal;
  readonly generate?: Generate;
}): Promise<Repair> {
  const size = area(input.regions);
  const png = await fromRgba(input.deformed);
  if (size < MIN_REPAIR_SHARE * input.regions.width * input.regions.height) return { png, applied: false, note: `nothing to repaint (${size} px)`, area: size };
  const references: ImageReference[] = [
    { png: await onColour(png, KEY_COLOR), role: "THE DRAWING TO EDIT. Its pose, outlines, face, size and position are final." },
    { png: await marked(png, input.regions), role: "THE SAME DRAWING with the areas to repaint in RED. Only those areas may change." },
    { png: input.character, role: "THE CHARACTER SHEET: the design (clothes, skin, hair colours, line style) the repainted areas must continue." },
  ];
  const prompt = [
    "Edit Image 1. Repaint ONLY the areas marked red in Image 2 so they continue the surrounding drawing seamlessly: the same skin, clothing, hair, outlines and flat cel colours as Image 1 and the character sheet (Image 3).",
    `Character design: ${input.description}`,
    "Do not move, redraw or resize anything outside the red areas: the pose, every limb, the hands, the head, the face and the outline positions stay exactly as in Image 1. Never draw the red marks.",
    ...input.hints,
    `The background stays perfectly flat solid ${KEY_COLOR} magenta.`,
  ].join("\n");
  const generate = input.generate ?? generateImage;
  const result = await generate({ prompt, references, action: "edit", size: `${CANVAS.width}x${CANVAS.height}`, signal: input.signal });
  const edited = keyBackground(await toRgba(await toCanvas(result.png))).image;
  // Paste back inside the regions, grown a little and feathered so the seam disappears.
  const grown = dilate(input.regions, 3);
  const { width, height } = input.deformed;
  const weight = await sharp(Buffer.from(grown.data.map((v) => (v ? 255 : 0))), { raw: { width, height, channels: 1 } }).blur(1.5).raw().toBuffer();
  const out = Buffer.from(input.deformed.data);
  for (let p = 0; p < width * height; p++) {
    // Only where the edit drew opaque figure: its keyed-out background never replaces the drawing.
    // Only inside the deformed figure, and only where the edit drew opaque figure: the repair
    // fills surface, it never moves the outline (a shifted edit would ghost along the edges).
    const w = (weight[p] / 255) * (edited.data[p * 4 + 3] >= 250 && input.deformed.data[p * 4 + 3] >= 128 ? 1 : 0);
    if (w <= 0) continue;
    for (let c = 0; c < 4; c++) out[p * 4 + c] = Math.round(out[p * 4 + c] * (1 - w) + edited.data[p * 4 + c] * w);
  }
  return { png: await fromRgba({ data: out, width, height }), applied: true, note: `repainted ${size} px with Muse Image`, area: size };
}
