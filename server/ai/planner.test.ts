import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { AppError } from "../errors";
import { Limiter, metaError, readMetaConfig, withRetry } from "./meta";
import { PLAN_JSON_SCHEMA, parsePlanOutput } from "./planner";

const plan = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    supported: true,
    unsupportedReason: null,
    target: { concept: "Skateboarder", selection: "single", description: null },
    effect: "selective_color",
    parameters: { intensity: 0.8, trailCount: null, trailSpacingMs: null },
    needsClarification: false,
    clarificationQuestion: null,
    ...overrides,
  });

describe("parsePlanOutput", () => {
  it("accepts a valid plan, strips nulls and normalizes the concept", () => {
    const result = parsePlanOutput(plan(), { effect: "reality-shift" });
    expect(result).toEqual({
      supported: true,
      target: { concept: "skateboarder", selection: "single" },
      effect: "selective_color",
      parameters: { intensity: 0.8 },
      needsClarification: false,
    });
  });

  it("keeps an unsupported verdict with its reason", () => {
    const result = parsePlanOutput(plan({ supported: false, unsupportedReason: "No podemos borrar objetos." }), { effect: "reality-shift" });
    expect(result.supported).toBe(false);
    expect(result.unsupportedReason).toBe("No podemos borrar objetos.");
  });

  it("forces the effect into the family the user picked", () => {
    expect(parsePlanOutput(plan({ effect: "motion_echo" }), { effect: "break-the-frame" }).effect).toBe("break_frame");
    expect(parsePlanOutput(plan({ effect: "background_blur" }), { effect: "reality-shift" }).effect).toBe("background_blur");
  });

  it("drops trail parameters outside motion echo", () => {
    const result = parsePlanOutput(plan({ parameters: { intensity: 0.5, trailCount: 4, trailSpacingMs: 120 } }), { effect: "reality-shift" });
    expect(result.parameters).toEqual({ intensity: 0.5 });
    const echo = parsePlanOutput(plan({ effect: "motion_echo", parameters: { intensity: null, trailCount: 4, trailSpacingMs: 120 } }), { effect: "motion-echo" });
    expect(echo.parameters).toEqual({ trailCount: 4, trailSpacingMs: 120 });
  });

  it.each([
    ["a command instead of a noun phrase", { target: { concept: "segment the car; then blur the background", selection: "single", description: null } }],
    ["a shell-like concept", { target: { concept: "$(rm -rf /)", selection: "single", description: null } }],
    ["an overlong phrase", { target: { concept: "the very tall man in the red coat on the left", selection: "single", description: null } }],
    ["out-of-range intensity", { parameters: { intensity: 4, trailCount: null, trailSpacingMs: null } }],
    ["an unknown effect", { effect: "remove_object" }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => parsePlanOutput(plan(overrides), { effect: "reality-shift" })).toThrowError(AppError);
  });

  it("rejects non-JSON output", () => {
    expect(() => parsePlanOutput("Sure! Here is your plan", { effect: "reality-shift" })).toThrowError(/ilegible/);
  });

  it("ships a strict schema the API accepts: every property required, no extra keys", () => {
    const check = (node: Record<string, unknown>) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
        for (const child of Object.values(node.properties as Record<string, Record<string, unknown>>)) check(child);
      }
    };
    check(PLAN_JSON_SCHEMA as unknown as Record<string, unknown>);
  });
});

describe("Meta client helpers", () => {
  const rateLimited = () => new OpenAI.RateLimitError(429, undefined, "slow down", new Headers());

  it("retries transient failures a bounded number of times", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw rateLimited();
      return "ok";
    }, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw rateLimited();
    }, { attempts: 2, baseDelayMs: 1 })).rejects.toBeInstanceOf(OpenAI.RateLimitError);
    expect(calls).toBe(2);
  });

  it("never retries a client error", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new OpenAI.BadRequestError(400, undefined, "bad prompt", new Headers());
    }, { baseDelayMs: 1 })).rejects.toBeInstanceOf(OpenAI.BadRequestError);
    expect(calls).toBe(1);
  });

  it("stops before retrying once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withRetry(async () => "never", { signal: controller.signal })).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
  });

  it("maps API errors to actionable messages", () => {
    expect(metaError(new OpenAI.AuthenticationError(401, undefined, "no", new Headers()), "x").code).toBe("meta_unauthorized");
    expect(metaError(rateLimited(), "x").code).toBe("meta_rate_limited");
    expect(metaError(new OpenAI.APIUserAbortError(), "x").code).toBe("canceled");
  });

  it("limits concurrency", async () => {
    const limiter = new Limiter(1);
    let active = 0;
    let peak = 0;
    const task = () => limiter.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });

  it("reads MODEL_API_KEY, falling back to META_API_KEY", () => {
    expect(readMetaConfig({ MODEL_API_KEY: "a", META_API_KEY: "b" })?.apiKey).toBe("a");
    expect(readMetaConfig({ META_API_KEY: "b" })?.apiKey).toBe("b");
    expect(readMetaConfig({})).toBeNull();
  });
});
