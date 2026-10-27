import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { WALK_POSES, type FrameId } from "../../shared/flipbook";
import { AppError } from "../errors";
import { DRIFT, walkerPng, walkerPose } from "./__fixtures__/walker";
import { BASELINE_Y, CELL_HEIGHT, TARGET_HEIGHT, computeAlignment, extractSubject, renderSprite, segmentation, type AlignInput, type Extraction } from "./frame-alignment";
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
