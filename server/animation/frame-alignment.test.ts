import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { WALK_POSES, type FrameId } from "../../shared/flipbook";
import { AppError } from "../errors";
import { DRIFT, walkerPng, walkerPose } from "./__fixtures__/walker";
import { BASELINE_Y, CELL_HEIGHT, TARGET_HEIGHT, computeAlignment, computeTimedAlignment, filledArea, despill, extractSubject, renderSprite, segmentation, segmentationConcepts, type AlignInput, type Extraction } from "./frame-alignment";
import { contactSheet } from "./quality-control";

// Cut-out and registration on deterministic drawings. SAM is switched off:
// these tests take the key-background path and never touch the network.

segmentation.segment = null;

async function alphaRows(png: Buffer): Promise<{ width: number; height: number; alpha: Uint8Array }> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, alpha: new Uint8Array(data) };
}

/** Lowest opaque row, opaque height and the torso column of an aligned sprite. */
async function spriteFacts(png: Buffer) {
  const { width, height, alpha } = await alphaRows(png);
  let top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha[y * width + x] >= 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  const h = bottom - top + 1;
  const xs: number[] = [];
  for (let y = Math.round(top + h * 0.12); y <= Math.round(top + h * 0.5); y++) for (let x = 0; x < width; x++) if (alpha[y * width + x] >= 128) xs.push(x);
  xs.sort((a, b) => a - b);
  return { top, bottom, height: h, torsoX: xs[Math.floor(xs.length / 2)], width };
}

let extractions: Extraction[] = [];
let entries: AlignInput[] = [];

beforeAll(async () => {
  extractions = await Promise.all(DRIFT.map(async (drift) => extractSubject({ png: await walkerPng(drift.phase, drift), concept: "walker", flipbookId: "test", allowAlpha: false })));
  entries = extractions.map((extraction, index) => ({
    frameId: `f${index}` as FrameId,
    version: `v-00000000000${index}`,
    phase: WALK_POSES[index].phase,
    relativeRootY: WALK_POSES[index].relativeRootY,
    measure: extraction.measure,
  }));
});

