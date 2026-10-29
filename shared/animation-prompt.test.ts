import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CreateFlipbookRequestSchema, FLIPBOOK_TITLE_MAX, flipbookTitle } from "./flipbook";
import { descriptionAnimationPrompt, videoAnimationPrompt } from "./animation-prompt";

describe("animation creation instructions", () => {
  it("keeps the complete user direction and exact continuous timing within the API limit", () => {
    const note = "precise arm movement ".repeat(20).slice(0, 400);
    const prompt = descriptionAnimationPrompt(`Dance in place, preserve the original camera view, ${note}`, { durationSeconds: 6, drawingFps: 12 });
    expect(prompt).toContain(note);
    expect(prompt).toContain("6-second performance at 12 drawings per second (72 timed drawings)");
    expect(prompt).toContain("sole authority");
    expect(prompt).toContain("planted foot contacts");
    expect(CreateFlipbookRequestSchema.safeParse({ imageId: randomUUID(), prompt, sequence: { durationSeconds: 6, drawingFps: 12 } }).success).toBe(true);
  });
  it("separates video motion, character identity and secondary notes without a preset instruction", () => {
    const prompt = videoAnimationPrompt({ settings: { durationSeconds: 3, drawingFps: 24 }, start: 1.25, note: "Make finger gestures clear." });
    expect(prompt).toContain("from 1.25 to 4.25 seconds");
    expect(prompt).toContain("72 timed drawings");
    expect(prompt).toContain("Make finger gestures clear.");
    expect(prompt).toContain("secondary to the observed movement");
    expect(prompt).not.toContain("Walk across the screen");
    expect(prompt).not.toContain("preserve the original camera view");
    expect(CreateFlipbookRequestSchema.safeParse({ imageId: randomUUID(), prompt, sequence: { durationSeconds: 3, drawingFps: 24 }, motionSource: "video" }).success).toBe(true);
  });
  it("rejects video mode with competing action or camera overrides or without continuous settings", () => {
    const request = { imageId: randomUUID(), prompt: "Follow the video", motionSource: "video", sequence: { durationSeconds: 4, drawingFps: 24 } };
    for (const change of [{ action: "walk" }, { view: "side" }, { sequence: undefined }]) expect(CreateFlipbookRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
  it("gives new and legacy video instructions a short title while preserving a renamed animation", () => {
    const prompt = videoAnimationPrompt({ settings: { durationSeconds: 4, drawingFps: 24 }, start: 0 });
    expect(flipbookTitle({ title: "", prompt })).toBe("Video movement");
    expect(flipbookTitle({ title: prompt.slice(0, FLIPBOOK_TITLE_MAX), prompt })).toBe("Video movement");
    expect(flipbookTitle({ title: "My performance", prompt })).toBe("My performance");
    expect(flipbookTitle({ title: "", prompt: "Dance in place" })).toBe("Dance in place");
  });
});
