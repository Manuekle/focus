import { describe, expect, it } from "vitest";
import { GuideRequestSchema, guidedDrawings, guidedPrompt, guidedSequence } from "../../shared/flipbook-onboarding";
import { GUIDE_INSTRUCTIONS, guideJsonSchema, parseGuide } from "./onboarding";

const setup = { mode: "cycle", action: "walk", view: "front", direction: "in_place", durationSeconds: 4, drawingFps: 12, keepScene: true, instruction: "Walk in place, front view, a slow relaxed walk", summary: "Un paseo lento en bucle, 8 dibujos." };

describe("guided setup", () => {
  it("asks until it can decide, then returns every setting", () => {
    expect(parseGuide(JSON.stringify({ reply: "¿Camina hacia la cámara o en el sitio?", setup: null }), true)).toEqual({ reply: "¿Camina hacia la cámara o en el sitio?", setup: null });
    expect(parseGuide(JSON.stringify({ reply: "Listo.", setup }), true)?.setup).toMatchObject({ action: "walk", view: "front", keepScene: true });
  });

  it("drops a setup that can't be made instead of failing the conversation", () => {
    expect(parseGuide(JSON.stringify({ reply: "Listo.", setup: { ...setup, action: "swim" } }), true)).toEqual({ reply: "Listo.", setup: null });
    expect(parseGuide(JSON.stringify({ reply: "Listo.", setup: { ...setup, mode: "sequence", durationSeconds: 90 } }), true)?.setup?.durationSeconds).toBe(20);
    // No scene in the upload: nothing to keep.
    expect(parseGuide(JSON.stringify({ reply: "Listo.", setup }), false)?.setup?.keepScene).toBe(false);
    expect(parseGuide("nope", true)).toBeNull();
  });

  it("creates with the prompt and cost the Advanced form would use", () => {
    const parsed = parseGuide(JSON.stringify({ reply: "Listo.", setup }), true)!.setup!;
    expect(guidedDrawings(parsed)).toBe(8);
    expect(guidedSequence(parsed)).toBeUndefined();
    expect(guidedPrompt(parsed)).toContain("Walk in place, front view, a slow relaxed walk\n\nCreate one coherent repeating eight-pose action");
    const sequence = { ...parsed, mode: "sequence" as const, durationSeconds: 3, drawingFps: 12 as const };
    expect(guidedDrawings(sequence)).toBe(36);
    expect(guidedPrompt(sequence)).toContain("3-second performance at 12 drawings per second");
  });

  it("keeps the conversation the animator's turn and its rules fixed", () => {
    const imageId = "6b2f3c1e-8f4a-4a51-9a39-0d6f1b2c3d4e";
    expect(GuideRequestSchema.safeParse({ imageId, messages: [{ role: "user", text: "camina lento" }] }).success).toBe(true);
    expect(GuideRequestSchema.safeParse({ imageId, messages: [{ role: "assistant", text: "¿Qué hace?" }] }).success).toBe(false);
    expect(GuideRequestSchema.safeParse({ messages: [{ role: "user", text: "camina lento" }] }).success).toBe(false);
    expect(GUIDE_INSTRUCTIONS).toContain("at most three questions");
    expect(GUIDE_INSTRUCTIONS).toContain("always reply in the animator's language");
    expect(guideJsonSchema().required).toEqual(["reply", "setup"]);
  });
});
