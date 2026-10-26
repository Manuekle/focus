import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import type { Probe } from "./ffmpeg";
import { describeSource, normalizedDimensions, parseRate } from "./media-validation";
import { parseRange } from "./http-range";

function probeOf(overrides: { video?: Record<string, unknown>; format?: Record<string, unknown>; audio?: boolean } = {}): Probe {
  return {
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", ...overrides.video },
      ...(overrides.audio ? [{ codec_type: "audio", codec_name: "aac" }] : []),
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "8.5", ...overrides.format },
  } as Probe;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : "other";
  }
  return undefined;
}

describe("describeSource", () => {
  it("accepts a short landscape MP4", () => {
    const media = describeSource(probeOf({ audio: true }), 1234);
    expect(media).toMatchObject({ width: 1920, height: 1080, rotation: 0, hasAudio: true, container: "mov" });
    expect(media.fps).toBeCloseTo(29.97, 2);
  });

  it("swaps dimensions for rotated phone footage", () => {
    const media = describeSource(probeOf({ video: { side_data_list: [{ rotation: -90 }] } }), 1);
    expect([media.width, media.height]).toEqual([1080, 1920]);
  });

  it("rejects videos longer than the limit", () => {
    expect(codeOf(() => describeSource(probeOf({ format: { duration: "12.4" } }), 1))).toBe("duration_too_long");
  });

  it("tolerates container rounding at the limit", () => {
    expect(codeOf(() => describeSource(probeOf({ format: { duration: "10.04" } }), 1))).toBeUndefined();
  });

  it("rejects non-MP4/MOV containers", () => {
    expect(codeOf(() => describeSource(probeOf({ format: { format_name: "matroska,webm" } }), 1))).toBe("unsupported_container");
  });

  it("rejects files without a video stream", () => {
    const probe = { streams: [{ codec_type: "audio" }], format: { format_name: "mov,mp4", duration: "3" } } as Probe;
    expect(codeOf(() => describeSource(probe, 1))).toBe("no_video_stream");
  });

  it("rejects oversize resolutions", () => {
    expect(codeOf(() => describeSource(probeOf({ video: { width: 8192, height: 4320 } }), 1))).toBe("resolution_too_large");
  });
});

describe("normalizedDimensions", () => {
  it("fits 4K landscape inside 1280×720", () => {
    expect(normalizedDimensions(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });
  it("fits portrait inside 720×1280", () => {
    expect(normalizedDimensions(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });
  it("never upscales and keeps even sizes", () => {
    expect(normalizedDimensions(641, 361)).toEqual({ width: 642, height: 362 });
    expect(normalizedDimensions(320, 240)).toEqual({ width: 320, height: 240 });
  });
});

describe("parseRate", () => {
  it("parses fractions and integers", () => {
    expect(parseRate("24/1")).toBe(24);
    expect(parseRate("0/0")).toBe(0);
    expect(parseRate(undefined)).toBe(0);
  });
});

describe("parseRange", () => {
  it("handles open, closed and suffix ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=200-", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
  });
});
