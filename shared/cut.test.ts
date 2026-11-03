import { describe, expect, it } from "vitest";
import { CutRequestSchema, isWhole, keptSeconds, normalizeCut, playableTime, removeSegment, segmentAt, splitAt, trimEdge, wholeClip } from "./cut";

describe("cut list", () => {
  it("splits the part under the playhead and refuses edges", () => {
    const parts = splitAt(wholeClip(10), 4);
    expect(parts).toEqual([{ start: 0, end: 4 }, { start: 4, end: 10 }]);
    expect(splitAt(parts, 4.01)).toEqual(parts);
    expect(splitAt(parts, 0.02)).toEqual(parts);
  });

  it("removes a part but never the last one", () => {
    const parts = splitAt(splitAt(wholeClip(10), 4), 6);
    expect(removeSegment(parts, 1)).toEqual([{ start: 0, end: 4 }, { start: 6, end: 10 }]);
    expect(removeSegment(wholeClip(10), 0)).toEqual(wholeClip(10));
  });

  it("trims within neighbours and the minimum length", () => {
    const parts = [{ start: 0, end: 4 }, { start: 6, end: 10 }];
    expect(trimEdge(parts, 1, "start", 3, 10)[1].start).toBe(4);
    expect(trimEdge(parts, 0, "end", -1, 10)[0].end).toBeCloseTo(0.08);
    expect(trimEdge(parts, 1, "end", 12, 10)[1].end).toBe(10);
  });

  it("knows whole clips and kept time", () => {
    expect(isWhole(wholeClip(10), 10)).toBe(true);
    expect(isWhole([{ start: 1, end: 10 }], 10)).toBe(false);
    expect(isWhole(splitAt(wholeClip(10), 4), 10)).toBe(true);
    expect(isWhole([{ start: 0, end: 4 }, { start: 5, end: 10 }], 10)).toBe(false);
    expect(keptSeconds([{ start: 0, end: 4 }, { start: 6, end: 10 }])).toBe(8);
  });

  it("jumps playback over gaps and wraps at the end", () => {
    const parts = [{ start: 1, end: 4 }, { start: 6, end: 9 }];
    expect(playableTime(parts, 2)).toBe(2);
    expect(playableTime(parts, 5)).toBe(6);
    expect(playableTime(parts, 9.5)).toBe(1);
    expect(segmentAt(parts, 4)).toBe(-1);
  });

  it("normalizes overlapping and out-of-range parts", () => {
    expect(normalizeCut([{ start: 5, end: 12 }, { start: -1, end: 2 }, { start: 1.5, end: 3 }], 10)).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }]);
  });

  it("validates requests", () => {
    expect(CutRequestSchema.safeParse({ keep: [] }).success).toBe(false);
    expect(CutRequestSchema.safeParse({ keep: [{ start: 1, end: 1.01 }] }).success).toBe(false);
    expect(CutRequestSchema.safeParse({ keep: [{ start: 0, end: 3 }] }).success).toBe(true);
  });
});
