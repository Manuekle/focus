import { describe, expect, it } from "vitest";
import { RenderParamsSchema, applyParamsPatch, defaultParams, describeParamChanges, effectDefaults, rangeWeight } from "./render";
import type { EditPlan } from "./schemas";

const blur = RenderParamsSchema.parse({ effect: "background_blur", level: "low", finish: { look: "warm", grain: 0.3 } });

describe("parameter patches", () => {
  it("changes only what the patch names and clamps out-of-range numbers", () => {
    const next = applyParamsPatch(blur, { settings: { level: "high", feather: 99 }, finish: { vignette: 3 } });
    expect(next).toMatchObject({ effect: "background_blur", level: "high", feather: 4, finish: { look: "warm", grain: 0.3, vignette: 1 } });
  });

  it("switching effect starts from its defaults, keeps the finish, drops foreign knobs", () => {
    const next = applyParamsPatch(blur, { effect: "motion_echo", settings: { level: "high", trailCount: 12 } });
    expect(next).toMatchObject({ effect: "motion_echo", trailCount: 6, trailSpacingMs: 120, finish: { look: "warm" } });
    expect(next).not.toHaveProperty("level");
  });

  it("describes changes in short labels", () => {
    const next = applyParamsPatch(blur, { finish: { look: "cinematic", subject: "glow", accent: "gold", letterbox: true } });
    expect(describeParamChanges(blur, next)).toEqual(["Look: Cinematic", "Subject glow: gold", "Letterbox: on"]);
    expect(describeParamChanges(blur, blur)).toEqual([]);
  });

  it("plan finish becomes the first render's finish", () => {
    const plan: EditPlan = {
      supported: true,
      target: { concept: "dancer", selection: "single" },
      effect: "spotlight",
      parameters: { intensity: 0.9, finish: { look: "noir", grain: 0.5 } },
      needsClarification: false,
    };
    expect(defaultParams(plan)).toMatchObject({ effect: "spotlight", darkness: 0.9, finish: { look: "noir", grain: 0.5, subject: "none" } });
  });

  it("parameters saved before the finish existed still parse", () => {
    expect(RenderParamsSchema.parse({ effect: "selective_color", intensity: 1, feather: 1.5 }).finish).toMatchObject({ look: "natural", letterbox: false });
  });
});

describe("effect range", () => {
  it("weights frames: zero outside, ramps at inner edges, full at clip edges", () => {
    const range = { start: 1, end: 3 };
    expect(rangeWeight(0.5, range, 4)).toBe(0);
    expect(rangeWeight(1.125, range, 4)).toBeCloseTo(0.5);
    expect(rangeWeight(2, range, 4)).toBe(1);
    expect(rangeWeight(3, range, 4)).toBe(0);
    expect(rangeWeight(0, { start: 0, end: 2 }, 4)).toBe(1);
    expect(rangeWeight(2, undefined, 4)).toBe(1);
  });

  it("patches the range, clamped, and clears it for the whole clip", () => {
    const base = effectDefaults("spotlight");
    const ranged = applyParamsPatch(base, { range: { start: 2, end: 99 }, duration: 10 });
    expect(ranged.delivery.range).toEqual({ start: 2, end: 10 });
    expect(applyParamsPatch(ranged, { range: null, duration: 10 }).delivery.range).toBeUndefined();
    expect(applyParamsPatch(ranged, { range: { start: 0, end: 10 }, duration: 10 }).delivery.range).toBeUndefined();
    expect(applyParamsPatch(ranged, { settings: { darkness: 0.5 } }).delivery.range).toEqual({ start: 2, end: 10 });
  });
});

describe("pixelate params", () => {
  it("defaults to the subject, maps the plan and clamps patches", () => {
    expect(effectDefaults("pixelate")).toMatchObject({ effect: "pixelate", region: "subject", blockSize: 16 });
    const plan: EditPlan = { supported: true, target: { concept: "face", selection: "single" }, effect: "pixelate", parameters: { region: "background", blockSize: 32 }, needsClarification: false };
    expect(defaultParams(plan)).toMatchObject({ region: "background", blockSize: 32 });
    const patched = applyParamsPatch(effectDefaults("erase"), { effect: "pixelate", settings: { blockSize: 99 } });
    expect(patched).toMatchObject({ effect: "pixelate", blockSize: 48 });
    expect(describeParamChanges(effectDefaults("pixelate"), applyParamsPatch(effectDefaults("pixelate"), { settings: { region: "background" } }))).toContain("Pixelate: the background");
  });
});
