import sharp from "sharp";
import { ACCENT_RGB, ASPECT_RATIO, type Aspect, type Delivery, type Title } from "../../shared/render";

// What the viewer receives on top of the effect: the crop to 16:9 or 9:16 and
// the titles. Both are deterministic per frame, so a cached render and a fresh
// one are the same pixels. Order per frame: effect → crop → finish → titles,
// so the grade, vignette and letterbox follow the final shape and the titles
// stay crisp above them.

/** Largest even-sized window of the requested shape that fits inside the frame. */
export function cropSize(width: number, height: number, aspect: Aspect): { width: number; height: number } {
  if (aspect === "original") return { width, height };
  const ratio = ASPECT_RATIO[aspect];
  let w = width;
  let h = Math.round(width / ratio);
  if (h > height) {
    h = height;
    w = Math.round(height * ratio);
  }
  const even = (value: number, max: number) => Math.min(max, Math.max(2, value - (value % 2)));
  return { width: even(w, width), height: even(h, height) };
}

export type Deliverer = {
  /** Output size after the crop. */
  readonly width: number;
  readonly height: number;
  /** True when the crop wants the subject's mask to follow it. */
  readonly follows: boolean;
  /** Crops one frame (and the subject mask in the same coordinates). */
  crop(rgba: Buffer, alpha: Uint8Array | null): { rgba: Buffer; alpha: Uint8Array | null };
  /** Draws the titles that are on screen at this output frame, in place. */
  titles(index: number, rgba: Buffer): Buffer;
};

type Bitmap = { readonly rgba: Buffer; readonly left: number; readonly top: number; readonly width: number; readonly height: number };
type PreparedTitle = { readonly bitmap: Bitmap; readonly start: number; readonly end: number };

const SIZE_FACTOR = { small: 0.05, medium: 0.075, large: 0.11 } as const;
const FADE_SECONDS = 0.25;
/** Fraction of the crop window the follow target moves per frame. */
const FOLLOW_EASE = 0.12;

