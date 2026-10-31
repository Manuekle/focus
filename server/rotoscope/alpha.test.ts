import { describe, expect, it } from "vitest";
import { borderColour, checkAlpha, KEY_COLOR, keyBackground, keyOut, type Rgba } from "./alpha";

type Colour = readonly [number, number, number];
const [W, H] = [200, 300];

/**
 * A figure on a background: a dark-outlined body (a rectangle with a hole between "arm" and "body" that shows the
 * background) filled with `fill`, on `background` darkened toward the bottom by `gradient` per row.
 */
function picture(background: Colour, fill: Colour, gradient = 0): Rgba {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBody = x >= 60 && x < 140 && y >= 40 && y < 260;
      const outline = inBody && (x < 63 || x >= 137 || y < 43 || y >= 257);
      const hole = x >= 90 && x < 110 && y >= 120 && y < 180;
      const holeOutline = x >= 87 && x < 113 && y >= 117 && y < 183 && !hole;
      const shade = Math.round(y * gradient);
      const colour: Colour = !inBody || hole ? [background[0] - shade, background[1], background[2] - shade] : outline || holeOutline ? [20, 15, 15] : fill;
      data[i] = Math.max(0, colour[0]);
      data[i + 1] = Math.max(0, colour[1]);
      data[i + 2] = Math.max(0, colour[2]);
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}
const alphaAt = (image: Rgba, x: number, y: number) => image.data[(y * W + x) * 4 + 3];

describe("keyBackground", () => {
  it("keys a crimson background with a vignette, the hole between arm and body too, and keeps a red garment", () => {
    // Higgsfield's crimson, a red hakama inside the figure.
    const { image, background } = keyBackground(picture([204, 0, 85], [235, 67, 66], 0.05));
    expect(background).not.toBe(KEY_COLOR);
    expect([alphaAt(image, 0, 0), alphaAt(image, W - 1, H - 1), alphaAt(image, 100, 150)]).toEqual([0, 0, 0]);
    expect(alphaAt(image, 75, 200)).toBe(255);
    expect(checkAlpha(image).passed).toBe(true);
  });

  it("keys a pink background Muse Image chose instead of magenta, keeping a pink sweater", () => {
    const { image, background } = keyBackground(picture([240, 80, 176], [228, 189, 185]));
    expect(background).toBe("#f050b0");
    expect([alphaAt(image, 0, 0), alphaAt(image, 100, 150), alphaAt(image, 75, 200)]).toEqual([0, 0, 255]);
    expect(checkAlpha(image).passed).toBe(true);
  });

  it("on a white background keys only what the border reaches: white enclosed by the figure may be a shirt", () => {
    const { image } = keyBackground(picture([250, 250, 250], [60, 60, 70]));
    expect(alphaAt(image, 0, 0)).toBe(0);
    expect(alphaAt(image, 100, 150)).toBe(255);
  });

  it("leaves magenta to keyOut, exactly as before", () => {
    const magenta = picture([255, 0, 255], [228, 189, 185]);
    const { image, background } = keyBackground(magenta);
    expect(background).toBe(KEY_COLOR);
    expect(image.data.equals(keyOut(magenta).data)).toBe(true);
  });

  it("reads no flat colour off a border that isn't one", () => {
    const noisy = picture([120, 120, 120], [60, 60, 70]);
    for (let i = 0; i < noisy.data.length; i += 4) noisy.data[i] = (i * 7919) % 256;
    expect(borderColour(noisy)).toBeNull();
    expect(keyBackground(noisy).background).toBe(KEY_COLOR);
  });
});
