import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientKey, guardAiRequest, guardUpload, readJsonBody, resetRateLimits, takeSlot } from "./guard";

const request = (headers: Record<string, string> = {}, body?: string) => new Request("http://focus.test/api", { method: "POST", headers, body });
const saved = { ...process.env };

beforeEach(() => {
  resetRateLimits();
  process.env.FOCUS_DATA_DIR = "/nonexistent-focus-test";
  process.env.FOCUS_SAM_DAILY_FRAMES = "0";
});

afterEach(() => {
  process.env = { ...saved };
});

describe("rate limits", () => {
  it("allows up to the limit per hour, then reports the wait", () => {
    const now = 1_000_000;
    expect(takeSlot("t", "a", 2, now)).toBeNull();
    expect(takeSlot("t", "a", 2, now + 1)).toBeNull();
    expect(takeSlot("t", "a", 2, now + 2)).toBe(3600);
    // Other clients are independent; the window slides.
    expect(takeSlot("t", "b", 2, now + 2)).toBeNull();
    expect(takeSlot("t", "a", 2, now + 3_600_001)).toBeNull();
  });

  it("only trusts X-Forwarded-For when configured", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4" }))).toBe("local");
    process.env.FOCUS_TRUST_PROXY = "1";
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("limits uploads per client", async () => {
    process.env.FOCUS_UPLOADS_PER_HOUR = "1";
    await guardUpload(request());
    await expect(guardUpload(request())).rejects.toMatchObject({ code: "rate_limited", status: 429 });
  });
});

describe("AI request guard", () => {
  it("honours the emergency switch", async () => {
    process.env.FOCUS_AI_DISABLED = "1";
    await expect(guardAiRequest(request(), { activeJobs: 0, estimatedFrames: 100 })).rejects.toMatchObject({ code: "ai_disabled", status: 503 });
  });

  it("caps concurrent jobs", async () => {
    process.env.FOCUS_MAX_ACTIVE_JOBS = "2";
    await expect(guardAiRequest(request(), { activeJobs: 2, estimatedFrames: 100 })).rejects.toMatchObject({ code: "busy" });
  });

  it("refuses work that would exceed the daily SAM budget", async () => {
    process.env.FOCUS_SAM_DAILY_FRAMES = "40";
    // Billed with a 50-frame minimum, so even a tiny clip exceeds a 40-frame budget.
    await expect(guardAiRequest(request(), { activeJobs: 0, estimatedFrames: 10 })).rejects.toMatchObject({ code: "budget_exhausted" });
  });

  it("rate-limits paid requests per client", async () => {
    process.env.FOCUS_AI_REQUESTS_PER_HOUR = "1";
    await guardAiRequest(request(), { activeJobs: 0, estimatedFrames: 10 });
    await expect(guardAiRequest(request(), { activeJobs: 0, estimatedFrames: 10 })).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("readJsonBody", () => {
  it("rejects oversized and malformed bodies", async () => {
    await expect(readJsonBody(request({}, "x".repeat(20_000)))).rejects.toMatchObject({ code: "body_too_large" });
    await expect(readJsonBody(request({}, "{nope"))).rejects.toMatchObject({ code: "invalid_json" });
    await expect(readJsonBody(request({}, '{"a":1}'))).resolves.toEqual({ a: 1 });
  });
});
