import { describe, expect, it } from "vitest";
import { buildText, outfitItems, reconcileBuild, swapFramePrompt, validBuild, type BuildProfile } from "./draw";
import { guardPrompt } from "./guardrails";

const png = (n: number) => Buffer.from([n]);
const base = { frame: png(1), character: png(2), description: "Keep the character exactly as drawn: navy bob, red cheongsam.", note: "The arm on the right of the image is raised.", correction: null, feedback: [] as string[] };

describe("swapFramePrompt", () => {
  it("edits the video frame into the character with this frame's own note and nothing else", () => {
    const { prompt, references } = swapFramePrompt(base);
    expect(references.map((reference) => reference.png)).toEqual([png(1), png(2)]);
    expect(references[0].role).toMatch(/^THE VIDEO FRAME to edit: the pose/);
    expect(references[1].role).toMatch(/^THE CHARACTER: the authority on identity, outfit and style/);
    expect(prompt).toMatch(/^Edit Image 1 into one frame of a 2D anime animation: replace the person with the character of Image 2\./);
    expect(prompt).toContain(`POSE (as seen in Image 1, never mirrored): ${base.note}`);
    expect(prompt).not.toMatch(/previous|rejected|correction|mannequin|skeleton|grid|CONTINUITY|PRIORITIES|ART STYLE/i);
  });

  it("lists the character's items alone, without the identity line's opening, proportions or background", () => {
    const description = "Keep the character exactly as drawn: navy bob with a low bun, white collared shirt, black loafers. Preserve the character's proportions (six heads tall), colours and line work. Show the whole body on a plain background.";
    const { prompt } = swapFramePrompt({ ...base, description });
    expect(prompt).toContain("CHARACTER (copy from Image 2, item by item): navy bob with a low bun, white collared shirt, black loafers. Keep the same face, proportions");
    expect(prompt).not.toMatch(/exactly as drawn|six heads|plain background/);
    expect(outfitItems("Keep Ichika exactly as drawn: long hair, red scarf.")).toBe("long hair, red scarf");
  });

  it("is short, keys out on magenta and keeps every clause the guardrails look for", () => {
    const { prompt } = swapFramePrompt({ ...base, description: "Keep the character exactly as drawn: navy bob, red cheongsam." });
    expect(prompt.split(/\s+/).length).toBeLessThan(160);
    expect(prompt).toContain("perfectly flat solid #FF00FF magenta");
    const guarded = guardPrompt(prompt, 2);
    expect(guarded.prompt).toBe(prompt);
  });

  it("gives Muse Image Muse Spark's reading of a note, not the note's own loose words", () => {
    const diagnosis = { problem: "The pose is drawn mirrored: the hand in front of the face is on the right of the image.", cause: "The arm was named by its shoulder.", fix: "Put the open hand in front of the face on the LEFT of the image and the hand at the waist on the RIGHT." };
    const correction = { marked: png(9), comment: "la pose debe estar invertida" };
    const { prompt, references } = swapFramePrompt({ ...base, correction, feedback: ["The drawing is a mirror image."], diagnosis });
    expect(references.at(-1)?.png).toEqual(png(9));
    expect(prompt).toContain(`CORRECTIONS\nDirector's correction (see the red marks in Image 3): ${diagnosis.problem}\nFix: ${diagnosis.fix}`);
    expect(prompt).not.toContain("invertida");
    expect(prompt).not.toContain("The drawing is a mirror image.");
    // A retry without a note: the reading of the rejected drawing.
    expect(swapFramePrompt({ ...base, diagnosis }).prompt).toContain(`The previous drawing of this frame was rejected: ${diagnosis.problem}`);
    // Muse Spark's own image numbers never reach a prompt that wasn't sent those images.
    const numbered = { ...diagnosis, problem: "Image 3 is not a mirror image of Image 1.", fix: "Unlike Image 3, bend the elbow." };
    const retry = swapFramePrompt({ ...base, diagnosis: numbered }).prompt;
    expect(retry).toContain("The previous drawing of this frame was rejected: the rejected drawing is not a mirror image of Image 1.");
    expect(retry).not.toContain("Image 3");
  });

  it("carries a frame's own note, never another's", () => {
    const [a, b] = [swapFramePrompt({ ...base, note: "Both hands on the head." }), swapFramePrompt({ ...base, note: "Arms out wide." })];
    expect(a.prompt).toContain("Both hands on the head.");
    expect(a.prompt).not.toContain("Arms out wide.");
    expect(b.prompt).not.toContain("Both hands on the head.");
  });

  it("names what was wrong only on a retry, and adds the pencil marks as Image 3", () => {
    const retry = swapFramePrompt({ ...base, feedback: ["The arm is mirrored."], correction: { marked: png(3), comment: "Raise the hand." } });
    expect(retry.prompt).toContain("Fix: The arm is mirrored.");
    expect(retry.prompt).toContain("Raise the hand.");
    expect(retry.references).toHaveLength(3);
  });

  it("keeps what a check says is wrong but drops its grid-cell and percentage measurements", () => {
    const { prompt } = swapFramePrompt({ ...base, feedback: ["The drawing is a mirror image of the pose: left and right are swapped. Keep each limb on the same side of the image as in the pose photo: the upper arm on the LEFT of the image points down-right. The upper arm on the RIGHT of the image is 78 % too short: it must measure 0.82 cells, from (4.54, 3.74) to (4.69, 2.93)."] });
    expect(prompt).toContain("mirror image of the pose");
    expect(prompt).toContain("upper arm on the LEFT of the image points down-right");
    expect(prompt).not.toMatch(/cells|78 %/);
  });

  it("leaves the pose note and the items out when there is nothing to say", () => {
    const { prompt } = swapFramePrompt({ ...base, description: "", note: "" });
    expect(prompt).toContain("POSE (as seen in Image 1, never mirrored).");
    expect(prompt).toContain("CHARACTER (copy from Image 2, item by item). Keep");
  });
});

