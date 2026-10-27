import { afterEach, describe, expect, it, vi } from "vitest";
import { effectEnabled } from "./features";
import { availableEffects } from "./pipeline";
import { RenderParamsSchema, applyParamsPatch, defaultParams, describeParamChanges, type RenderParamsOf } from "./render";
import { EditPlanSchema, TemporalEditSchema, parseTemporalEdit, temporalEditOf, type EditPlan } from "./schemas";
import { echoOpacity, echoReveal, freezeFrameCount, lastFrameMs, planFreeze, sourceFrameOf, triggerFrame, triggerProblem } from "./temporal";

const media = { fps: 24, frameCount: 96, durationSeconds: 4 };

const edit = {
  type: "time_freeze_echo",
  target: "person",
  trigger: { mode: "manual", timestampMs: 1500 },
  freezeDurationMs: 1500,
  echo: { count: 5, spacingMs: 120, opacity: 0.8 },
  resume: true,
} as const;

describe("temporal edit model", () => {
  it("accepts a well-formed edit", () => {
    expect(TemporalEditSchema.parse(edit)).toEqual(edit);
  });

  it.each([
    ["freeze shorter than 500 ms", { freezeDurationMs: 499 }],
    ["freeze longer than 3000 ms", { freezeDurationMs: 3001 }],
    ["fractional freeze", { freezeDurationMs: 1200.5 }],
    ["one echo", { echo: { ...edit.echo, count: 1 } }],
    ["seven echoes", { echo: { ...edit.echo, count: 7 } }],
    ["spacing below 80 ms", { echo: { ...edit.echo, spacingMs: 79 } }],
    ["spacing above 400 ms", { echo: { ...edit.echo, spacingMs: 401 } }],
    ["negative opacity", { echo: { ...edit.echo, opacity: -0.1 } }],
    ["opacity above 1", { echo: { ...edit.echo, opacity: 1.1 } }],
    ["negative timestamp", { trigger: { mode: "manual", timestampMs: -1 } }],
    ["auto trigger without an event", { trigger: { mode: "auto" } }],
    ["unknown event", { trigger: { mode: "auto", event: "backflip" } }],
    ["a sentence as target", { target: "freeze the person; rm -rf /" }],
    ["extra keys", { command: "ffmpeg -i x" }],
  ])("rejects %s", (_label, patch) => {
    expect(TemporalEditSchema.safeParse({ ...edit, ...patch }).success).toBe(false);
  });

  it("keeps the freeze point inside the clip", () => {
    expect(lastFrameMs(media)).toBe(3958);
    expect(parseTemporalEdit({ ...edit, trigger: { mode: "manual", timestampMs: 3958 } }, media).success).toBe(true);
    const late = parseTemporalEdit({ ...edit, trigger: { mode: "manual", timestampMs: 3959 } }, media);
    expect(late.success).toBe(false);
    expect(late.error?.issues[0].path).toEqual(["trigger", "timestampMs"]);
  });

  it("needs a manual timestamp, but lets detection fill an automatic one", () => {
    expect(triggerProblem({ mode: "manual" }, media)).toMatch(/freeze point/);
    expect(triggerProblem({ mode: "auto", event: "jump_apex" }, media)).toBeNull();
    expect(triggerProblem({ mode: "auto", event: "jump_apex", timestampMs: 5000 }, media)).toMatch(/past the end/);
  });

  it("maps time to frames of the normalized video", () => {
    expect(triggerFrame(0, media)).toBe(0);
    expect(triggerFrame(1000, media)).toBe(24);
    expect(triggerFrame(1020, media)).toBe(24);
    expect(triggerFrame(3958, media)).toBe(95);
    expect(triggerFrame(99_999, media)).toBe(95);
    expect(freezeFrameCount(1500, 24)).toBe(36);
    expect(freezeFrameCount(500, 24)).toBe(12);
  });
});

