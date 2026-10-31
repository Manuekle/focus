import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toRgba, type Rgba } from "./alpha";
import { bodySpec, checkProportions, sheetEstimates } from "./body-map";
import { holdColours, profiledPalette, sheetColours, sheetCutout, toLab, type Palette } from "./colour";
import { decide } from "./decision";
import { frameName } from "./extract";
import { figureBox, hairTop, sheetHairTop } from "./grid";
import type { Pose } from "./pose-match";
import { silhouetteMatch } from "./pipeline";
import { readManifest, runFrames, writeManifest, type Check, type Manifest } from "./run-state";

// The quality validation engine: the decision states, the colour check against the character's own
// colours (no false rejects on shading and accents, real ones on foreign colours and wrong parts), the
// proportions against a sheet that shows a limb foreshortened, and empty silhouettes.

const fixtures = path.join(import.meta.dirname, "__fixtures__/wave");
const poses = JSON.parse(readFileSync(path.join(fixtures, "poses.json"), "utf8")) as { source: Pose[]; character: Pose; guides: Pose[]; layout: { scale: number; x: number; y: number } };
const check = (name: string, passed: boolean, extra: Partial<Check> = {}): Check => ({ name, passed, detail: name, ...extra });

describe("decide", () => {
  it("accepts when every check passed, informational warnings included", () => {
    expect(decide([check("pose", true), check("rig", true, { status: "warn" })]).decision).toBe("ACCEPTED");
  });

  it("rejects on a measured critical or major failure, most severe first", () => {
    const verdict = decide([check("style", false), check("alpha", false), check("pose", false)]);
    expect(verdict.decision).toBe("REJECTED");
    expect(verdict.reasons[0]).toMatch(/^pose \(critical\)/);
    expect(verdict.reasons).toHaveLength(2);
  });

  it("sends a minor finding to a person instead of drawing again", () => {
    expect(decide([check("pose", true), check("style", false)]).decision).toBe("REVIEW_NEEDED");
    expect(decide([check("pose", true), check("colour", false, { severity: "minor" })]).decision).toBe("REVIEW_NEEDED");
  });

  it("calls a frame inconclusive when a check that could reject it couldn't measure", () => {
    expect(decide([check("pose", false, { status: "inconclusive" }), check("colour", true)]).decision).toBe("INCONCLUSIVE");
    // …but a confident rejection elsewhere still rejects.
    expect(decide([check("pose", false, { status: "inconclusive" }), check("alpha", false)]).decision).toBe("REJECTED");
    // An unmeasurable minor check doesn't hold a frame back.
    expect(decide([check("pose", true), check("style", false, { status: "inconclusive" })]).decision).toBe("ACCEPTED");
  });
});

describe("runFrames with the decision engine", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "roto-decision-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  const manifest = (): Manifest => ({
    version: 1, createdAt: "2026-10-30T00:00:00Z", video: "v.mov", fps: 9, start: 0, seconds: 1, crop: null,
    character: { file: "character.png", sha256: "x" }, maxAttempts: 3,
    frames: [1, 2].map((index) => ({ index, source: `source/${frameName(index)}`, status: "pending" as const, attempts: [] })),
  });

  it.each([
    ["REVIEW_NEEDED", [check("pose", true), check("style", false)]],
    ["INCONCLUSIVE", [check("pose", false, { status: "inconclusive" })]],
  ] as const)("%s leaves the frame for a person after one attempt, spends no retry, keeps the verdict and goes on with the next frame", async (decision, checks) => {
    await writeManifest(dir, manifest());
    const calls: string[] = [];
    const outcome = await runFrames(dir, { draw: async ({ frame, attempt }) => { calls.push(`${frame.index}:${attempt}`); return Buffer.from("png"); }, validate: async (_png, { frame }) => (frame.index === 1 ? [...checks] : [check("pose", true)]) });
    expect(outcome).toEqual({ kind: "partial", approved: 1, failed: [1] });
    expect(calls).toEqual(["1:1", "2:1"]);
    const state = await readManifest(dir);
    expect(state.frames[0].status).toBe("failed");
    expect(state.frames[0].attempts[0].decision).toBe(decision);
    expect(state.frames[1].status).toBe("approved");
    expect(state.halted ?? null).toBeNull();
  });

  it("a redraw of one frame still stops on it and keeps the verdict", async () => {
    await writeManifest(dir, manifest());
    const outcome = await runFrames(dir, { draw: async () => Buffer.from("png"), validate: async () => [check("pose", true), check("style", false)] }, { only: 1 });
    expect(outcome).toMatchObject({ kind: "halted", frame: 1 });
    expect((await readManifest(dir)).halted?.reason).toMatch(/^needs review/);
  });

  it("REJECTED draws again with the finding as feedback", async () => {
    await writeManifest(dir, manifest());
    const calls: number[] = [];
    await runFrames(dir, { draw: async ({ frame, attempt }) => { if (frame.index === 1) calls.push(attempt); return Buffer.from(`png${attempt}`); }, validate: async (_, { attempt }) => [check("pose", attempt > 1)] });
    expect(calls).toEqual([1, 2]);
    expect((await readManifest(dir)).frames[0].attempts.map((attempt) => attempt.decision)).toEqual(["REJECTED", "ACCEPTED"]);
  });
});

