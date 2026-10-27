import { describe, expect, it } from "vitest";
import { MIN_EVENT_CONFIDENCE, TemporalSuggestionSchema, suggestTemporalEvent } from "./temporal-events";
import type { TrackPoint } from "./temporal-track";
import { triggerFrame } from "./temporal";

const media = { fps: 24, frameCount: 97 };

function track(center: (frame: number) => { x?: number; y: number }, options: { fps?: number; frames?: number; scale?: number; confidence?: number | null } = {}): TrackPoint[] {
  const { fps = 24, frames = 97, scale = 1, confidence = 0.9 } = options;
  return Array.from({ length: frames }, (_, frameIndex) => {
    const { x = 200, y } = center(frameIndex);
    return {
      frameIndex, timestamp: frameIndex / fps,
      box: { left: (x - 40) * scale, top: (y - 60) * scale, right: (x + 40) * scale, bottom: (y + 60) * scale },
      center: { x: x * scale, y: y * scale }, width: 80 * scale, height: 120 * scale,
      masked: true, confidence,
    };
  });
}

// Subject moves up, then back down. Image y increases downward.
const jump = (frame: number) => ({ y: 300 - 90 * Math.max(0, 1 - ((frame - 48) / 24) ** 2) });
const runner = (frame: number) => ({ x: 100 + frame * 10, y: 300 });

