import { describe, expect, it } from "vitest";
import { clientToSource, frameIndexAt } from "./coords";

describe("clientToSource", () => {
  const media = { width: 1280, height: 720 };

  it("maps a scaled view back to source pixels", () => {
    const rect = { left: 100, top: 50, width: 640, height: 360 };
    expect(clientToSource(100, 50, rect, media)).toEqual({ x: 0, y: 0 });
    expect(clientToSource(420, 230, rect, media)).toEqual({ x: 640, y: 360 });
    expect(clientToSource(739.9, 409.9, rect, media)).toEqual({ x: 1279, y: 719 });
  });

  it("accounts for letterboxing with object-fit: contain", () => {
    // A 16:9 video inside a square box: bars of 100px above and below.
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    const wide = { width: 1600, height: 800 };
    expect(clientToSource(200, 50, rect, wide)).toBeNull();
    expect(clientToSource(0, 100, rect, wide)).toEqual({ x: 0, y: 0 });
    expect(clientToSource(200, 200, rect, wide)).toEqual({ x: 800, y: 400 });
  });

  it("handles portrait media pillarboxed in a landscape box", () => {
    const rect = { left: 0, top: 0, width: 800, height: 400 };
    const portrait = { width: 720, height: 1280 };
    expect(clientToSource(100, 200, rect, portrait)).toBeNull();
    expect(clientToSource(400, 200, rect, portrait)).toEqual({ x: 360, y: 640 });
  });

  it("stretches with object-fit: fill", () => {
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    expect(clientToSource(200, 100, rect, media, "fill")).toEqual({ x: 640, y: 180 });
  });

  it("rejects points outside the element", () => {
    expect(clientToSource(-1, 10, { left: 0, top: 0, width: 100, height: 100 }, media, "fill")).toBeNull();
  });
});

describe("frameIndexAt", () => {
  it("returns the frame on screen for a media time", () => {
    expect(frameIndexAt(0, 24, 96)).toBe(0);
    expect(frameIndexAt(10 / 24, 24, 96)).toBe(10);
    expect(frameIndexAt(10.5 / 24, 24, 96)).toBe(10);
    expect(frameIndexAt(0.4166666, 24, 96)).toBe(10);
    expect(frameIndexAt(99, 24, 96)).toBe(95);
  });
});