describe("character extraction", () => {
  it("cuts the walker out of a flat background with real alpha", async () => {
    for (const { measure, cutout } of extractions) {
      expect(measure.method).toBe("key");
      expect(measure.touchesEdge).toBe(false);
      expect(measure.backgroundUniformity).toBeGreaterThan(0.99);
      expect(measure.coverage).toBeGreaterThan(0.02);
      const meta = await sharp(cutout).metadata();
      expect(meta.hasAlpha).toBe(true);
      expect(meta.width).toBe(measure.crop.width);
    }
  });

  it("finds the lowest foot, not a stray pixel", async () => {
    // Fixture ground: canvas height − 120; a pose on its toes stands that many units higher.
    extractions.forEach(({ measure }, index) => {
      const { pose } = walkerPose(DRIFT[index].phase);
      const lowest = 1536 - 120 - Math.min(pose.lead.lift, pose.trail.lift) * DRIFT[index].scale;
      expect(Math.abs(measure.crop.top + measure.footY - lowest)).toBeLessThanOrEqual(5);
    });
  });

  it("removes background enclosed between the legs, keeps small light details", async () => {
    // Passing pose: the bent back leg encloses a pocket of white background.
    const passing = extractions[2];
    const { width, height, alpha } = await alphaRows(passing.cutout);
    const { data } = await sharp(passing.cutout).raw().toBuffer({ resolveWithObject: true });
    let opaqueWhite = 0;
    for (let index = 0; index < width * height; index++) {
      if (alpha[index] >= 250 && data[index * 4] > 245 && data[index * 4 + 1] > 245 && data[index * 4 + 2] > 245) opaqueWhite++;
    }
    expect(opaqueWhite).toBe(0);
  });

  it("uses an upload's own transparency instead of guessing", async () => {
    const extraction = await extractSubject({ png: await walkerPng("left_passing", { background: null }), concept: "walker", flipbookId: "test", allowAlpha: true });
    expect(extraction.measure.method).toBe("alpha");
  });

  it("refuses a drawing it cannot separate instead of faking a sprite", async () => {
    const noise = await sharp(Buffer.from(Array.from({ length: 512 * 512 * 3 }, (_, index) => (index * 7919) % 251)), { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
    await expect(extractSubject({ png: noise, concept: "walker", flipbookId: "test", allowAlpha: false })).rejects.toMatchObject({ code: "extraction_failed" });
    await expect(extractSubject({ png: noise, concept: "walker", flipbookId: "test", allowAlpha: false })).rejects.toBeInstanceOf(AppError);
  });
});

/**
 * A white-shirted figure on a white background: a 3 px black outline around a
 * white torso (80×120) over dark legs. `gap` opens the outline's right side.
 */
async function whiteShirtFrame(gap: number): Promise<Buffer> {
  const width = 240, height = 360;
  const data = Buffer.alloc(width * height * 3, 255);
  const paint = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(rgb, (y * width + x) * 3);
  };
  paint(77, 57, 163, 183, [20, 20, 25]); // outline
  paint(80, 60, 160, 180, [250, 250, 250]); // white shirt
  paint(95, 180, 145, 330, [30, 30, 40]); // legs
  if (gap) paint(160, 110, 163, 110 + gap, [255, 255, 255]);
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("line-art cut-out (imported frames)", () => {
  const cut = (png: Buffer, keyMode?: "lineart") => extractSubject({ png, concept: "character", flipbookId: "test", allowAlpha: false, useSegmentation: false, keyMode });

  it("keeps a white shirt on a white background that the drawing key removes", async () => {
    const png = await whiteShirtFrame(0);
    const drawing = await cut(png);
    const lineart = await cut(png, "lineart");
    // The shirt is ~9,600 of the figure's ~17,000 pixels.
    expect(lineart.measure.coverage).toBeGreaterThan(drawing.measure.coverage * 1.5);
    expect(lineart.measure.leakShare).toBeLessThan(0.02);
    expect(drawing.measure.leakShare).toBeUndefined();
  });

  it("measures a leak through a broken outline so it can be flagged", async () => {
    const leaky = await cut(await whiteShirtFrame(3), "lineart");
    expect(leaky.measure.leakShare).toBeGreaterThan(0.2);
    // A one-pixel break is sealed by the line-art barrier.
    const sealed = await cut(await whiteShirtFrame(1), "lineart");
    expect(sealed.measure.leakShare).toBeLessThan(0.02);
  });
});

describe("registration on one sprite cell", () => {
  it("puts every drawing's feet on the same baseline and its torso on the same column", async () => {
    const alignment = computeAlignment(entries, null);
    expect(alignment.cellHeight).toBe(CELL_HEIGHT);
    expect(alignment.cellWidth % 4).toBe(0);
    const facts = await Promise.all(entries.map(async (entry, index) => {
      const transform = alignment.transforms[entry.frameId]!;
      return spriteFacts(await renderSprite(extractions[index].cutout, entry.measure, transform, { width: alignment.cellWidth, height: alignment.cellHeight }));
    }));
    for (const fact of facts) {
      expect(Math.abs(fact.bottom + 1 - BASELINE_Y)).toBeLessThanOrEqual(3);
      expect(Math.abs(fact.torsoX - alignment.cellWidth / 2)).toBeLessThanOrEqual(4);
    }
  });

  it("removes generation size drift but keeps the planned up-and-down bob", async () => {
    const alignment = computeAlignment(entries, null);
    const heights = await Promise.all(entries.map(async (entry, index) => (await spriteFacts(await renderSprite(extractions[index].cutout, entry.measure, alignment.transforms[entry.frameId]!, { width: alignment.cellWidth, height: alignment.cellHeight }))).height));
    heights.forEach((height, index) => {
      const expected = TARGET_HEIGHT * (1 + WALK_POSES[index].relativeRootY);
      expect(Math.abs(height - expected) / expected).toBeLessThan(0.02);
    });
    // Down (index 1) is the lowest pose, up (index 3) the highest.
    expect(heights[1]).toBeLessThan(heights[0]);
    expect(heights[3]).toBeGreaterThan(heights[2]);
  });

  it("measures a stride from the contact and passing drawings", () => {
    const alignment = computeAlignment(entries, null);
    expect(alignment.strideMeasured).toBe(true);
    expect(alignment.strideX).toBeGreaterThan(TARGET_HEIGHT * 0.2);
    expect(alignment.strideX).toBeLessThan(TARGET_HEIGHT * 1.6);
  });

  it("does not mistake frontal foreshortening for a measured lateral stride", () => {
    expect(computeAlignment(entries, null, "walk", "side").strideMeasured).toBe(true);
    expect(computeAlignment(entries, null, "walk", "front").strideMeasured).toBe(false);
    expect(computeAlignment(entries, null, "walk", "back").strideMeasured).toBe(false);
  });

  it("never shrinks the cell, so approved frames keep their place", () => {
    const first = computeAlignment(entries, null);
    const wider = { ...first, cellWidth: first.cellWidth + 200 };
    const again = computeAlignment(entries, wider);
    expect(again.cellWidth).toBe(wider.cellWidth);
    const same = computeAlignment(entries, first);
    expect(same.transforms.f0!.key).toBe(first.transforms.f0!.key);
  });

  it("writes a contact sheet for review by eye when FOCUS_TEST_ARTIFACTS is set", async () => {
    const alignment = computeAlignment(entries, null);
    const sprites = await Promise.all(entries.map((entry, index) => renderSprite(extractions[index].cutout, entry.measure, alignment.transforms[entry.frameId]!, { width: alignment.cellWidth, height: alignment.cellHeight })));
    const sheet = await contactSheet(sprites, { width: alignment.cellWidth, height: alignment.cellHeight });
    expect((await sharp(sheet).metadata()).width).toBeGreaterThan(0);
    const dir = process.env.FOCUS_TEST_ARTIFACTS;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "aligned-contact-sheet.png"), sheet);
      const raws = await Promise.all(DRIFT.map(async (drift) => sharp(await walkerPng(drift.phase, drift)).resize(256, 384).png().toBuffer()));
      await writeFile(path.join(dir, "raw-drawings.png"), await sharp({ create: { width: 1024, height: 768, channels: 4, background: "#888888" } })
        .composite(raws.map((input, index) => ({ input, left: (index % 4) * 256, top: Math.floor(index / 4) * 384 }))).png().toBuffer());
    }
  });
});