describe("jump apex suggestion", () => {
  it("finds the highest center after a clear rise and before a clear fall", () => {
    const suggestion = suggestTemporalEvent(track(jump), "jump_apex", media)!;
    expect(suggestion).not.toBeNull();
    expect(suggestion.event).toBe("jump_apex");
    expect(suggestion.frameIndex).toBeCloseTo(48, 0);
    expect(suggestion.timestampMs).toBeCloseTo(2000, 0);
    expect(suggestion.confidence).toBeGreaterThanOrEqual(MIN_EVENT_CONFIDENCE);
    expect(suggestion.reason).toMatch(/Suggested jump apex.*rises.*falls.*tracked movement/);
    expect(TemporalSuggestionSchema.safeParse(suggestion).success).toBe(true);
  });

  it.each([0.25, 2, 8])("normalizes evidence by subject height at scale %s", (scale) => {
    const suggestion = suggestTemporalEvent(track(jump, { scale }), "jump_apex", media)!;
    expect(suggestion.frameIndex).toBe(48);
    expect(suggestion.confidence).toBeCloseTo(0.9);
  });

  it("rejects stationary tracks, jitter, and upward or downward movement without both shoulders", () => {
    for (const center of [() => ({ y: 300 }), (i: number) => ({ y: 300 + (i % 2) }), (i: number) => ({ y: 300 - i * 2 }), (i: number) => ({ y: 100 + i * 2 })]) {
      expect(suggestTemporalEvent(track(center), "jump_apex", media)).toBeNull();
    }
  });

  it("requires enough height-relative evidence, including on the weaker shoulder", () => {
    const tinyJump = track((i) => ({ y: 300 - (300 - jump(i).y) / 10 }));
    const oneShoulder = track((i) => ({ y: i <= 48 ? jump(i).y : 210 + Math.min(i - 48, 24) * 0.5 }));
    expect(suggestTemporalEvent(tinyJump, "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(oneShoulder, "jump_apex", media)).toBeNull();
    // 20% rise/fall clears the minimum geometry gate but confidence is still low.
    expect(suggestTemporalEvent(track((i) => ({ y: 300 - (300 - jump(i).y) * 24 / 90 })), "jump_apex", media)).toBeNull();
  });

  it("tolerates small box jitter and chooses the middle of a flat apex", () => {
    const jittered = suggestTemporalEvent(track((i) => ({ y: jump(i).y + Math.sin(i * 5) })), "jump_apex", media)!;
    expect(Math.abs(jittered.frameIndex - 48)).toBeLessThanOrEqual(2);
    const flat = track((i) => ({ y: i < 44 ? 210 + (44 - i) * 3 : i <= 52 ? 210 : 210 + (i - 52) * 3 }));
    expect(suggestTemporalEvent(flat, "jump_apex", media)?.frameIndex).toBe(48);
  });

  it("chooses the highest supported apex when the clip contains multiple jumps", () => {
    const points = track((i) => i < 96 ? jump(i) : { y: 220 - 50 * Math.max(0, 1 - ((i - 144) / 20) ** 2) }, { frames: 193 });
    expect(suggestTemporalEvent(points, "jump_apex", { ...media, frameCount: 193 })?.frameIndex).toBe(144);
  });

  it("does not bridge gaps or unreliable masks around the apex", () => {
    const full = track(jump);
    expect(suggestTemporalEvent(full.filter((p) => p.frameIndex !== 48), "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(full.map((p) => p.frameIndex === 48 ? { ...p, masked: false } : p), "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(full.map((p) => p.frameIndex === 48 ? { ...p, confidence: 0.1 } : p), "jump_apex", media)).toBeNull();
  });

  it("does not mistake a one-frame spike or a teleport for a jump", () => {
    expect(suggestTemporalEvent(track((i) => ({ y: i === 48 ? 210 : 300 })), "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(track((i) => ({ y: i < 36 || i >= 60 ? 400 : 100 })), "jump_apex", media)).toBeNull();
  });
});

describe("peak motion suggestion", () => {
  it("finds the fastest sustained period from consecutive frames", () => {
    const movement = track((i) => ({ x: 100 + i + (i <= 36 ? 0 : i < 60 ? (i - 36) * 10 : 240), y: 300 }));
    const suggestion = suggestTemporalEvent(movement, "peak_motion", media)!;
    expect(suggestion.frameIndex).toBeGreaterThan(36);
    expect(suggestion.frameIndex).toBeLessThan(60);
    expect(suggestion.confidence).toBeGreaterThanOrEqual(MIN_EVENT_CONFIDENCE);
    expect(suggestion.reason).toMatch(/Suggested peak motion.*diagonal per frame.*tracked movement/);
  });

  it("uses a central point for constant lateral movement, including near clip boundaries", () => {
    const suggestion = suggestTemporalEvent(track(runner), "peak_motion", media)!;
    expect(Math.abs(suggestion.frameIndex - 48)).toBeLessThanOrEqual(1);
    expect(triggerFrame(suggestion.timestampMs, media)).toBe(suggestion.frameIndex);
    expect(suggestion.timestampMs).toBeLessThan(media.frameCount / media.fps * 1000);
  });

  it.each([0.25, 2, 8])("normalizes displacement by subject size at scale %s", (scale) => {
    const suggestion = suggestTemporalEvent(track(runner, { scale }), "peak_motion", media)!;
    expect(suggestion.frameIndex).toBe(suggestTemporalEvent(track(runner), "peak_motion", media)?.frameIndex);
    expect(suggestion.confidence).toBeCloseTo(0.9);
  });

  it("rejects weak movement, single-frame outliers and low tracking confidence", () => {
    expect(suggestTemporalEvent(track(() => ({ y: 300 })), "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(track((i) => ({ x: 200 + i, y: 300 })), "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(track((i) => ({ x: i === 48 ? 280 : 200, y: 300 })), "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(track(runner, { confidence: 0.6 }), "peak_motion", media)).toBeNull();
  });

  it("does not suggest peak motion from persistent box jitter without meaningful displacement", () => {
    expect(suggestTemporalEvent(track((i) => ({ x: 200 + (i % 2 ? 3 : -3), y: 300 })), "peak_motion", media)).toBeNull();
  });

  it("never counts a gap or identity/size discontinuity as maximum displacement", () => {
    const gapped = track((i) => ({ x: i < 48 ? 100 : 900, y: 300 })).filter((p) => p.frameIndex !== 48);
    const resized = track(() => ({ y: 300 })).map((p) => p.frameIndex === 48 ? { ...p, width: p.width * 4, center: { x: 600, y: 300 } } : p);
    expect(suggestTemporalEvent(gapped, "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(resized, "peak_motion", media)).toBeNull();
  });
});

describe("temporal suggestion clock and input", () => {
  it.each([12, 24, 48, 60])("keeps time and strength consistent at %s fps", (fps) => {
    const frames = fps * 4 + 1;
    const points = track((i) => jump(i * 24 / fps), { fps, frames });
    const suggestion = suggestTemporalEvent(points, "jump_apex", { fps, frameCount: frames })!;
    expect(Math.abs(suggestion.timestampMs - 2000)).toBeLessThanOrEqual(1000 / fps);
    const lateral = track((i) => runner(i * 24 / fps), { fps, frames });
    expect(suggestTemporalEvent(lateral, "peak_motion", { fps, frameCount: frames })?.confidence).toBeCloseTo(0.9);
  });

  it("derives the timestamp from the source frame, never an arbitrary stored time", () => {
    const points = track(jump).map((p) => ({ ...p, timestamp: 9999 }));
    expect(suggestTemporalEvent(points, "jump_apex", media)?.timestampMs).toBe(2000);
  });

  it("returns null for short, missing or unusable tracking and invalid media", () => {
    expect(suggestTemporalEvent([], "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(track(jump).slice(45, 50), "jump_apex", media)).toBeNull();
    expect(suggestTemporalEvent(track(runner).map((p) => ({ ...p, width: 0 })), "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(track(runner).map((p) => ({ ...p, center: { x: NaN, y: 0 } })), "peak_motion", media)).toBeNull();
    expect(suggestTemporalEvent(track(jump), "jump_apex", { ...media, fps: 0 })).toBeNull();
  });

  it("does not mutate cached tracking, and remains conservative without reported SAM confidence", () => {
    const points = track(jump, { confidence: null });
    const before = structuredClone(points);
    expect(suggestTemporalEvent(points, "jump_apex", media)?.confidence).toBeCloseTo(0.75);
    expect(points).toEqual(before);
  });
});
