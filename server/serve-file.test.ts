import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { thumbUrl, thumbWidth } from "../shared/thumbs";
import { serveFile } from "./serve-file";

describe("thumbWidth", () => {
  it("snaps to the next step and caps at the largest", () => {
    expect(thumbWidth("100")).toBe(160);
    expect(thumbWidth(320)).toBe(320);
    expect(thumbWidth("321")).toBe(640);
    expect(thumbWidth("99999")).toBe(1280);
  });
  it("ignores missing or malformed widths", () => {
    expect(thumbWidth(null)).toBeUndefined();
    expect(thumbWidth("0")).toBeUndefined();
    expect(thumbWidth("12px")).toBeUndefined();
  });
  it("asks twice the CSS width, on either kind of URL", () => {
    expect(thumbUrl("/a?kind=frame", 128)).toBe("/a?kind=frame&w=320");
    expect(thumbUrl("/a", 48)).toBe("/a?w=160");
  });
});

describe("serveFile with a width", () => {
  let dir: string;
  let file: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "focus-thumb-"));
    file = path.join(dir, "frame.png");
    await sharp({ create: { width: 1200, height: 900, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }).png().toFile(file);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("sends a smaller WebP that keeps transparency, and 304 once the browser has it", async () => {
    const response = await serveFile(new Request("http://x/"), file, "image/png", undefined, { width: 320 });
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(meta.width).toBe(320);
    expect(meta.hasAlpha).toBe(true);
    const again = await serveFile(new Request("http://x/", { headers: { "if-none-match": response.headers.get("ETag")! } }), file, "image/png", undefined, { width: 320 });
    expect(again.status).toBe(304);
  });

  it("never enlarges, and downloads stay the original file", async () => {
    const big = await serveFile(new Request("http://x/"), file, "image/png", undefined, { width: 1280 });
    expect((await sharp(Buffer.from(await big.arrayBuffer())).metadata()).width).toBe(1200);
    const download = await serveFile(new Request("http://x/"), file, "image/png", "frame.png", { width: 320 });
    expect(download.headers.get("Content-Type")).toBe("image/png");
  });
});