describe("time freeze render params", () => {
  it("fills defaults inside the bounds and waits for a freeze point", () => {
    const params = RenderParamsSchema.parse({ effect: "time_freeze_echo" });
    expect(params).toMatchObject({
      effect: "time_freeze_echo",
      trigger: { mode: "manual" },
      freezeDurationMs: 1500,
      echo: { count: 4, spacingMs: 160, opacity: 0.85 },
      resume: true,
      finish: { look: "natural" },
    });
    expect((params as RenderParamsOf<"time_freeze_echo">).trigger.timestampMs).toBeUndefined();
  });

  it("rejects out-of-range values instead of clamping them silently", () => {
    expect(RenderParamsSchema.safeParse({ effect: "time_freeze_echo", echo: { count: 9 } }).success).toBe(false);
    expect(RenderParamsSchema.safeParse({ effect: "time_freeze_echo", freezeDurationMs: 10_000 }).success).toBe(false);
  });

  it("converts to the structured temporal edit for the tracked target", () => {
    const params = RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1500 }, echo: { count: 5, spacingMs: 120, opacity: 0.8 } });
    expect(temporalEditOf(params as RenderParamsOf<"time_freeze_echo">, "person")).toEqual(edit);
  });

  it("a plan for the effect starts from its defaults", () => {
    const plan: EditPlan = EditPlanSchema.parse({
      supported: true,
      target: { concept: "person", selection: "single" },
      effect: "time_freeze_echo",
      parameters: {},
      needsClarification: false,
    });
    expect(defaultParams(plan)).toMatchObject({ effect: "time_freeze_echo", freezeDurationMs: 1500 });
  });

  it("describes changes in short labels", () => {
    const before = RenderParamsSchema.parse({ effect: "time_freeze_echo" });
    const after = RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1250 }, echo: { count: 6 } });
    expect(describeParamChanges(before, after)).toEqual(["Freeze point: 1.25 s", "Echoes: 6"]);
  });

  it("switching another effect to Time Freeze keeps the finish", () => {
    const blur = RenderParamsSchema.parse({ effect: "background_blur", finish: { look: "noir" } });
    expect(applyParamsPatch(blur, { effect: "time_freeze_echo" })).toMatchObject({ effect: "time_freeze_echo", finish: { look: "noir" } });
  });

  it("leaves v1 parameters untouched", () => {
    expect(RenderParamsSchema.parse({ effect: "motion_echo", trailCount: 3, trailSpacingMs: 120, intensity: 0.6, feather: 1.2 })).not.toHaveProperty("trigger");
  });
});

describe("release flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hides Time Freeze unless explicitly enabled; v1 effects are always on", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "");
    expect(effectEnabled("time-freeze")).toBe(false);
    expect(availableEffects().map((effect) => effect.id)).not.toContain("time-freeze");
    expect(effectEnabled("motion-echo")).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "1");
    expect(effectEnabled("time-freeze")).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS", "true");
    expect(effectEnabled("time-freeze")).toBe(true);
    expect(availableEffects().find((effect) => effect.id === "time-freeze")).toMatchObject({ name: "Time Freeze", summary: "Freeze a moment. Multiply the motion." });
  });
});

describe("freeze timeline", () => {
  const params = { trigger: { timestampMs: 1000 }, freezeDurationMs: 1000, echo: { count: 4, spacingMs: 160 }, resume: true };

  it("plays to the trigger, inserts the freeze, then resumes on the next frame", () => {
    const plan = planFreeze(params, media);
    expect(plan).toMatchObject({ triggerFrame: 24, freezeFrames: 24, spacingFrames: 4, requestedSamples: [8, 12, 16, 20], freezeStart: 25, outputFrameCount: 120 });
    expect([0, 24, 25, 48, 49, 119].map((index) => sourceFrameOf(index, plan))).toEqual([0, 24, "freeze", "freeze", 25, 95]);
  });

  it("ends on the hold when not resuming", () => {
    expect(planFreeze({ ...params, resume: false }, media).outputFrameCount).toBe(49);
  });

  it("keeps only echo moments inside the clip", () => {
    expect(planFreeze({ ...params, trigger: { timestampMs: 400 } }, media).requestedSamples).toEqual([2, 6]);
  });

  it("reveals echoes one by one, oldest first, and holds them all at the end", () => {
    const shown = (f: number) => [0, 1, 2, 3].map((rank) => echoReveal(f, rank, 4, 24, 24));
    expect(shown(0)[0]).toBeGreaterThan(0);
    expect(shown(0).slice(1)).toEqual([0, 0, 0]);
    for (let f = 1; f < 24; f++) for (let rank = 1; rank < 4; rank++) expect(shown(f)[rank]).toBeLessThanOrEqual(shown(f)[rank - 1]);
    expect(shown(23)).toEqual([1, 1, 1, 1]);
    expect(shown(Math.round(24 * 0.6))).toEqual([1, 1, 1, 1]);
  });

  it("fades older echoes", () => {
    expect([0, 1, 2, 3].map((rank) => echoOpacity(rank, 4, 0.8))).toEqual([0.4, expect.closeTo(0.5333, 3), expect.closeTo(0.6667, 3), 0.8]);
  });
});
