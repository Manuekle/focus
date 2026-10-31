import sharp from "sharp";
import type { Pose } from "../rotoscope/pose-match";
import { procrustes, applySimilarity } from "../rotoscope/scan";
import type { Vec } from "../mapping/geometry";
import { BONES, cocoPoint, skeletonFromPose, torsoLength, type JointName, type Skeleton } from "../mapping/skeleton";

// The debug run's pictures: keypoints over an image, the three images side by
// side, Image A's skeleton laid over the output, and close crops of the parts
// that break first (head, hands, feet). Plain SVG composited by sharp.

const RIGHT = "#e03131";
const LEFT = "#1c7ed6";
const CENTRE = "#2f9e44";
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// COCO-WholeBody body links: subject's right side red, left blue, centre green.
const BODY_LINKS: readonly [number, number, string][] = [
  [5, 6, CENTRE], [11, 12, CENTRE], [5, 11, LEFT], [6, 12, RIGHT], [0, 1, CENTRE], [0, 2, CENTRE], [1, 3, LEFT], [2, 4, RIGHT],
  [5, 7, LEFT], [7, 9, LEFT], [6, 8, RIGHT], [8, 10, RIGHT],
  [11, 13, LEFT], [13, 15, LEFT], [12, 14, RIGHT], [14, 16, RIGHT],
  [15, 17, LEFT], [15, 18, LEFT], [15, 19, LEFT], [16, 20, RIGHT], [16, 21, RIGHT], [16, 22, RIGHT],
];
/** Each finger: wrist point then four joints, as offsets inside a 21-point hand. */
const FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]];

async function size(png: Buffer) {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return { width, height };
}

/** The pose's keypoints over the image: body links, hand fingers, face points; low-confidence points are left out. */
export async function poseOverlay(png: Buffer, pose: Pose): Promise<Buffer> {
  const { width, height } = await size(png);
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 300));
  const p = (i: number) => cocoPoint(pose, i)?.p ?? null;
  const line = (a: Vec, b: Vec, colour: string, w = stroke) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/>`;
  const dot = (q: Vec, colour: string, r: number) => `<circle cx="${q[0]}" cy="${q[1]}" r="${r}" fill="${colour}" stroke="#fff" stroke-width="${Math.max(1, r / 3)}"/>`;
  const parts: string[] = [];
  for (const [from, to, colour] of BODY_LINKS) {
    const [a, b] = [p(from), p(to)];
    if (a && b) parts.push(line(a, b, colour));
  }
  for (const [base, colour] of [[91, LEFT], [112, RIGHT]] as const) {
    for (const finger of FINGERS) for (let k = 1; k < finger.length; k++) {
      const [a, b] = [p(base + finger[k - 1]), p(base + finger[k])];
      if (a && b) parts.push(line(a, b, colour, Math.max(1, stroke / 2)));
    }
  }
  for (let i = 0; i < 17; i++) { const q = p(i); if (q) parts.push(dot(q, i % 2 ? LEFT : i ? RIGHT : CENTRE, stroke * 1.4)); }
  for (let i = 23; i < 91; i++) { const q = p(i); if (q) parts.push(dot(q, "#f59f00", Math.max(1, stroke / 2))); }
  const legend = `<g font-family="Helvetica, Arial, sans-serif" font-size="${Math.max(12, stroke * 6)}" font-weight="700"><rect x="0" y="0" width="${Math.min(width, stroke * 150)}" height="${stroke * 9}" fill="rgba(255,255,255,0.85)"/><text x="${stroke * 2}" y="${stroke * 6.5}" fill="${RIGHT}">subject's right</text><text x="${stroke * 55}" y="${stroke * 6.5}" fill="${LEFT}">subject's left</text><text x="${stroke * 105}" y="${stroke * 6.5}" fill="#f59f00">face</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}${legend}</svg>`;
  return sharp(png).flatten({ background: "#ffffff" }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

const ALIGN: readonly JointName[] = ["leftShoulder", "rightShoulder", "leftHip", "rightHip", "neck", "pelvis"];

/**
 * Image A's skeleton carried onto the output by a similarity fitted on the torso (scale, rotation,
 * shift: no shape change), dashed green, over the output's own skeleton in pink. Where the two
 * part is where the pose was lost.
 */
export async function skeletonAlignment(output: Buffer, poseA: Pose, poseOut: Pose): Promise<Buffer | null> {
  const [a, o] = [skeletonFromPose(poseA), skeletonFromPose(poseOut)];
  const pairs = ALIGN.filter((name) => a[name] && o[name]);
  const fit = procrustes(pairs.map((name) => a[name]!.p), pairs.map((name) => o[name]!.p));
  if (!fit) return null;
  const { width, height } = await size(output);
  const stroke = Math.max(3, Math.round(Math.max(width, height) / 220));
  const draw = (s: Skeleton, colour: string, map: (q: Vec) => Vec, dash: string) => BONES.flatMap((bone) => {
    const [p, q] = [s[bone.from as JointName]?.p, s[bone.to as JointName]?.p];
    if (!p || !q) return [];
    const [m, n] = [map(p), map(q)];
    return [`<line x1="${m[0]}" y1="${m[1]}" x2="${n[0]}" y2="${n[1]}" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" ${dash}/>`];
  }).join("");
  const faded = await sharp(output).flatten({ background: "#ffffff" }).modulate({ brightness: 1.25, saturation: 0.35 }).png().toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${draw(o, "#d6338a", (q) => q, "")}${draw(a, CENTRE, (q) => applySimilarity(fit, q), `stroke-dasharray="${stroke * 3} ${stroke * 2}"`)}<g font-family="Helvetica, Arial, sans-serif" font-size="${stroke * 5}" font-weight="700"><text x="${stroke * 2}" y="${stroke * 6}" fill="${CENTRE}">Image A pose (fitted on the torso)</text><text x="${stroke * 2}" y="${stroke * 12}" fill="#d6338a">output pose</text></g></svg>`;
  return sharp(faded).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

const LABEL = 44;

async function cell(png: Buffer | null, width: number, height: number, label: string, note = "not available"): Promise<Buffer> {
  const body = png
    ? await sharp(png).flatten({ background: "#ffffff" }).resize(width, height, { fit: "contain", background: "#ffffff", kernel: "lanczos3" }).png().toBuffer()
    : await sharp({ create: { width, height, channels: 3, background: "#e9ecef" } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#868e96">${escape(note)}</text></svg>`) }]).png().toBuffer();
  const title = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><rect width="100%" height="100%" fill="#212529"/><text x="12" y="29" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff">${escape(label)}</text></svg>`);
  return sharp({ create: { width, height: height + LABEL, channels: 3, background: "#ffffff" } })
    .composite([{ input: title, left: 0, top: 0 }, { input: body, left: 0, top: LABEL }]).png().toBuffer();
}

