import sharp from "sharp";
import { ACCENT_RGB, type Finish, type Look } from "../../shared/render";

// The finishing layer, applied to every effect's output frame in a fixed
// order: grade → subject light → vignette → film grain → letterbox. All of it
// is deterministic (grain is seeded by the frame index), so a cached render
// and a fresh one are the same pixels.

type Grade = {
  readonly saturation: number;
  readonly contrast: number;
  /** Lifted blacks, 0–255. */
  readonly fade: number;
  /** Added to dark pixels, fading to nothing in the highlights. */
  readonly shadows: readonly [number, number, number];
  /** Added to bright pixels, fading to nothing in the shadows. */
  readonly highlights: readonly [number, number, number];
};

export const GRADES: Record<Exclude<Look, "natural">, Grade> = {
  cinematic: { saturation: 1.06, contrast: 1.12, fade: 0, shadows: [-12, 4, 16], highlights: [16, 6, -12] },
  noir: { saturation: 0, contrast: 1.3, fade: 6, shadows: [0, 0, 0], highlights: [0, 0, 0] },
  warm: { saturation: 1.06, contrast: 1.04, fade: 0, shadows: [8, 2, -6], highlights: [18, 8, -14] },
  cool: { saturation: 0.92, contrast: 1.06, fade: 0, shadows: [-8, 0, 14], highlights: [-10, 4, 16] },
  vintage: { saturation: 0.72, contrast: 0.9, fade: 22, shadows: [10, 4, -6], highlights: [12, 8, -10] },
  vivid: { saturation: 1.32, contrast: 1.1, fade: 0, shadows: [0, 0, 0], highlights: [0, 0, 0] },
};

export type Finisher = {
  /** Finishes one output frame in place. `alpha` is the subject in output coordinates, or null when absent. */
  apply(index: number, rgba: Buffer, alpha: Uint8Array | null): Promise<Buffer>;
};

export function isPlainFinish(finish: Finish): boolean {
  return finish.look === "natural" && finish.subject === "none" && finish.vignette === 0 && finish.grain === 0 && !finish.letterbox;
}

/** Null when the finish changes nothing, so plain renders pay no cost. */
export function createFinisher(width: number, height: number, finish: Finish): Finisher | null {
  if (isPlainFinish(finish)) return null;
  const grade = finish.look === "natural" ? null : GRADES[finish.look];
  const curve = grade ? toneCurve(grade) : null;
  const vignette = finish.vignette > 0 ? vignetteMap(width, height, finish.vignette) : null;
  const bars = finish.letterbox ? letterboxHeight(width, height) : 0;
  // Light sizes follow the frame; small frames keep a visible minimum.
  const scale = Math.max(0.5, Math.max(width, height) / 1280);
  return {
    async apply(index, rgba, alpha) {
      if (grade && curve) applyGrade(rgba, grade, curve);
      if (alpha && finish.subject !== "none") {
        const color = ACCENT_RGB[finish.accent];
        const strength = finish.accentStrength;
        if (finish.subject === "glow") {
          glow(rgba, alpha, await blurAlpha(alpha, width, height, (5 + 14 * strength) * scale), color, strength);
        } else {
          outline(rgba, alpha, await blurAlpha(alpha, width, height, (1.2 + 2.4 * strength) * scale), color);
        }
      }
      if (vignette || finish.grain > 0) applyVignetteAndGrain(rgba, vignette, finish.grain, index);
      if (bars > 0) {
        rgba.fill(0, 0, bars * width * 4);
        rgba.fill(0, (height - bars) * width * 4);
        for (let p = 3; p < bars * width * 4; p += 4) rgba[p] = 255;
        for (let p = (height - bars) * width * 4 + 3; p < rgba.length; p += 4) rgba[p] = 255;
      }
      return rgba;
    },
  };
}

/** Contrast around mid-gray, then lifted blacks, as one lookup. */
function toneCurve(grade: Grade): Uint8Array {
  const curve = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const contrasted = Math.min(255, Math.max(0, (v - 128) * grade.contrast + 128));
    curve[v] = Math.round(grade.fade + (contrasted * (255 - grade.fade)) / 255);
  }
  return curve;
}

const toByte = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value));

