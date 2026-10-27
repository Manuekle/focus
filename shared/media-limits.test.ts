import { describe, expect, it } from "vitest";
import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, formatBytes } from "./media";
import { DEFAULT_MAX_UPLOAD_MB, DEFAULT_MAX_VIDEO_DURATION_SECONDS, mediaLimits, parseLimit } from "./media-limits";

describe("upload limits", () => {
  it("default to 60 seconds and 150 MB", () => {
    expect(mediaLimits({})).toEqual({ maxDurationSeconds: 60, maxUploadMb: 150 });
    expect(DEFAULT_MAX_VIDEO_DURATION_SECONDS).toBe(60);
    expect(DEFAULT_MAX_UPLOAD_MB).toBe(150);
  });

  it("take valid values from the environment", () => {
    expect(mediaLimits({ duration: "30", uploadMb: "200" })).toEqual({ maxDurationSeconds: 30, maxUploadMb: 200 });
    expect(mediaLimits({ duration: " 600 ", uploadMb: "1" })).toEqual({ maxDurationSeconds: 600, maxUploadMb: 1 });
  });

  it("fall back to the safe default for anything malformed or out of range", () => {
    for (const bad of ["", "abc", "0", "-5", "60.5", "1e3", "601", "Infinity"]) {
      expect(parseLimit(bad, 60, [1, 600])).toBe(60);
    }
    expect(mediaLimits({ uploadMb: "5000" }).maxUploadMb).toBe(150);
  });

  it("are what the app enforces when nothing is configured", () => {
    expect(MAX_DURATION_SECONDS).toBe(60);
    expect(MAX_UPLOAD_BYTES).toBe(150 * 1024 * 1024);
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("150 MB");
  });
});
