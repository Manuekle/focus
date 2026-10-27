import { afterEach, describe, expect, it, vi } from "vitest";

// The server enforces FOCUS_MAX_VIDEO_DURATION_SECONDS / FOCUS_MAX_UPLOAD_MB
// from its own environment, read when the module loads.

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./media-limits");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("server upload limits", () => {
  it("use the configured values", async () => {
    const limits = await load({ FOCUS_MAX_VIDEO_DURATION_SECONDS: "30", FOCUS_MAX_UPLOAD_MB: "200" });
    expect(limits.SERVER_MAX_DURATION_SECONDS).toBe(30);
    expect(limits.SERVER_MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024);
  });

  it("default to 60 s and 150 MB for missing or invalid values", async () => {
    const limits = await load({ FOCUS_MAX_VIDEO_DURATION_SECONDS: "sixty", FOCUS_MAX_UPLOAD_MB: "0" });
    expect(limits.SERVER_MAX_DURATION_SECONDS).toBe(60);
    expect(limits.SERVER_MAX_UPLOAD_BYTES).toBe(150 * 1024 * 1024);
  });

  it("drive the duration check", async () => {
    vi.resetModules();
    vi.stubEnv("FOCUS_MAX_VIDEO_DURATION_SECONDS", "30");
    const { describeSource } = await import("./media-validation");
    const probe = (duration: string) => ({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "24/1" }], format: { format_name: "mov,mp4", duration } });
    expect(describeSource(probe("30"), 1).durationSeconds).toBe(30);
    expect(() => describeSource(probe("31"), 1)).toThrow(/30 s/);
  });
});