describe("run and fight registration", () => {
  it("lifts a run's flight drawing off the ground line by its planned share", async () => {
    const base = entries[2];
    const grounded = computeAlignment([{ ...base, lift: 0 }], null, "run");
    const flying = computeAlignment([{ ...base, lift: 0.07 }], null, "run");
    expect(grounded.transforms.f2!.top - flying.transforms.f2!.top).toBe(Math.round(0.07 * TARGET_HEIGHT));
    // A run has no planted-feet stride to measure: it uses its own, longer figure.
    expect(flying.strideMeasured).toBe(false);
    expect(flying.strideX).toBe(Math.round(1.7 * TARGET_HEIGHT));
  });

  it("gives a fighting combo no travel", () => {
    const fight = computeAlignment(entries, null, "fight");
    expect(fight.strideX).toBe(0);
    expect(fight.strideMeasured).toBe(false);
  });

  it("keeps the torso still when an arm is thrown forward (a jab)", async () => {
    const plain = await walkerPng("left_passing");
    // The same figure with a long straight arm at shoulder height, pointing right.
    const jab = await sharp(plain).composite([{ input: await sharp({ create: { width: 260, height: 34, channels: 4, background: "#e0a26b" } }).png().toBuffer(), left: 512, top: 1536 - 120 - 780 }]).png().toBuffer();
    const [a, b] = await Promise.all([plain, jab].map((png) => extractSubject({ png, concept: "walker", flipbookId: "test", allowAlpha: false })));
    const torsoA = a.measure.crop.left + a.measure.torsoX;
    const torsoB = b.measure.crop.left + b.measure.torsoX;
    // Under 1% of body height: the jab doesn't drag the registration column.
    expect(Math.abs(torsoA - torsoB)).toBeLessThanOrEqual((a.measure.footY - a.measure.topY) * 0.01);
  });
});

describe("segmentation concepts", () => {
  it("falls back from a detailed phrase to its head noun, then to character", () => {
    expect(segmentationConcepts("girl with horse ears")).toEqual(["girl with horse ears", "girl", "character"]);
    expect(segmentationConcepts("boy in red hoodie")).toEqual(["boy in red hoodie", "boy", "character"]);
    expect(segmentationConcepts("cartoon fox")).toEqual(["cartoon fox", "fox", "character"]);
    expect(segmentationConcepts("character")).toEqual(["character"]);
  });
});

describe("key color spill", () => {
  // A 12×12 cut-out on a magenta key: blond inside, a magenta-tinted rim, transparent outside.
  const MAGENTA = [255, 0, 255] as const;
  const BLOND = [230, 200, 120] as const;
  const TINTED = [236, 150, 170] as const;
  const picture = (inside: readonly number[]) => {
    const size = 12;
    const data = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (edge === 0) continue;
      const color = edge === 1 ? TINTED : inside;
      data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
    }
    return data;
  };
  const at = (data: Buffer, x: number, y: number) => [...data.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 3)];

  it("takes the key's hue out of the rim and leaves the inside alone", () => {
    const data = picture(BLOND);
    despill(data, 12, 12, MAGENTA);
    const [r, g, b] = at(data, 1, 6);
    // The pink rim turns toward the blond fill: green no longer far below red and blue.
    expect(g).toBeGreaterThan(b);
    expect(r + g + b).toBeCloseTo(TINTED[0] + TINTED[1] + TINTED[2], -1);
    expect(at(data, 6, 6)).toEqual([...BLOND]);
  });

  it("pulls back a soft edge that un-blending pushed past the inside, away from the key", () => {
    const data = picture(BLOND);
    // A half-transparent rim pixel over-corrected to green.
    const i = (6 * 12 + 1) * 4;
    data[i] = 190; data[i + 1] = 235; data[i + 2] = 140; data[i + 3] = 160;
    despill(data, 12, 12, MAGENTA);
    const [r, g] = at(data, 1, 6);
    expect(g - r).toBeLessThan(45 - 20);
    // An opaque green edge is the drawing's own color: it stays.
    const opaque = picture(BLOND);
    opaque[i] = 190; opaque[i + 1] = 235; opaque[i + 2] = 140;
    despill(opaque, 12, 12, MAGENTA);
    expect(at(opaque, 1, 6)).toEqual([190, 235, 140]);
  });

  it("keeps a pink rim where the drawing really is pink inside", () => {
    const data = picture(TINTED);
    despill(data, 12, 12, MAGENTA);
    expect(at(data, 1, 6)).toEqual([...TINTED]);
  });
});

