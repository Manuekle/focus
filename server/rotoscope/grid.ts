import sharp from "sharp";
import type { Check } from "./run-state";
import type { Pose } from "./pose-match";

// A measuring grid shared by every image the generator sees (pose skeleton,
// greyscale source frame, previous drawing), so the character is drawn at
// the same size and place in every frame. Two target lines mark where the top
// of the hair and the soles must land, from the character sheet's proportions.
// The scale check then measures the drawing against those lines.

export const GRID = { columns: 8, rows: 12, cell: 128 } as const;

/** Grid lines are counted from the top: line 0 is the top edge, line 12 the bottom. */
export const toLine = (y: number) => Math.round((y / GRID.cell) * 10) / 10;

export type Marks = { readonly head: number; readonly feet: number; readonly center: number };

export async function withGrid(png: Buffer, marks?: Marks): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const lines: string[] = [];
  for (let c = 1; c < GRID.columns; c++) lines.push(`<line x1="${c * GRID.cell}" y1="0" x2="${c * GRID.cell}" y2="${height}"/>`);
  for (let r = 1; r < GRID.rows; r++) lines.push(`<line x1="0" y1="${r * GRID.cell}" x2="${width}" y2="${r * GRID.cell}"/>`);
  const labels = Array.from({ length: GRID.rows + 1 }, (_, r) => `<text x="6" y="${Math.min(height - 6, Math.max(22, r * GRID.cell + 8))}">${r}</text>`);
  const targets = marks
    ? `<g stroke="#00a651" fill="none">
        <line x1="0" y1="${marks.head}" x2="${width}" y2="${marks.head}" stroke-width="4" stroke-dasharray="18 10"/>
        <line x1="0" y1="${marks.feet}" x2="${width}" y2="${marks.feet}" stroke-width="5"/>
        <line x1="${marks.center}" y1="0" x2="${marks.center}" y2="${height}" stroke-width="3" stroke-dasharray="10 10"/>
      </g>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g stroke="#7a7a7a" stroke-width="2" stroke-opacity="0.75">${lines.join("")}</g>
    <g font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#1a1a1a">${labels.join("")}</g>
    ${targets}
  </svg>`;
  return sharp(png).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
}

/** Top and bottom rows of the character sheet's figure on its light background. */
export async function figureBox(png: Buffer): Promise<{ top: number; bottom: number }> {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 200) { if (top < 0) top = y; bottom = y; break; }
    }
  }
  if (top < 0) throw new Error("the character image has no figure on a light background");
  return { top, bottom };
}

const at = (p: Pose, i: number) => (p.keypoints[i]?.[0] == null || (p.scores[i] ?? 0) < 0.3 ? null : p.keypoints[i] as [number, number]);

/**
 * The character sheet's head-top and sole offsets, measured from the nose and the ankles, in sheet pixels.
 * headHeight (hair top to chin) and figureHeight (hair top to soles) give how many heads tall the character is.
 */
export type Proportions = { readonly headAboveNose: number; readonly solesBelowAnkles: number; readonly headHeight: number; readonly figureHeight: number };

/** COCO-WholeBody: the chin is face point 8. */
export const CHIN = 31;

export function proportions(reference: Pose, box: { top: number; bottom: number }): Proportions {
  const [nose, la, ra, chin] = [at(reference, 0), at(reference, 15), at(reference, 16), at(reference, CHIN)];
  if (!nose || !la || !ra) throw new Error("the character image needs a visible face and both ankles");
  // Without a detected chin, the chin sits about as far below the nose as the anime norm (a third of the hair-to-nose span).
  const chinY = chin && chin[1] > nose[1] ? chin[1] : nose[1] + (nose[1] - box.top) / 3;
  return { headAboveNose: nose[1] - box.top, solesBelowAnkles: box.bottom - (la[1] + ra[1]) / 2, headHeight: chinY - box.top, figureHeight: box.bottom - box.top };
}

/** Where hair top, soles and body centre belong on the canvas, for a pose drawn at `size` × the sheet. */
export function targets(pose: Pose, size: number, sheet: Proportions, transform: { scale: number; x: number; y: number }): Marks | null {
  const [nose, la, ra, lh, rh] = [at(pose, 0), at(pose, 15), at(pose, 16), at(pose, 11), at(pose, 12)];
  if (!nose || !la || !ra || !lh || !rh) return null;
  return {
    head: (nose[1] - sheet.headAboveNose * size) * transform.scale + transform.y,
    feet: ((la[1] + ra[1]) / 2 + sheet.solesBelowAnkles * size) * transform.scale + transform.y,
    center: ((lh[0] + rh[0]) / 2) * transform.scale + transform.x,
  };
}

export type ScaleLimits = { readonly head: number; readonly feet: number; readonly center: number };
export const DEFAULT_SCALE_LIMITS: ScaleLimits = { head: 0.08, feet: 0.06, center: 0.08 };

/** The drawing's hair top, soles and centre against the target lines, as shares of the target figure height. */
export function checkScale(drawn: Marks | null, target: Marks, limits: ScaleLimits = DEFAULT_SCALE_LIMITS): Check {
  if (!drawn) return { name: "scale", passed: false, detail: "face, ankles or hips not found in the drawing", feedback: "Draw the whole character facing the camera, head to feet." };
  const height = target.feet - target.head;
  const errors = { head: (drawn.head - target.head) / height, feet: (drawn.feet - target.feet) / height, center: (drawn.center - target.center) / height };
  const fixes: string[] = [];
  if (Math.abs(errors.head) > limits.head) fixes.push(`The top of the hair must touch grid line ${toLine(target.head)} (it is at ${toLine(drawn.head)}).`);
  if (Math.abs(errors.feet) > limits.feet) fixes.push(`The soles must stand on grid line ${toLine(target.feet)} (they are at ${toLine(drawn.feet)}).`);
  if (Math.abs(errors.center) > limits.center) fixes.push(`Centre the hips on the green vertical line (${errors.center > 0 ? "move left" : "move right"}).`);
  const percent = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value * 100)} %`;
  const detail = `hair ${toLine(drawn.head)}/${toLine(target.head)}, soles ${toLine(drawn.feet)}/${toLine(target.feet)} (head ${percent(errors.head)}, feet ${percent(errors.feet)}, centre ${percent(errors.center)})`;
  return { name: "scale", passed: fixes.length === 0, detail, score: Math.round(Math.max(Math.abs(errors.head), Math.abs(errors.feet)) * 1000) / 1000, ...(fixes.length ? { feedback: fixes.join(" ") } : {}) };
}
