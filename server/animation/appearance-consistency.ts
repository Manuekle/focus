import sharp from "sharp";

type Color = readonly [number, number, number];
export type BodyColors = readonly (Color | null)[];

// Quiet gestures leave these parts of the torso still. Sample their interior,
// excluding arms, outlines and most folds, rather than the whole silhouette.
const TORSO_BANDS = [[0.18, 0.27], [0.27, 0.36], [0.4, 0.49]] as const;

/** Median sRGB colors in body-relative patches; no segmentation/model call. */
export async function stationaryBodyColors(png: Buffer, body: { centerX: number; topY: number; footY: number }): Promise<BodyColors> {
  const { data, info } = await sharp(png).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const height = body.footY - body.topY;
  if (height <= 0) return TORSO_BANDS.map(() => null);
  const left = Math.max(0, Math.round(body.centerX - height * 0.04));
  const right = Math.min(info.width, Math.round(body.centerX + height * 0.04));
  return TORSO_BANDS.map(([start, end]) => {
    const top = Math.max(0, Math.round(body.topY + height * start));
    const bottom = Math.min(info.height, Math.round(body.topY + height * end));
    const channels: [number[], number[], number[]] = [[], [], []];
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] < 240) continue;
      for (let channel = 0; channel < 3; channel++) channels[channel].push(data[offset + channel]);
    }
    const count = channels[0].length;
    if (count < 16 || count < (right - left) * (bottom - top) * 0.75) return null;
    return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(count / 2)]) as [number, number, number];
  });
}

/** Flags a local tonal change even when both tones fall in the same coarse histogram bin. */
export function stationaryColorsDiffer(colors: BodyColors, reference: BodyColors): boolean {
  return colors.some((color, index) => {
    const expected = reference[index];
    return color && expected && color.some((value, channel) => Math.abs(value - expected[channel]) > 12);
  });
}
