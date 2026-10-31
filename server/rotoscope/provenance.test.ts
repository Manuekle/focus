import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { framePrompt, swapFramePrompt, type FrameInput } from "./draw";
import { describePose, measureArms, type Pose } from "./pose-match";
import { assertIsolation, canvasToFrame, entityOf, facingOf, frameToCanvas, frameToVideo, imageSideOf, ProvenanceError, recordReferences, sha256, videoToFrame, type GenerationTarget } from "./provenance";

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "__fixtures__/wave/poses.json"), "utf8")) as {
  crop: { width: number; height: number; x: number; y: number };
  size: { width: number; height: number };
  layout: { scale: number; x: number; y: number };
  source: Pose[];
};

const png = (seed: number) => Buffer.from(`png-${seed}`);

/** Two characters that share nothing: different sheet bytes and a different design description. */
const heroA = { sheet: png(1), description: "Tall knight in silver plate armour, red cape, short blond hair, flat cel colours." };
const heroB = { sheet: png(2), description: "Small round robot, blue metal body, single yellow eye, no hair, thick outlines." };

function input(character: { sheet: Buffer; description: string }, pose: Pose, extra: Partial<FrameInput> = {}): FrameInput {
  return {
    character: character.sheet,
    description: character.description,
    guide: png(10),
    mannequin: png(11),
    sourceGrey: png(12),
    previous: null,
    marks: { head: 128, feet: 1400, center: 512 },
    poseText: describePose(pose),
    measured: measureArms(pose),
    bodyMap: "EXACT MEASUREMENTS. (guide)",
    face: "",
    correction: null,
    feedback: [],
    ...extra,
  };
}

function target(references: ReturnType<typeof framePrompt>["references"], identity: Buffer): GenerationTarget {
  return {
    kind: "generation-target", frame: 1, attempt: 1,
    pose: { kind: "pose-source", frame: 1, file: "source/frame_0001.png", sha256: sha256(png(12)), crop: fixture.crop, layout: fixture.layout },
    identity: { kind: "character-identity", file: "character.png", sha256: sha256(identity) },
    references: recordReferences(references),
  };
}

