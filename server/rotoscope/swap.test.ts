import { describe, expect, it } from "vitest";
import { measuresText } from "../../shared/rotoscope";
import { buildText, POSE_SHEET_ROLE, reconcileBuild, swapFramePrompt, validBuild, type BuildProfile } from "./draw";

const png = (n: number) => Buffer.from([n]);
const base = { frame: png(1), character: png(2), description: "Keep the character exactly as drawn: navy bob, red cheongsam.", note: "The arm on the right of the image is raised.", correction: null, feedback: [] as string[] };

describe("swapFramePrompt", () => {
  it("edits the video frame into the character with this frame's own note and nothing else", () => {
    const { prompt, references } = swapFramePrompt(base);
    expect(references.map((reference) => reference.png)).toEqual([png(1), png(2)]);
    expect(prompt).toContain("Edit Image 1 into one finished frame of a 2D anime animation: replace the person with the character of Image 2");
    expect(prompt).toContain(`CHARACTER IDENTITY (Image 2)\n${base.description}`);
    expect(prompt).toContain(`TARGET POSE (Image 1)\n${base.note}`);
    expect(prompt).not.toMatch(/previous|rejected|correction|mannequin|skeleton|grid/i);
  });

  it("gives each image one job, the style sheet as rules, and what wins when they pull apart", () => {
    const style = "Line work: thin dark-brown outlines, thicker at the silhouette.\nShading: two-tone cel shading with hard edges.";
    const { prompt, references } = swapFramePrompt({ ...base, style });
    expect(references[0].role).toMatch(/^REFERENCE C, THE TARGET POSE/);
    expect(references[1].role).toMatch(/^REFERENCE A, THE CHARACTER/);
    expect(prompt).toContain(`ART STYLE (as Image 2 is drawn)\n${style}\nThe frame must look drawn by the same artist`);
    expect(prompt.indexOf("CHARACTER IDENTITY")).toBeLessThan(prompt.indexOf("ART STYLE"));
    expect(prompt.indexOf("ART STYLE")).toBeLessThan(prompt.indexOf("TARGET POSE"));
    expect(prompt).toMatch(/PRIORITIES when these pull apart\n1\. The character's identity and proportions, from Image 2\.\n2\. The pose, never mirrored, at Image 1's size and placement\.\n3\. The drawing style, from Image 2\./);
    expect(prompt).toContain("Sides as seen in the picture, never mirrored");
    // Without a style sheet the section still holds the sheet as the authority.
    expect(swapFramePrompt(base).prompt).toContain("ART STYLE (as Image 2 is drawn)\nThe frame must look drawn by the same artist");
  });

  it("says the character's height and weight, and shows the reference poses before the pencil marks", () => {
    const body = measuresText({ heightCm: 160, weightKg: 54 });
    expect(body).toBe("1.60 m tall, 54 kg (BMI 21.1)");
    const { prompt, references } = swapFramePrompt({ ...base, body, poseSheet: png(4), correction: { marked: png(3), comment: "Raise the hand." } });
    expect(prompt).toContain("Body: the character is 1.60 m tall, 54 kg (BMI 21.1).");
    expect(references.map((reference) => reference.png)).toEqual([png(1), png(2), png(4), png(3)]);
    expect(references[2].role).toBe(POSE_SHEET_ROLE);
    expect(prompt).toContain("Joints: Image 3 shows how this character's arms, legs and torso bend");
    expect(prompt).toContain("see the red marks in Image 4");
    // Without measures or a pose sheet, neither line is there.
    expect(swapFramePrompt(base).prompt).not.toMatch(/Body:|Joints:/);
    expect(measuresText(null)).toBeNull();
    expect(measuresText({ heightCm: 172, weightKg: null })).toBe("1.72 m tall");
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

  it("leaves the pose line and the identity line out when there is nothing to say", () => {
    const { prompt } = swapFramePrompt({ ...base, description: "", note: "" });
    expect(prompt).not.toContain("Pose:");
    expect(prompt).not.toContain("exactly as drawn");
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