function applyGrade(rgba: Buffer, grade: Grade, curve: Uint8Array): void {
  // Split-tone offsets depend only on luma: one table per channel.
  const tint = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    for (let c = 0; c < 3; c++) tint[c][y] = grade.shadows[c] * (1 - t) + grade.highlights[c] * t;
  }
  const [tr, tg, tb] = tint;
  const s = grade.saturation;
  for (let p = 0; p < rgba.length; p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    // Rec. 709 luma in 8.8 fixed point.
    const y = (54 * r + 183 * g + 19 * b) >> 8;
    const vr = y + (r - y) * s + tr[y];
    const vg = y + (g - y) * s + tg[y];
    const vb = y + (b - y) * s + tb[y];
    rgba[p] = curve[vr <= 0 ? 0 : vr >= 255 ? 255 : vr | 0];
    rgba[p + 1] = curve[vg <= 0 ? 0 : vg >= 255 ? 255 : vg | 0];
    rgba[p + 2] = curve[vb <= 0 ? 0 : vb >= 255 ? 255 : vb | 0];
  }
}

function blurAlpha(alpha: Uint8Array, width: number, height: number, sigma: number): Promise<Buffer> {
  return sharp(Buffer.from(alpha.buffer, alpha.byteOffset, alpha.length), { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.3, sigma))
    // Keep one band: Sharp would otherwise return the mask as RGB.
    .toColourspace("b-w")
    .raw()
    .toBuffer();
}

/** A luminous halo outside the subject, screened over the frame. */
export function glow(rgba: Buffer, alpha: Uint8Array, blurred: Buffer, color: readonly number[], strength: number): void {
  const gain = (1.4 + 2 * strength) / 255;
  const [cr, cg, cb] = color;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const halo = blurred[i] - alpha[i];
    if (halo <= 0) continue;
    const a = Math.min(1, halo * gain) * 0.9;
    rgba[p] = 255 - ((255 - rgba[p]) * (255 - cr * a)) / 255;
    rgba[p + 1] = 255 - ((255 - rgba[p + 1]) * (255 - cg * a)) / 255;
    rgba[p + 2] = 255 - ((255 - rgba[p + 2]) * (255 - cb * a)) / 255;
  }
}

/** A clean stroke hugging the subject's silhouette, just outside its edge. */
export function outline(rgba: Buffer, alpha: Uint8Array, blurred: Buffer, color: readonly number[]): void {
  const [cr, cg, cb] = color;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const reach = (blurred[i] - 12) / 36;
    if (reach <= 0) continue;
    const a = Math.min(1, reach) * (1 - alpha[i] / 255) * 0.95;
    if (a <= 0) continue;
    rgba[p] = Math.round(rgba[p] + (cr - rgba[p]) * a);
    rgba[p + 1] = Math.round(rgba[p + 1] + (cg - rgba[p + 1]) * a);
    rgba[p + 2] = Math.round(rgba[p + 2] + (cb - rgba[p + 2]) * a);
  }
}

/** Per-pixel brightness multiplier (0–255) darkening toward the corners. */
export function vignetteMap(width: number, height: number, strength: number): Uint8Array {
  const map = new Uint8Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5 - cy) / cy;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - cx) / cx;
      const d = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
      const t = Math.min(1, Math.max(0, (d - 0.35) / 0.65));
      map[y * width + x] = Math.round(255 * (1 - strength * 0.85 * t * t * (3 - 2 * t)));
    }
  }
  return map;
}

function applyVignetteAndGrain(rgba: Buffer, vignette: Uint8Array | null, grain: number, index: number): void {
  const amplitude = grain * 30;
  // mulberry32, seeded per frame: the same frame always gets the same grain.
  let seed = (Math.imul(index + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  for (let i = 0, p = 0; p < rgba.length; i++, p += 4) {
    let r = rgba[p];
    let g = rgba[p + 1];
    let b = rgba[p + 2];
    if (vignette) {
      const m = vignette[i];
      r = (r * m) / 255;
      g = (g * m) / 255;
      b = (b * m) / 255;
    }
    if (amplitude > 0) {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const random = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      // Film grain lives in the midtones; it fades in deep shadow and highlight.
      const mid = 1 - Math.abs((r + g + b) / 382.5 - 1) * 0.6;
      const n = (random - 0.5) * 2 * amplitude * mid;
      r += n;
      g += n;
      b += n;
    }
    rgba[p] = toByte(r);
    rgba[p + 1] = toByte(g);
    rgba[p + 2] = toByte(b);
  }
}

/** Bars that crop a landscape frame to 2.39:1; a slim cinematic band on taller frames. */
export function letterboxHeight(width: number, height: number): number {
  if (width / height >= 1.3) return Math.max(0, Math.round((height - width / 2.39) / 2));
  return Math.round(height * 0.06);
}