describe("colour check against the character's own colours", () => {
  const sheet = readFileSync(path.join(fixtures, "character.png"));
  let palette: Palette;
  beforeEach(async () => {
    palette ??= await profiledPalette(sheet, { colours: (await sheetColours(sheet)).map((colour) => ({ ...colour, name: colour.hex })) });
  });
  const cutout = async (n: number): Promise<Rgba> => toRgba(await readFile(path.join(fixtures, `a${n}_cutout_512.png`)));
  function paint(image: Rgba, rgb: readonly [number, number, number], rows: readonly [number, number]): Rgba {
    const data = Buffer.from(image.data);
    for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < image.width; x++) if (data[(y * image.width + x) * 4 + 3] >= 128) data.set(rgb, (y * image.width + x) * 4);
    return { ...image, data };
  }

  it("puts the skin in the palette (the flat-only pass lost it) and the sheet passes against its own palette", async () => {
    expect(palette.colours.some((colour) => colour.lab[0] > 80 && colour.lab[1] > 3 && colour.lab[2] > 8)).toBe(true);
    expect(holdColours(await sheetCutout(sheet), palette, null).check.passed).toBe(true);
  });

  it("passes the three Muse Image attempts, whose colours are the character's (they failed at 92.6–93.8 % before)", async () => {
    for (const n of [1, 2, 3]) expect(holdColours(await cutout(n), palette, null).check).toMatchObject({ passed: true });
  });

  it("fails a colour the character doesn't have, as a major finding", async () => {
    // The skirt's lower half painted orange: no orange anywhere on the sheet.
    const result = holdColours(paint(await cutout(2), [255, 128, 0], [520, 700]), palette, null);
    expect(result.check.passed).toBe(false);
    expect(result.check.detail).toMatch(/colours the character doesn't have/);
    expect(result.check.severity).toBe("major");
  });

  it("fails a part painted in another of the character's colours when the previous frame is right", async () => {
    // The skirt painted the blouse's green: every colour is the character's, only the areas move.
    const right = await cutout(2);
    const green = palette.colours.find((colour) => colour.lab[1] < -20)!;
    const rgb = [parseInt(green.hex.slice(1, 3), 16), parseInt(green.hex.slice(3, 5), 16), parseInt(green.hex.slice(5, 7), 16)] as const;
    const result = holdColours(paint(right, rgb, [430, 740]), palette, holdColours(right, palette, null).shares);
    expect(result.check.passed).toBe(false);
    expect(result.check.detail).toMatch(/wrong parts/);
  });
});

