import sharp from "sharp";
import { MAX_DRAWING_HOLD_SECONDS } from "../../shared/sequence";

export type TimedDrawing = { readonly frameId: string; readonly sprite: Buffer; readonly atSeconds: number; readonly holdSeconds: number };

/** Compare visible pixels, including internal details; silhouette alone misses blinks. */
function practicallySame(a: Buffer, b: Buffer): boolean {
  let difference = 0, visible = 0, changed = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (a[p + 3] < 16 && b[p + 3] < 16) continue;
    visible++;
    let delta = Math.abs(a[p + 3] - b[p + 3]);
    for (let channel = 0; channel < 3; channel++) delta += Math.abs(a[p + channel] * a[p + 3] - b[p + channel] * b[p + 3]) / 255;
    difference += delta / 4;
    if (delta > 24) changed++;
  }
  return visible > 0 && difference / visible <= 2 && changed / visible <= 0.002;
}

/** Flag only the drawings that extend a nearly unchanged pose beyond the limit. */
export async function overlongDrawingHolds(entries: readonly TimedDrawing[]): Promise<Set<string>> {
  const pixels = await Promise.all(entries.map((entry) => sharp(entry.sprite).resize(96, 96, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer()));
  const flagged = new Set<string>();
  let start = 0;
  for (let i = 0; i < entries.length; i++) {
    const previous = entries[i - 1];
    // A missing drawing is a gap, not proof that its neighbors repeat.
    if (i && (Math.abs(entries[i].atSeconds - previous.atSeconds - previous.holdSeconds) > 1e-6 || !practicallySame(pixels[start], pixels[i]))) start = i;
    if (entries[i].atSeconds + entries[i].holdSeconds - entries[start].atSeconds > MAX_DRAWING_HOLD_SECONDS + 1e-6) flagged.add(entries[i].frameId);
  }
  return flagged;
}