describe("reference isolation (A = video, B = character, C = output)", () => {
  it("labels every reference framePrompt sends with its entity, the character first", () => {
    const { references } = framePrompt(input(heroA, fixture.source[0], { previous: png(20), anchor: png(21), palette: { image: png(22), text: "red #ff0000" } }));
    expect(recordReferences(references).map((reference) => reference.entity)).toEqual(["B", "A+B", "A", "C", "C", "aid"]);
  });

  it("swapping the character changes Image 1 and the design line only: every pose input stays byte for byte", () => {
    const pose = fixture.source[0];
    const a = framePrompt(input(heroA, pose));
    const b = framePrompt(input(heroB, pose));
    expect(sha256(a.references[0].png)).not.toBe(sha256(b.references[0].png));
    expect(a.references.slice(1).map((reference) => sha256(reference.png))).toEqual(b.references.slice(1).map((reference) => sha256(reference.png)));
    const differing = a.prompt.split("\n").filter((line, i) => line !== b.prompt.split("\n")[i]);
    expect(differing).toEqual([`Keep the character exactly as drawn: ${heroA.description}`]);
    // The pose words come from the video's joints alone: no character goes in.
    expect(a.prompt).toContain(describePose(pose));
    expect(a.prompt).toContain(measureArms(pose));
  });

  it("the same character in two different poses keeps Image 1 and changes the pose text", () => {
    const [first, last] = [framePrompt(input(heroA, fixture.source[0])), framePrompt(input(heroA, fixture.source[8]))];
    expect(sha256(first.references[0].png)).toBe(sha256(last.references[0].png));
    expect(describePose(fixture.source[0])).not.toBe(describePose(fixture.source[8]));
  });

  it("accepts a request whose Image 1 is the run's character", () => {
    const { references } = framePrompt(input(heroA, fixture.source[0], { previous: png(20) }));
    expect(() => assertIsolation(target(references, heroA.sheet), new Set([sha256(png(20))]))).not.toThrow();
  });

  it("accepts an edit of the video frame sent before the character, and refuses another character", () => {
    const { references } = swapFramePrompt({ frame: png(40), character: heroA.sheet, description: "", note: "", correction: null, feedback: [] });
    expect(recordReferences(references).map((reference) => reference.entity)).toEqual(["A", "B"]);
    expect(() => assertIsolation(target(references, heroA.sheet))).not.toThrow();
    expect(() => assertIsolation(target(references, heroB.sheet))).toThrow(/not the run's character/);
  });

  it("accepts the character rescaled from the run's sheet and refuses one rescaled from another", () => {
    const scaled = png(41);
    const sent = swapFramePrompt({ frame: png(40), character: scaled, characterSheet: heroA.sheet, description: "", note: "", correction: null, feedback: [] }).references;
    expect(() => assertIsolation(target(sent, heroA.sheet))).not.toThrow();
    const other = swapFramePrompt({ frame: png(40), character: scaled, characterSheet: heroB.sheet, description: "", note: "", correction: null, feedback: [] }).references;
    expect(() => assertIsolation(target(other, heroA.sheet))).toThrow(/not the run's character/);
  });

  it("refuses a request whose character image isn't the run's character", () => {
    const { references } = framePrompt(input(heroB, fixture.source[0]));
    expect(() => assertIsolation(target(references, heroA.sheet))).toThrow(ProvenanceError);
  });

  it("refuses an earlier output sent in place of the video frame", () => {
    const output = png(30);
    const { references } = framePrompt(input(heroA, fixture.source[0], { sourceGrey: output }));
    expect(() => assertIsolation(target(references, heroA.sheet), new Set([sha256(output)]))).toThrow(/earlier output/);
  });

  it("refuses an earlier output sent as the character", () => {
    const output = png(31);
    const { references } = framePrompt(input({ ...heroA, sheet: output }, fixture.source[0]));
    expect(() => assertIsolation(target(references, output), new Set([sha256(output)]))).toThrow(/earlier output/);
  });

  it("refuses a role it doesn't know instead of guessing its entity", () => {
    expect(() => entityOf("SOME OTHER IMAGE")).toThrow(ProvenanceError);
  });
});

describe("coordinate systems", () => {
  const points = fixture.source[0].keypoints.flatMap(([x, y]) => (x === null || y === null ? [] : [[x, y] as const]));

  it("frame ↔ video round-trips through the run's crop (828×1472+0+160)", () => {
    for (const p of points) {
      const video = frameToVideo(p, fixture.crop);
      expect(video[1]).toBeCloseTo(p[1] + 160, 9);
      const back = videoToFrame(video, fixture.crop);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
    expect(fixture.size).toEqual({ width: fixture.crop.width, height: fixture.crop.height });
  });

  it("frame ↔ canvas round-trips through the run's layout", () => {
    for (const p of points) {
      const back = canvasToFrame(frameToCanvas(p, fixture.layout), fixture.layout);
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });

  it("an uncropped frame is the video", () => {
    expect(frameToVideo([10, 20], null)).toEqual([10, 20]);
  });
});

describe("anatomical side vs image side", () => {
  it("the video subject faces the camera: their right arm is on the image's left", () => {
    const facing = facingOf(fixture.source[0]);
    expect(facing).toBe("camera");
    expect(imageSideOf("right", facing!)).toBe("LEFT");
    expect(imageSideOf("left", facing!)).toBe("RIGHT");
    // describePose says the same: the raised arm (subject's left, keypoints 5-7-9) is on the image's RIGHT.
    expect(describePose(fixture.source[0])).toMatch(/arm on the RIGHT of the image: upper arm points up/);
  });

  it("mirrored horizontally, the same keypoint labels mean the subject faces away", () => {
    const mirrored: Pose = { keypoints: fixture.source[0].keypoints.map(([x, y]) => [x === null ? null : fixture.size.width - x, y]), scores: fixture.source[0].scores };
    expect(facingOf(mirrored)).toBe("away");
    expect(imageSideOf("right", "away")).toBe("RIGHT");
  });

  it("shoulders on top of each other: profile, no side claimed", () => {
    const keypoints = fixture.source[0].keypoints.map((p) => [...p] as [number | null, number | null]);
    keypoints[5] = [400, 480];
    keypoints[6] = [410, 482];
    expect(facingOf({ keypoints, scores: fixture.source[0].scores })).toBe("profile");
    expect(imageSideOf("right", "profile")).toBeNull();
  });
});