describe("proportions against a sheet with foreshortened forearms", () => {
  const onCanvas = (pose: Pose): Pose => ({ keypoints: pose.keypoints.map(([x, y]) => (x === null || y === null ? [null, null] : [x * poses.layout.scale + poses.layout.x, y * poses.layout.scale + poses.layout.y])), scores: pose.scores });
  const guides = poses.guides.map(onCanvas);

  it("finds the sheet's forearms foreshortened (hands clasped in front) and not its legs", () => {
    const estimates = sheetEstimates(poses.character, poses.source, guides);
    expect([...estimates.keys()].sort()).toEqual(["7-9", "8-10"]);
  });

  it("finds nothing to estimate on a sheet whose arms hang extended", () => {
    const extended = poses.source[4]; // the video subject, arms out: forearm/upper arm as in the clip
    expect(sheetEstimates(extended, poses.source, guides).size).toBe(0);
  });

  const spec = (estimates: ReadonlyMap<string, number>) => bodySpec(guides[0], { head: 200, feet: 1450, center: 512 }, 200, new Map([["7-9", 100], ["8-10", 100]]), estimates)!;
  /** The guide with the subject's left forearm (7→9) drawn `length` px long along its own direction. */
  const drawnWith = (length: number): Pose => {
    const keypoints = guides[0].keypoints.map((p) => [...p] as [number | null, number | null]);
    const [ex, ey] = keypoints[7] as [number, number];
    const [wx, wy] = keypoints[9] as [number, number];
    const d = Math.hypot(wx - ex, wy - ey);
    keypoints[9] = [ex + ((wx - ex) / d) * length, ey + ((wy - ey) / d) * length];
    return { keypoints, scores: guides[0].scores };
  };
  const marks = { head: 200, feet: 1450, center: 512 };

  it("a forearm longer than the foreshortened sheet's but within the estimate passes", () => {
    expect(checkProportions(spec(new Map([["7-9", 140]])), drawnWith(130), marks, marks).passed).toBe(true);
  });

  it("past the estimate it is a minor finding for a person, never a measured defect", () => {
    const result = checkProportions(spec(new Map([["7-9", 140]])), drawnWith(200), marks, marks);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("minor");
    expect(decide([result]).decision).toBe("REVIEW_NEEDED");
  });

  it("without an estimate the same forearm is a measured, major defect", () => {
    const result = checkProportions(spec(new Map()), drawnWith(200), marks, marks);
    expect(result.passed).toBe(false);
    expect(result.severity).toBeUndefined();
    expect(decide([result]).decision).toBe("REJECTED");
  });
});

describe("silhouette comparison", () => {
  const mask = (on: boolean) => ({ width: 4, height: 4, data: new Uint8Array(16).fill(on ? 1 : 0) });
  it("is no comparison, not a perfect match, when either silhouette is empty", () => {
    expect(silhouetteMatch(mask(false), mask(false))).toBeNull();
    expect(silhouetteMatch(mask(true), mask(false))).toBeNull();
    expect(silhouetteMatch(null, mask(true))).toBeNull();
    expect(silhouetteMatch(mask(true), mask(true))).toBe(1);
  });
});

describe("hair top: one rule for the sheet and the drawings", () => {
  it("a spike off to the side is not the top of the head; the column over the nose is", () => {
    // A head 100 px tall over the nose, with one spike 60 px higher at the far left of the hair.
    const solid = (x: number, y: number) => (y >= 100 && y < 400 && x >= 400 && x < 600) || (y >= 40 && y < 100 && x >= 400 && x < 410);
    expect(hairTop(solid, 1024, 1024, [500, 200], 200)).toBe(100);
  });

  it("on the wave sheet the topknot and bow sit above the hair over the face: the old top over-measured the head", async () => {
    const sheet = readFileSync(path.join(fixtures, "character.png"));
    const column = await sheetHairTop(sheet, poses.character);
    const { top } = await figureBox(sheet);
    expect(column).not.toBeNull();
    expect(column!).toBeGreaterThan(top);
  });
});

describe("colour areas between frames: a mistake is not passed on", () => {
  // Skin and its shadow; the sheet shows little shadow. Images: a figure of N skin pixels and M shadow pixels.
  const skin = toLab(247, 213, 207);
  const shadow = toLab(193, 136, 138);
  const palette: Palette = { colours: [{ lab: skin, hex: "#f7d5cf", share: 0.9, name: "skin" }, { lab: shadow, hex: "#c1888a", share: 0.1, name: "skin shadow" }], gamut: [skin, shadow], sheetShares: [0.9, 0.1] };
  const figure = (shadowShare: number): Rgba => {
    const [width, height] = [100, 100];
    const data = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p++) data.set([...(p < width * height * shadowShare ? [193, 136, 138] : [247, 213, 207]), 255], p * 4);
    return { data, width, height };
  };

  it("a frame that drops a wrong shading the previous frame had (back toward the sheet) passes", () => {
    const contaminated = holdColours(figure(0.3), palette, null).shares;
    expect(holdColours(figure(0.1), palette, contaminated).check.passed).toBe(true);
  });

  it("a frame that adds that shading after a clean frame (away from the sheet) still fails", () => {
    const clean = holdColours(figure(0.1), palette, null).shares;
    const result = holdColours(figure(0.3), palette, clean);
    expect(result.check.passed).toBe(false);
    expect(result.check.detail).toMatch(/wrong parts/);
  });
});
