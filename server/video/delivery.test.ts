import { describe, expect, it } from "vitest";
import { DeliverySchema } from "../../shared/render";
import { createDeliverer, cropSize, titleOpacity, wrapTitle } from "./delivery";

const frame = (width: number, height: number, value = 40) => Buffer.alloc(width * height * 4, value);
const plain = DeliverySchema.parse({});

describe("cropSize", () => {
  it("keeps the source for the original format", () => {
    expect(cropSize(1920, 1080, "original")).toEqual({ width: 1920, height: 1080 });
  });
  it("crops landscape to 9:16 and portrait to 16:9, with even sides", () => {
    expect(cropSize(1920, 1080, "9:16")).toEqual({ width: 608, height: 1080 });
    expect(cropSize(1080, 1920, "16:9")).toEqual({ width: 1080, height: 608 });
    expect(cropSize(1920, 1080, "16:9")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("titles", () => {
  it("fades in and out inside the window only", () => {
    expect(titleOpacity(0.5, 1, 3)).toBe(0);
    expect(titleOpacity(3, 1, 3)).toBe(0);
    expect(titleOpacity(2, 1, 3)).toBe(1);
    expect(titleOpacity(1.1, 1, 3)).toBeGreaterThan(0);
    expect(titleOpacity(1.1, 1, 3)).toBeLessThan(1);
  });
  it("wraps by width and honors manual breaks", () => {
    expect(wrapTitle("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrapTitle("a\nb", 20)).toEqual(["a", "b"]);
  });
  it("draws only while the title is on screen", async () => {
    const delivery = DeliverySchema.parse({ titles: [{ id: "t", text: "Hello", start: 1, end: 3, position: "center", size: "large", color: "white", style: "plain" }] });
    const deliverer = await createDeliverer({ width: 640, height: 360, fps: 10 }, delivery);
    const before = deliverer.titles(0, frame(640, 360));
    const during = deliverer.titles(20, frame(640, 360));
    expect(before.equals(frame(640, 360))).toBe(true);
    expect(during.equals(frame(640, 360))).toBe(false);
  });
  it("escapes markup in the text", async () => {
    const delivery = DeliverySchema.parse({ titles: [{ id: "t", text: "<b>&</b>", start: 0, end: 2 }] });
    await expect(createDeliverer({ width: 320, height: 180, fps: 10 }, delivery)).resolves.toBeDefined();
  });
});

describe("crop", () => {
  it("passes frames through untouched when nothing changes", async () => {
    const deliverer = await createDeliverer({ width: 64, height: 36, fps: 10 }, plain);
    const rgba = frame(64, 36);
    expect(deliverer.crop(rgba, null).rgba).toBe(rgba);
    expect(deliverer.follows).toBe(false);
  });
  it("centers the window and follows the subject", async () => {
    const width = 160;
    const height = 90;
    const deliverer = await createDeliverer({ width, height, fps: 10 }, DeliverySchema.parse({ aspect: "9:16" }));
    expect(deliverer.width).toBe(50);
    expect(deliverer.height).toBe(90);
    // A red subject at the right edge of the frame.
    const rgba = frame(width, height, 0);
    const alpha = new Uint8Array(width * height);
    for (let y = 30; y < 60; y++) for (let x = 130; x < 150; x++) { alpha[y * width + x] = 255; rgba[(y * width + x) * 4] = 255; }
    let last = deliverer.crop(rgba, alpha);
    for (let i = 0; i < 60; i++) last = deliverer.crop(rgba, alpha);
    const red = (last.rgba as Buffer).filter((_, i) => i % 4 === 0 && last.rgba[i] === 255).length;
    expect(red).toBeGreaterThan(300);
    expect(last.alpha?.some((value) => value === 255)).toBe(true);
  });
  it("centers when told not to follow", async () => {
    const deliverer = await createDeliverer({ width: 160, height: 90, fps: 10 }, DeliverySchema.parse({ aspect: "9:16", follow: false }));
    const rgba = frame(160, 90, 0);
    for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) rgba[(y * 160 + x) * 4] = x < 80 ? 10 : 200;
    const out = deliverer.crop(rgba, null).rgba;
    expect(out[0]).toBe(10);
    expect(out[(deliverer.width - 1) * 4]).toBe(200);
  });
});