describe("computeTimedAlignment", () => {
  const measure = (cropHeight: number, footY: number, torsoX: number, coverage: number): Extraction["measure"] => ({ rawWidth: 1024, rawHeight: 1536, crop: { left: 300, top: 100, width: 400, height: cropHeight }, topY: 0, footY, torsoX, lowerSpan: 120, coverage, touchesEdge: false, histogram: Array.from({ length: 64 }, (_, index) => index === 0 ? 1 : 0), method: "key", multiple: false, backgroundUniformity: 1 });
  // Muse fills the image with every pose: the crouch is drawn 1.4× larger than the standing pose, so
  // nearly as tall in the image, with twice the area. Squash keeps the volume: its real height is 0.7.
  const entries = [
    { frameId: "s0" as const, version: "a", phase: "sample_0", relativeRootY: 0, measure: measure(1200, 1199, 200, 0.1), lift: 0 },
    { frameId: "s8" as const, version: "a", phase: "sample_8", relativeRootY: 0, measure: measure(1176, 1175, 190, 0.1 * 1.96), lift: 0 },
    { frameId: "s20" as const, version: "a", phase: "sample_20", relativeRootY: 0, measure: measure(1210, 1209, 210, 0.1), lift: 0.6 },
  ];
  const placed = (transform: { scale: number; left: number; top: number }, entry: (typeof entries)[number]) => ({
    foot: transform.top + (entry.measure.footY + 1) * transform.scale,
    height: (entry.measure.footY - entry.measure.topY + 1) * transform.scale,
    torso: transform.left + entry.measure.torsoX * transform.scale,
  });

  it("keeps one size by area and stands every drawing on one ground line, lifted as planned", () => {
    const alignment = computeTimedAlignment(entries);
    const [stand, crouch, apex] = entries.map((entry) => placed(alignment.transforms[entry.frameId]!, entry));
    expect(crouch.height / stand.height).toBeCloseTo(0.7, 2);
    expect(Math.abs(stand.height - alignment.targetHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(stand.foot - BASELINE_Y)).toBeLessThanOrEqual(1);
    expect(Math.abs(crouch.foot - BASELINE_Y)).toBeLessThanOrEqual(1);
    expect(Math.abs(apex.foot - (BASELINE_Y - 0.6 * stand.height))).toBeLessThanOrEqual(1);
    for (const at of [stand, crouch, apex]) expect(Math.abs(at.torso - alignment.cellWidth / 2)).toBeLessThanOrEqual(1);
  });

  it("shrinks the whole action just enough to keep the apex inside the cell", () => {
    const alignment = computeTimedAlignment(entries);
    const apex = placed(alignment.transforms.s20!, entries[2]);
    expect(alignment.targetHeight).toBeLessThan(TARGET_HEIGHT);
    expect(apex.foot - apex.height).toBeGreaterThanOrEqual(0);
    expect(alignment.cellHeight).toBe(CELL_HEIGHT);
  });
});

describe("filledArea", () => {
  it("counts what an outline encloses, not what is open to the page", () => {
    // A 10×10 ring of line one pixel wide, and a 3-pixel stroke beside it.
    const width = 20, alpha = new Uint8Array(width * 12);
    for (let y = 1; y <= 10; y++) for (let x = 1; x <= 10; x++) if (y === 1 || y === 10 || x === 1 || x === 10) alpha[y * width + x] = 255;
    for (let y = 4; y <= 6; y++) alpha[y * width + 15] = 255;
    expect(filledArea(alpha, width, { left: 1, top: 1, right: 10, bottom: 10 })).toBe(100);
    // An open ring (a gap in its line) leaves the inside open.
    alpha[1 * width + 5] = 0;
    expect(filledArea(alpha, width, { left: 1, top: 1, right: 10, bottom: 10 })).toBe(35);
    expect(filledArea(alpha, width, { left: 15, top: 4, right: 15, bottom: 6 })).toBe(3);
  });
});
