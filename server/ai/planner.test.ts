import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { AppError } from "../errors";
import { Limiter, metaError, readMetaConfig, requireMetaConfig, withRetry } from "./meta";
import { defaultParams } from "../../shared/render";
import { PLAN_JSON_SCHEMA, parsePlanOutput, planJsonSchema, plannerInstructions } from "./planner";

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
    const result = parsePlanOutput(plan());
    expect(result).toEqual({
      supported: true,
      target: { concept: "skateboarder", selection: "single" },
      effect: "selective_color",
      parameters: { intensity: 0.8 },
      needsClarification: false,
    });
  });

  it("keeps an unsupported verdict with its reason", () => {
    const result = parsePlanOutput(plan({ supported: false, unsupportedReason: "No podemos borrar objetos." }));
    expect(result.supported).toBe(false);
    expect(result.unsupportedReason).toBe("No podemos borrar objetos.");
  });

  it("keeps an effect the instruction asked for, even outside the picked family", () => {
    expect(parsePlanOutput(plan({ effect: "background_blur" })).effect).toBe("background_blur");
    expect(parsePlanOutput(plan({ effect: "motion_echo" })).effect).toBe("motion_echo");
  });

  it("never asks which instance when every instance is wanted", () => {
    const both = parsePlanOutput(plan({ target: { concept: "person", selection: "all", description: null }, needsClarification: true, clarificationQuestion: "Which person?" }));
    expect(both.needsClarification).toBe(false);
    const unclear = parsePlanOutput(plan({ needsClarification: true, clarificationQuestion: "What should stand out?" }));
    expect(unclear.needsClarification).toBe(true);
  });

  it("drops trail parameters outside motion echo", () => {
    const result = parsePlanOutput(plan({ parameters: { intensity: 0.5, trailCount: 4, trailSpacingMs: 120 } }));
    expect(result.parameters).toEqual({ intensity: 0.5 });
    const echo = parsePlanOutput(plan({ effect: "motion_echo", parameters: { intensity: null, trailCount: 4, trailSpacingMs: 120 } }));
    expect(echo.parameters).toEqual({ trailCount: 4, trailSpacingMs: 120 });
  });

  it.each([
    ["a command instead of a noun phrase", { target: { concept: "segment the car; then blur the background", selection: "single", description: null } }],
    ["a shell-like concept", { target: { concept: "$(rm -rf /)", selection: "single", description: null } }],
    ["an overlong phrase", { target: { concept: "the very tall man in the red coat on the left", selection: "single", description: null } }],
    ["out-of-range intensity", { parameters: { intensity: 4, trailCount: null, trailSpacingMs: null } }],
    ["an unknown effect", { effect: "remove_object" }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => parsePlanOutput(plan(overrides))).toThrowError(AppError);
  });

  it("rejects non-JSON output", () => {
    expect(() => parsePlanOutput("Sure! Here is your plan")).toThrowError(/ilegible/);
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
    expect(metaError(new OpenAI.APIConnectionTimeoutError(), "x").code).toBe("meta_timeout");
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

  it("fails clearly when the server has no key", () => {
    const saved = { model: process.env.MODEL_API_KEY, meta: process.env.META_API_KEY };
    delete process.env.MODEL_API_KEY;
    delete process.env.META_API_KEY;
    try {
      expect(() => requireMetaConfig()).toThrowError(expect.objectContaining({ code: "meta_not_configured", status: 503 }));
    } finally {
      if (saved.model !== undefined) process.env.MODEL_API_KEY = saved.model;
      if (saved.meta !== undefined) process.env.META_API_KEY = saved.meta;
    }
  });

  it("reads MODEL_API_KEY, falling back to META_API_KEY", () => {
    expect(readMetaConfig({ MODEL_API_KEY: "a", META_API_KEY: "b" })?.apiKey).toBe("a");
    expect(readMetaConfig({ META_API_KEY: "b" })?.apiKey).toBe("b");
    expect(readMetaConfig({})).toBeNull();
  });
});

describe("temporal instructions", () => {
  // What Muse Spark returns for "Freeze time when I jump and create five copies of me."
  const freeze = (parameters: Record<string, unknown> = {}) =>
    plan({
      target: { concept: "person", selection: "single", description: null },
      effect: "time_freeze_echo",
      parameters: { intensity: null, trailCount: null, trailSpacingMs: null, finish: null, triggerEvent: "jump_apex", echoCount: 5, echoSpacingMs: null, freezeDurationMs: null, ...parameters },
    });

  it("interprets a freeze-on-jump instruction as a validated temporal plan", () => {
    const result = parsePlanOutput(freeze(), { temporal: true });
    expect(result).toEqual({
      supported: true,
      target: { concept: "person", selection: "single" },
      effect: "time_freeze_echo",
      parameters: { triggerEvent: "jump_apex", echoCount: 5 },
      needsClarification: false,
    });
    // The event becomes an automatic trigger with no timestamp: detection, not the model, finds the moment.
    expect(defaultParams(result)).toMatchObject({
      effect: "time_freeze_echo",
      trigger: { mode: "auto", event: "jump_apex" },
      freezeDurationMs: 1500,
      echo: { count: 5 },
      resume: true,
    });
    expect((defaultParams(result) as { trigger: { timestampMs?: number } }).trigger.timestampMs).toBeUndefined();
  });

  it("without a named moment the user places the freeze", () => {
    const result = parsePlanOutput(freeze({ triggerEvent: null }), { temporal: true });
    expect(defaultParams(result)).toMatchObject({ trigger: { mode: "manual" } });
  });

  it("clamps temporal numbers into range instead of failing", () => {
    const result = parsePlanOutput(freeze({ echoCount: 10, echoSpacingMs: 20, freezeDurationMs: 9000 }), { temporal: true });
    expect(result.parameters).toMatchObject({ echoCount: 6, echoSpacingMs: 80, freezeDurationMs: 3000 });
  });

  it("never accepts a timestamp from the model", () => {
    const result = parsePlanOutput(freeze({ timestampMs: 1234 }), { temporal: true });
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  it("rejects an unknown trigger event", () => {
    expect(() => parsePlanOutput(freeze({ triggerEvent: "backflip" }), { temporal: true })).toThrowError(AppError);
  });

  it("drops temporal knobs from other effects", () => {
    const echo = parsePlanOutput(plan({ effect: "motion_echo", parameters: { intensity: null, trailCount: 4, trailSpacingMs: 120, echoCount: 5, triggerEvent: "jump_apex" } }), { temporal: true });
    expect(echo.parameters).toEqual({ trailCount: 4, trailSpacingMs: 120 });
  });

  it("refuses Time Freeze while temporal effects are disabled", () => {
    expect(() => parsePlanOutput(freeze())).toThrowError(AppError);
  });

  it("keeps the v1 request unchanged with the flag off", () => {
    expect(planJsonSchema(false)).toEqual(PLAN_JSON_SCHEMA);
    expect(JSON.stringify(planJsonSchema(false))).not.toContain("time_freeze_echo");
    expect(plannerInstructions(false)).not.toMatch(/time_freeze|triggerEvent|time-freeze/);
    expect(plannerInstructions(true)).toMatch(/Never return a time, a frame number/);
  });

  it("ships a strict temporal schema", () => {
    const check = (node: Record<string, unknown>) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
        for (const child of Object.values(node.properties as Record<string, Record<string, unknown>>)) check(child);
      }
    };
    check(planJsonSchema(true) as unknown as Record<string, unknown>);
  });
});
