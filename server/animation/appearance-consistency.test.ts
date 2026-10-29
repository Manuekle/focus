import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { stationaryBodyColors, stationaryColorsDiffer } from "./appearance-consistency";
import { checkFrames, type QcEntry } from "./quality-control";

const body = { centerX: 80, topY: 8, footY: 248 };
const original = [238, 239, 244] as const;

async function drawing(shirt: readonly number[] = original, armX = 40, background = "#00000000") {
  const rectangle = (width: number, height: number, color: string) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: 160, height: 256, channels: 4, background } }).composite([
    { input: await rectangle(38, 55, `rgb(${shirt.join(",")})`), left: 61, top: 45 },
    { input: await rectangle(38, 40, "#22242b"), left: 61, top: 100 },
    { input: await rectangle(2, 50, "#22242b"), left: 79, top: 47 },
    { input: await rectangle(10, 55, "#f9cfc0"), left: armX, top: 30 },
  ]).png().toBuffer();
}

describe("stationary garment appearance", () => {
  it("detects the off-white to white change that the 64-bin color histogram cannot see", async () => {
    expect(original.map((channel) => channel >> 6)).toEqual([255, 255, 255].map((channel) => channel >> 6));
    const reference = await stationaryBodyColors(await drawing(), body);
    const changed = await stationaryBodyColors(await drawing([255, 255, 255]), body);
    expect(reference[0]).toEqual(original);
    expect(stationaryColorsDiffer(changed, reference)).toBe(true);
  });

  it("ignores arm movement, background removal, thin linework and minor tonal noise", async () => {
    const reference = await stationaryBodyColors(await drawing(original, 40, "#ff00ff"), body);
    const unchanged = await stationaryBodyColors(await drawing(original, 115), body);
    const noise = await stationaryBodyColors(await drawing(original.map((channel) => channel + 6)), body);
    expect(stationaryColorsDiffer(unchanged, reference)).toBe(false);
    expect(stationaryColorsDiffer(noise, reference)).toBe(false);
  });

  it("uses body coordinates rather than image resolution", async () => {
    const png = await drawing();
    const enlarged = await sharp(png).resize(320, 512, { kernel: "nearest" }).png().toBuffer();
    expect(await stationaryBodyColors(enlarged, { centerX: 160, topY: 16, footY: 496 })).toEqual(await stationaryBodyColors(png, body));
  });

  it("does not turn missing or transparent samples into color errors", async () => {
    const empty = await sharp({ create: { width: 160, height: 256, channels: 4, background: "#00000000" } }).png().toBuffer();
    const colors = await stationaryBodyColors(empty, body);
    expect(colors).toEqual([null, null, null]);
    expect(stationaryColorsDiffer(colors, await stationaryBodyColors(await drawing(), body))).toBe(false);
    expect(await stationaryBodyColors(empty, { ...body, footY: body.topY })).toEqual([null, null, null]);
  });

  it("adds the existing color warning even when the global histogram is identical", async () => {
    const png = await drawing([255, 255, 255]);
    const histogram = Array<number>(64).fill(0); histogram[63] = 1;
    const entry: QcEntry = {
      frameId: "s2", label: "Wave", phase: "sample_2", scale: 1, sprite: png,
      measure: { rawWidth: 160, rawHeight: 256, crop: { left: 0, top: 0, width: 160, height: 256 }, topY: 8, footY: 248, torsoX: 80, lowerSpan: 30, coverage: 0.2, touchesEdge: false, histogram, method: "alpha", multiple: false, backgroundUniformity: 1 },
      stationaryColors: await stationaryBodyColors(png, body),
    };
    const reference = await stationaryBodyColors(await drawing(), body);
    const result = (await checkFrames([entry], histogram, "wave", "front", true, reference)).get("s2")!;
    expect(result.colorDistance).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["color_shift"]);
    // A dance or reference-video pose has no promise of a stationary torso.
    const moving = (await checkFrames([{ ...entry, stationaryColors: undefined }], histogram, "dance", "front", true, reference)).get("s2")!;
    expect(moving.warnings).toEqual([]);
  });
});
