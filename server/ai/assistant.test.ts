import { describe, expect, it } from "vitest";
import { RenderParamsSchema, applyParamsPatch } from "../../shared/render";
import { assistantInstructions, assistantJsonSchema, parseAssistantOutput } from "./assistant";

const turn = (value: Record<string, unknown>) =>
  JSON.stringify({
    reply: "Done.",
    action: "adjust",
    effect: null,
    settings: { intensity: null, darkness: null, level: null, background: null, frameSize: null, trailCount: null, trailSpacingMs: null, feather: null },
    finish: { look: null, subject: null, accent: null, accentStrength: null, vignette: null, grain: null, letterbox: null },
    newInstruction: null,
    ...value,
  });

describe("AI editor output", () => {
  it("keeps only the knobs that change", () => {
    const parsed = parseAssistantOutput(turn({ finish: { look: "cinematic", subject: "glow", accent: "gold", accentStrength: null, vignette: 2, grain: null, letterbox: null } }));
    expect(parsed.action).toBe("adjust");
    expect(parsed.patch.finish).toEqual({ look: "cinematic", subject: "glow", accent: "gold", vignette: 1 });
    expect(parsed.patch.settings).toEqual({});
  });

  it("drops a single invalid finish value instead of failing the turn", () => {
    const parsed = parseAssistantOutput(turn({ finish: { look: "sepia", subject: null, accent: null, accentStrength: null, vignette: null, grain: 0.4, letterbox: null } }));
    expect(parsed.patch.finish).toEqual({ grain: 0.4 });
  });

  it("a new subject becomes a suggested instruction, never a patch", () => {
    const parsed = parseAssistantOutput(turn({ action: "new_edit", newInstruction: "Keep the dog in color", settings: { intensity: 1 } }));
    expect(parsed).toMatchObject({ action: "new_edit", newInstruction: "Keep the dog in color", patch: {} });
  });

  it("new_edit without an instruction is just a reply", () => {
    expect(parseAssistantOutput(turn({ action: "new_edit" })).action).toBe("none");
  });

  it("rejects unreadable output", () => {
    expect(() => parseAssistantOutput("not json")).toThrow();
  });
});

describe("AI editor on Time Freeze", () => {
  const frozen = RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1200 } });

  it("turns flat chat knobs into the nested temporal edit, clamped, never moving the freeze point", () => {
    const parsed = parseAssistantOutput(turn({ settings: { intensity: 0.5, darkness: null, level: null, background: null, frameSize: null, trailCount: null, trailSpacingMs: null, feather: null, echoCount: 9, echoSpacingMs: 250, freezeDurationMs: 2000 } }), { temporal: true });
    const next = applyParamsPatch(frozen, parsed.patch);
    expect(next).toMatchObject({ effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1200 }, freezeDurationMs: 2000, echo: { count: 6, spacingMs: 250, opacity: 0.5 } });
  });

  it("drops a switch to Time Freeze while temporal effects are disabled", () => {
    expect(parseAssistantOutput(turn({ effect: "time_freeze_echo" })).patch.effect).toBeUndefined();
    expect(parseAssistantOutput(turn({ effect: "time_freeze_echo" }), { temporal: true }).patch.effect).toBe("time_freeze_echo");
  });

  it("keeps the v1 request unchanged with the flag off", () => {
    expect(JSON.stringify(assistantJsonSchema(false))).not.toMatch(/time_freeze_echo|echoCount/);
    expect(assistantInstructions(false)).not.toMatch(/time_freeze/);
    expect(assistantInstructions(true)).toMatch(/drag the freeze marker/);
  });
});