/** Labelled panels in one row, each fitted (never stretched) into the same cell. */
export async function panelRow(panels: readonly { readonly label: string; readonly png: Buffer | null; readonly note?: string }[], width = 512, height = 768): Promise<Buffer> {
  const gap = 12;
  const cells = await Promise.all(panels.map((panel) => cell(panel.png, width, height, panel.label, panel.note)));
  return sharp({ create: { width: panels.length * width + (panels.length - 1) * gap, height: height + LABEL, channels: 3, background: "#ffffff" } })
    .composite(cells.map((input, i) => ({ input, left: i * (width + gap), top: 0 }))).png().toBuffer();
}

/** Rows stacked top to bottom. */
export async function stack(rows: readonly Buffer[]): Promise<Buffer> {
  const sizes = await Promise.all(rows.map(size));
  const width = Math.max(...sizes.map((s) => s.width));
  const gap = 16;
  const height = sizes.reduce((sum, s) => sum + s.height, 0) + gap * (rows.length - 1);
  let top = 0;
  const layers = rows.map((input, i) => { const layer = { input, left: 0, top }; top += sizes[i].height + gap; return layer; });
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).composite(layers).png().toBuffer();
}

type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** A square around `centre`, `half` wide each way, clipped to the image. */
function square(centre: Vec, half: number, width: number, height: number): Box | null {
  const left = Math.max(0, Math.round(centre[0] - half));
  const top = Math.max(0, Math.round(centre[1] - half));
  const right = Math.min(width, Math.round(centre[0] + half));
  const bottom = Math.min(height, Math.round(centre[1] + half));
  return right - left > 8 && bottom - top > 8 ? { left, top, width: right - left, height: bottom - top } : null;
}

export type CropPart = "head" | "left hand" | "right hand" | "feet";
export const CROP_PARTS: readonly CropPart[] = ["head", "left hand", "right hand", "feet"];

/** Where each part is in one image, from its pose; null where the pose doesn't show it. */
export function cropBox(pose: Pose | null, part: CropPart, width: number, height: number): Box | null {
  if (!pose) return null;
  const s = skeletonFromPose(pose);
  const torso = torsoLength(s);
  if (!torso) return null;
  if (part === "head") return s.head ? square(s.neck ? [(s.head.p[0] * 2 + s.neck.p[0]) / 3, (s.head.p[1] * 2 + s.neck.p[1]) / 3] : s.head.p, torso * 0.55, width, height) : null;
  if (part === "feet") {
    const feet = [s.leftAnkle, s.rightAnkle, s.leftToe, s.rightToe].filter((joint) => joint !== null).map((joint) => joint!.p);
    if (!feet.length) return null;
    const xs = feet.map((p) => p[0]);
    const ys = feet.map((p) => p[1]);
    const centre: Vec = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    return square(centre, Math.max(torso * 0.35, (Math.max(...xs) - Math.min(...xs)) / 2 + torso * 0.15), width, height);
  }
  const joint = part === "left hand" ? s.leftHand ?? s.leftWrist : s.rightHand ?? s.rightWrist;
  return joint ? square(joint.p, torso * 0.28, width, height) : null;
}

/** One row per part (head, each hand, feet), one column per image: the parts that break first, side by side. */
export async function cropSheet(images: readonly { readonly label: string; readonly png: Buffer; readonly pose: Pose | null }[]): Promise<Buffer> {
  const rows: Buffer[] = [];
  for (const part of CROP_PARTS) {
    const panels = await Promise.all(images.map(async (image) => {
      const { width, height } = await size(image.png);
      const box = cropBox(image.pose, part, width, height);
      return { label: `${part} · ${image.label}`, png: box ? await sharp(image.png).extract(box).png().toBuffer() : null, note: "not detected" };
    }));
    rows.push(await panelRow(panels, 360, 360));
  }
  return stack(rows);
}