describe("build profile", () => {
  const profile: BuildProfile = { headTop: 1, chin: 2, shoulders: 2.4, waist: 4, hips: 5, knees: 7.5, soles: 8, shoulderWidth: 1.5, waistWidth: 0.9, hipWidth: 1.3, thighWidth: 0.6, notes: "Full thighs." };

  it("is read as multiples of the head's height, so it holds at any size", () => {
    const text = buildText(profile);
    expect(text).toContain("7 heads tall");
    expect(text).toContain("shoulders 1.5 heads wide");
    expect(text).not.toContain("Full thighs.");
    expect(buildText({ ...profile, headTop: 2, chin: 4, shoulders: 4.8, waist: 8, hips: 10, knees: 15, soles: 16, shoulderWidth: 3, waistWidth: 1.8, hipWidth: 2.6, thighWidth: 1.2 })).toContain("7 heads tall");
  });

  it("takes the landmark lines from the measurement and keeps Spark's widths, notes and plausible waist", () => {
    const measured = { headTop: 0.15, chin: 1.9, shoulders: 3.2, hips: 6.1, knees: 8.6, soles: 11.6 };
    const merged = reconcileBuild(profile, measured);
    expect(merged).toMatchObject({ ...measured, waist: 4, shoulderWidth: 1.5, hipWidth: 1.3, notes: "Full thighs." });
    // A waist off the torso is replaced by a point between shoulders and hips.
    expect(reconcileBuild({ ...profile, waist: 9 }, measured).waist).toBeCloseTo(3.2 + 0.6 * (6.1 - 3.2));
    expect(validBuild(merged)).toBe(true);
  });

  it("refuses measurements that don't run top to bottom or have no width", () => {
    expect(validBuild(profile)).toBe(true);
    expect(validBuild({ ...profile, hips: 3 })).toBe(false);
    expect(validBuild({ ...profile, soles: 13 })).toBe(false);
    expect(validBuild({ ...profile, thighWidth: 0 })).toBe(false);
  });

  it("marks the character as drawn as tall as the person when it was rescaled", () => {
    const { references } = swapFramePrompt({ ...base, characterSheet: png(9) });
    expect(references[1].role).toContain("drawn as tall as the person of Image 1");
    expect(references[1].derivedFrom).toEqual(png(9));
    expect(swapFramePrompt(base).references[1].derivedFrom).toBeUndefined();
  });
});
