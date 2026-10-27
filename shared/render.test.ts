import { describe, expect, it } from "vitest";
import { RenderParamsSchema, applyParamsPatch, defaultParams, describeParamChanges } from "./render";
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
