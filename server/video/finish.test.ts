import { describe, expect, it } from "vitest";
import { FinishSchema } from "../../shared/render";
import { createFinisher, letterboxHeight, vignetteMap } from "./finish";

const W = 64;
const H = 36;

function solid(r: number, g: number, b: number): Buffer {
  const frame = Buffer.alloc(W * H * 4);
  for (let p = 0; p < frame.length; p += 4) {
    frame[p] = r;
    frame[p + 1] = g;
    frame[p + 2] = b;
    frame[p + 3] = 255;
  }
  return frame;
}
const at = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

describe("finish", () => {
  it("costs nothing when it changes nothing", () => {
    expect(createFinisher(W, H, FinishSchema.parse({}))).toBeNull();
  });

  it("cinematic pushes shadows teal and highlights orange", async () => {
    const finisher = createFinisher(W, H, FinishSchema.parse({ look: "cinematic" }))!;
    const [r1, , b1] = at(await finisher.apply(0, solid(40, 40, 40), null), 0, 0);
    expect(b1).toBeGreaterThan(r1);
    const [r2, , b2] = at(await finisher.apply(0, solid(220, 220, 220), null), 0, 0);
    expect(r2).toBeGreaterThan(b2);
  });

  it("noir removes color", async () => {
    const finisher = createFinisher(W, H, FinishSchema.parse({ look: "noir" }))!;
    const [r, g, b] = at(await finisher.apply(0, solid(200, 40, 40), null), 3, 3);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
  });

  it("vignette darkens corners, not the center", () => {
    const map = vignetteMap(W, H, 1);
    expect(map[Math.floor(H / 2) * W + Math.floor(W / 2)]).toBe(255);
    expect(map[0]).toBeLessThan(80);
  });

  it("grain is deterministic per frame and differs between frames", async () => {
    const finisher = createFinisher(W, H, FinishSchema.parse({ grain: 1 }))!;
    const a = await finisher.apply(5, solid(128, 128, 128), null);
    const b = await finisher.apply(5, solid(128, 128, 128), null);
    const c = await finisher.apply(6, solid(128, 128, 128), null);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("outline draws just outside the subject and leaves the subject alone", async () => {
    const alpha = new Uint8Array(W * H);
    for (let y = 10; y < 26; y++) alpha.fill(255, y * W + 20, y * W + 40);
    const finisher = createFinisher(W, H, FinishSchema.parse({ subject: "outline", accent: "cyan", accentStrength: 1 }))!;
    const out = await finisher.apply(0, solid(20, 20, 20), alpha);
    expect(at(out, 30, 18)).toEqual([20, 20, 20]);
    const edge = at(out, 41, 18);
    expect(edge[2]).toBeGreaterThan(120);
    expect(at(out, 2, 2)).toEqual([20, 20, 20]);
  });

  it("letterbox crops landscape to 2.39:1 and keeps a slim band on portrait", () => {
    expect(letterboxHeight(1280, 720)).toBe(92);
    expect(letterboxHeight(720, 1280)).toBe(77);
  });
});