export async function createDeliverer(source: { width: number; height: number; fps: number }, delivery: Delivery): Promise<Deliverer> {
  const out = cropSize(source.width, source.height, delivery.aspect);
  const crops = out.width !== source.width || out.height !== source.height;
  const prepared = await Promise.all(delivery.titles.map((title) => prepareTitle(title, out.width, out.height)));
  const follows = crops && delivery.follow;

  // The window's center, eased toward the subject so box jitter never shakes the frame.
  let centerX = source.width / 2;
  let centerY = source.height / 2;
  const free = { x: source.width - out.width, y: source.height - out.height };

  return {
    width: out.width,
    height: out.height,
    follows,
    crop(rgba, alpha) {
      if (!crops) return { rgba, alpha };
      if (follows && alpha) {
        const box = maskCenter(alpha, source.width, source.height);
        if (box) {
          centerX += (box.x - centerX) * FOLLOW_EASE;
          centerY += (box.y - centerY) * FOLLOW_EASE;
        }
      }
      const left = free.x === 0 ? 0 : clamp(Math.round(centerX - out.width / 2), 0, free.x);
      const top = free.y === 0 ? 0 : clamp(Math.round(centerY - out.height / 2), 0, free.y);
      const cropped = Buffer.allocUnsafe(out.width * out.height * 4);
      for (let y = 0; y < out.height; y++) {
        const from = ((top + y) * source.width + left) * 4;
        rgba.copy(cropped, y * out.width * 4, from, from + out.width * 4);
      }
      let croppedAlpha: Uint8Array | null = null;
      if (alpha) {
        croppedAlpha = new Uint8Array(out.width * out.height);
        for (let y = 0; y < out.height; y++) {
          const from = (top + y) * source.width + left;
          croppedAlpha.set(alpha.subarray(from, from + out.width), y * out.width);
        }
      }
      return { rgba: cropped, alpha: croppedAlpha };
    },
    titles(index, rgba) {
      if (!prepared.length) return rgba;
      const seconds = index / source.fps;
      for (const title of prepared) {
        const fade = titleOpacity(seconds, title.start, title.end);
        if (fade > 0) drawBitmap(rgba, out.width, title.bitmap, fade);
      }
      return rgba;
    },
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Center of the mask's pixels (sampled), or null when the frame has no subject. */
function maskCenter(alpha: Uint8Array, width: number, height: number): { x: number; y: number } | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 2) {
    const row = y * width;
    for (let x = 0; x < width; x += 2) {
      if (alpha[row + x] < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** 0–1 visibility of a title at a time: eased in and out, never longer than half its own length. */
export function titleOpacity(seconds: number, start: number, end: number): number {
  if (!(end > start) || seconds < start || seconds >= end) return 0;
  const fade = Math.min(FADE_SECONDS, (end - start) / 2);
  const t = Math.min(1, (seconds - start) / fade, (end - seconds) / fade);
  return t * t * (3 - 2 * t);
}

function drawBitmap(rgba: Buffer, width: number, bitmap: Bitmap, opacity: number): void {
  for (let y = 0; y < bitmap.height; y++) {
    let p = ((bitmap.top + y) * width + bitmap.left) * 4;
    let q = y * bitmap.width * 4;
    for (let x = 0; x < bitmap.width; x++, p += 4, q += 4) {
      const a = (bitmap.rgba[q + 3] / 255) * opacity;
      if (a <= 0) continue;
      rgba[p] = Math.round(rgba[p] + (bitmap.rgba[q] - rgba[p]) * a);
      rgba[p + 1] = Math.round(rgba[p + 1] + (bitmap.rgba[q + 1] - rgba[p + 1]) * a);
      rgba[p + 2] = Math.round(rgba[p + 2] + (bitmap.rgba[q + 2] - rgba[p + 2]) * a);
    }
  }
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Greedy word wrap by estimated width; a manual line break always breaks. */
export function wrapTitle(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

async function prepareTitle(title: Title, width: number, height: number): Promise<PreparedTitle> {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * SIZE_FACTOR[title.size]));
  const lineHeight = Math.round(fontSize * 1.22);
  const maxChars = Math.max(6, Math.floor((width * 0.86) / (fontSize * 0.56)));
  const lines = wrapTitle(title.text, maxChars);
  const bandHeight = Math.min(height, lines.length * lineHeight + fontSize);
  const [r, g, b] = ACCENT_RGB[title.color];
  const fill = title.style === "box" ? "#ffffff" : `rgb(${r},${g},${b})`;
  const stroke = title.style === "shadow" ? ` stroke="#000" stroke-opacity="0.6" stroke-width="${Math.max(2, fontSize * 0.1).toFixed(1)}" stroke-linejoin="round" paint-order="stroke"` : "";
  const text = lines
    .map((line, i) => `<text x="${width / 2}" y="${(fontSize * 0.5 + (i + 0.8) * lineHeight).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="${fill}"${stroke}>${escapeXml(line)}</text>`)
    .join("");
  const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight}" viewBox="0 0 ${width} ${bandHeight}">${inner}</svg>`;
  const render = async (inner: string) => sharp(Buffer.from(svg(inner))).ensureAlpha().raw().toBuffer();

  // The ink's own bounds: the band is mostly empty.
  const ink = bounds(await render(text), width, bandHeight);
  if (!ink) return { bitmap: { rgba: Buffer.alloc(4), left: 0, top: 0, width: 1, height: 1 }, start: title.start, end: title.end };
  let area = ink;
  let layers = text;
  if (title.style === "box") {
    const pad = Math.round(fontSize * 0.45);
    area = { left: Math.max(0, ink.left - pad), top: Math.max(0, ink.top - Math.round(pad * 0.7)), right: Math.min(width, ink.right + pad), bottom: Math.min(bandHeight, ink.bottom + Math.round(pad * 0.7)) };
    layers = `<rect x="${area.left}" y="${area.top}" width="${area.right - area.left}" height="${area.bottom - area.top}" rx="${Math.round(fontSize * 0.3)}" fill="#000" fill-opacity="0.62"/>${text}`;
  } else if (title.style === "shadow") {
    const margin = Math.ceil(fontSize * 0.1);
    area = { left: Math.max(0, ink.left - margin), top: Math.max(0, ink.top - margin), right: Math.min(width, ink.right + margin), bottom: Math.min(bandHeight, ink.bottom + margin) };
  }
  const full = await render(layers);
  const w = area.right - area.left;
  const h = area.bottom - area.top;
  const tight = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((area.top + y) * width + area.left) * 4;
    full.copy(tight, y * w * 4, from, from + w * 4);
  }
  // Safe margins: portrait leaves room for the player's own controls at the bottom.
  const bottomMargin = Math.round(height * (height > width ? 0.13 : 0.09));
  const top = title.position === "top" ? Math.round(height * 0.07) : title.position === "center" ? Math.round((height - h) / 2) : height - h - bottomMargin;
  return { bitmap: { rgba: tight, left: Math.round((width - w) / 2), top: clamp(top, 0, Math.max(0, height - h)), width: w, height: h }, start: title.start, end: title.end };
}

/** Bounds of the pixels with any ink, or null for an empty band. */
function bounds(rgba: Buffer, width: number, height: number): { left: number; top: number; right: number; bottom: number } | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}
