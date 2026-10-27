import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultLivingRequest, type LivingInventory } from "../../shared/living";
import type { CharacterAnalysis } from "../../shared/flipbook";
import { AppError } from "../errors";
import { walkerPng } from "./__fixtures__/walker";
import { services } from "./flipbooks";
import { segmentation } from "./frame-alignment";
import { getCharacterImage, ingestCharacterImage } from "./image-input";
import { inpaint, livingFrame, prepareLiving, spritePlacement, type LivingScene } from "./living";
import { probe } from "../ffmpeg";
import { runFfmpeg } from "../video/frames";
import { listProjects } from "../projects";
import { findLayers, livingFiles, livingServices, livingToEditor, parseInventoryOutput, renderLiving, uploadTrack } from "./living-pictures";

// "Animate as is": the engine on small synthetic pictures, then the service
// with Muse Spark and SAM replaced by deterministic fakes. No network, no credits.

describe("the engine", () => {
  const width = 96, height = 64;
  const block = (left: number, top: number, w: number, h: number) => {
    const mask = new Uint8Array(width * height);
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) mask[y * width + x] = 255;
    return mask;
  };
  // A textured picture: every pixel differs, so any move shows.
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    rgb[at] = (x * 7) % 256; rgb[at + 1] = (y * 11) % 256; rgb[at + 2] = (x * y) % 256;
  }
  const body = block(40, 30, 16, 34);
  const hair = block(44, 14, 8, 16);
  const scene: LivingScene = {
    width, height, rgb,
    body: { mask: body, strength: 1 },
    flows: [{ mask: hair, strength: 1 }],
    particles: [{ masks: [block(4, 4, 4, 3), block(80, 50, 3, 3)], motion: "drift", strength: 1 }],
    sky: null,
    wind: 1,
  };

  it("fills holes from their surroundings and keeps every known pixel", () => {
    const flat = Buffer.alloc(32 * 32 * 3, 90);
    const hole = new Uint8Array(32 * 32);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) { hole[y * 32 + x] = 1; flat[(y * 32 + x) * 3] = 255; }
    const out = inpaint(flat, hole, 32, 32);
    expect([...out.subarray((15 * 32 + 15) * 3, (15 * 32 + 15) * 3 + 3)]).toEqual([90, 90, 90]);
    expect(out[0]).toBe(90);
  });

  it("closes the loop exactly and leaves what nothing moves untouched", () => {
    const prepared = prepareLiving(scene);
    expect(livingFrame(prepared, 0).equals(livingFrame(prepared, 1))).toBe(true);
    // Far from the body, the hair and the two sprites' paths: the upload's own pixels, in every frame.
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const frame = livingFrame(prepared, t);
      const at = 35 * width + 5;
      expect([...frame.subarray(at * 4, at * 4 + 3)]).toEqual([...rgb.subarray(at * 3, at * 3 + 3)]);
    }
  });

  it("bends a flowing part more at its tip than at its root", () => {
    const prepared = prepareLiving({ ...scene, body: { mask: body, strength: 0 }, particles: [] });
    const changed = (x: number, y: number) => {
      let total = 0;
      for (const t of [0.125, 0.375, 0.625, 0.875]) {
        const frame = livingFrame(prepared, t);
        const at = y * width + x;
        for (let c = 0; c < 3; c++) total += Math.abs(frame[at * 4 + c] - rgb[at * 3 + c]);
      }
      return total;
    };
    // The root touches the body at the bottom of the strip; the tip is its top.
    expect(changed(48, 15)).toBeGreaterThan(changed(48, 29));
  });

  it("drifts sprites across the frame and back to where they started", () => {
    const sprite = { x: 50, y: 20, radius: 4, motion: "drift" as const, strength: 1, laps: 1, phase: 0.3 };
    const start = spritePlacement(sprite, 0, width, height, 1);
    expect(start.x).toBeCloseTo(50);
    expect(start.y).toBeCloseTo(20);
    const end = spritePlacement(sprite, 1, width, height, 1);
    expect(end.x).toBeCloseTo(start.x);
    expect(end.y).toBeCloseTo(start.y);
    // Halfway it is somewhere else, still inside the wrapped span.
    const half = spritePlacement(sprite, 0.5, width, height, 1);
    expect(Math.abs(half.x - start.x)).toBeGreaterThan(10);
    expect(half.x).toBeGreaterThanOrEqual(-6);
    expect(half.x).toBeLessThan(width + 6);
  });
});

describe("naming what's in the picture", () => {
  it("keeps one character, plain unique names, and known kinds", () => {
    const reading = parseInventoryOutput(JSON.stringify({
      wind: "sideways",
      objects: [
        { name: "Girl", kind: "character" },
        { name: "boy", kind: "character" },
        { name: "hair", kind: "flowing" },
        { name: "hair", kind: "flowing" },
        { name: "leaf", kind: "floating" },
        { name: "rain", kind: "weather" },
        { name: "runners", kind: "still" },
      ],
    }));
    expect(reading.wind).toBe("right");
    expect(reading.objects).toEqual([
      { name: "girl", kind: "character" },
      { name: "hair", kind: "flowing" },
      { name: "leaf", kind: "floating" },
      { name: "runners", kind: "still" },
    ]);
  });

  it("refuses unreadable output", () => {
    expect(() => parseInventoryOutput("not json")).toThrow(AppError);
  });
});

describe("the service", () => {
  let work: string;
  let imageId: string;
  let named = 0;
  const analysis: CharacterAnalysis = {
    characterCount: 1, subject: "walker", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain",
    style: "flat vector", hair: "short red hair", clothing: "blue shirt", accessories: [], palette: ["#2e86de"], proportions: "big head", requestedAction: "none",
  };

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "focus-living-"));
    process.env.FOCUS_DATA_DIR = path.join(work, "data");
    process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK = "true";
    const png = await walkerPng("left_passing");
    const image = await ingestCharacterImage({ body: Readable.toWeb(Readable.from(png)) as ReadableStream<Uint8Array>, fileName: "walker.png" });
    imageId = image.id;
    services.describe = async () => ({ analysis, summary: "A walker.", setting: null, ideas: [] });
    livingServices.name = async () => {
      named++;
      return { wind: "left", objects: [{ name: "walker", kind: "character" }, { name: "hair", kind: "flowing" }, { name: "leaf", kind: "floating" }, { name: "sky", kind: "sky" }, { name: "tree", kind: "still" }] };
    };
    // SAM: the drawing's own top as its hair, plus a far-away "hair" that isn't its; two leaves; the top band as sky.
    segmentation.segment = async ({ png: picture, width, height, concept }) => {
      const { data } = await sharp(picture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const drawn = (i: number) => data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2] < 600;
      let top = height;
      for (let i = 0; i < width * height; i++) if (drawn(i)) top = Math.min(top, Math.floor(i / width));
      const mask = (pick: (x: number, y: number, i: number) => boolean) => {
        const alpha = new Uint8Array(width * height);
        let area = 0, left = width, right = 0, up = height, down = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!pick(x, y, i)) continue;
          alpha[i] = 255; area++;
          left = Math.min(left, x); right = Math.max(right, x + 1); up = Math.min(up, y); down = Math.max(down, y + 1);
        }
        return { objectId: concept, alpha, area, box: { left, top: up, right, bottom: down }, confidence: 1 };
      };
      if (concept === "hair") return [mask((_x, y, i) => drawn(i) && y < top + 40), mask((x, y) => x < 20 && y > height - 20)];
      if (concept === "leaf") return [mask((x, y) => x >= 4 && x < 10 && y >= 4 && y < 10), mask((x, y) => x >= width - 12 && x < width - 6 && y >= 8 && y < 14)];
      if (concept === "sky") return [mask((_x, y, i) => y < height * 0.3 && !drawn(i))];
      return [];
    };
  });

  afterAll(async () => {
    segmentation.segment = null;
    await rm(work, { recursive: true, force: true });
  });

  let inventory: LivingInventory;

  it("finds the character, its own hair, the leaves and the sky, once", async () => {
    inventory = await findLayers(imageId);
    expect(inventory.wind).toBe("left");
    expect(inventory.layers.map((layer) => [layer.id, layer.kind, layer.pieces])).toEqual([
      ["walker", "character", 1],
      ["hair", "flowing", 1],
      ["leaf", "floating", 2],
      ["sky", "sky", 1],
    ]);
    expect(inventory.stills).toEqual(["tree"]);
    // The far-away "hair" belongs to someone else: it isn't in the layer.
    const { image } = await getCharacterImage(imageId);
    const hair = await sharp(livingFiles(imageId).mask("hair")).extractChannel(0).raw().toBuffer();
    expect(hair[(image.height - 5) * image.width + 5]).toBe(0);
    await findLayers(imageId);
    expect(named).toBe(1);
  });

  it("renders a verified, seamless MP4 and GIF, and reuses them for the same choices", async () => {
    const request = { ...defaultLivingRequest(inventory), durationSeconds: 2 as const };
    const render = await renderLiving(imageId, request);
    expect(render.frames).toBe(48);
    expect(render.files.map((file) => file.name)).toEqual(["focus-animation.mp4", "focus-animation.gif"]);
    const mp4 = path.join(livingFiles(imageId).renderDir(render.key), "focus-animation.mp4");
    expect((await stat(mp4)).size).toBeGreaterThan(0);
    expect((await readFile(path.join(livingFiles(imageId).renderDir(render.key), "focus-animation.gif"))).subarray(0, 6).toString()).toBe("GIF89a");
    const again = await renderLiving(imageId, request);
    expect(again).toEqual(render);
  }, 60_000);

  it("lays an ambience under whole loops repeated to the length asked for", async () => {
    const request = { ...defaultLivingRequest(inventory), durationSeconds: 2 as const, lengthSeconds: 10 as const, audio: { kind: "ambience" as const, ambience: "leaves" as const } };
    const render = await renderLiving(imageId, request);
    expect(render.hasAudio).toBe(true);
    expect(render.durationSeconds).toBe(10);
    expect(render.frames).toBe(240);
    const facts = await probe(path.join(livingFiles(imageId).renderDir(render.key), "focus-animation.mp4"));
    const audio = facts.streams.find((stream) => stream.codec_type === "audio");
    expect(audio?.codec_name).toBe("aac");
    expect(Number(audio?.duration)).toBeCloseTo(10, 0);
  }, 60_000);

  it("takes an uploaded track, refuses a file with no sound, and forgets a replaced one", async () => {
    const wav = path.join(work, "tone.wav");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", wav]);
    const stream = async (file: string) => Readable.toWeb(Readable.from(await readFile(file))) as ReadableStream<Uint8Array>;
    const track = await uploadTrack(imageId, await stream(wav), undefined, "tone.wav");
    expect(track.durationSeconds).toBeCloseTo(3, 0);
    const render = await renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, audio: { kind: "upload", version: track.version } });
    expect(render.hasAudio).toBe(true);
    expect(render.durationSeconds).toBe(2);
    await expect(uploadTrack(imageId, Readable.toWeb(Readable.from(Buffer.from("not audio at all"))) as ReadableStream<Uint8Array>, undefined, "x.mp3")).rejects.toMatchObject({ code: "audio_invalid" });
    const next = await uploadTrack(imageId, await stream(wav), undefined, "again.wav");
    await expect(renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 4, audio: { kind: "upload", version: track.version } })).rejects.toMatchObject({ code: "living_audio_missing" });
    expect(next.version).not.toBe(track.version);
  }, 60_000);

  it("opens the finished video in the editor and saves it as a project when signed in", async () => {
    const render = await renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, audio: { kind: "ambience", ambience: "wind" } });
    const owner = "7d0c4f7e-1d7a-4bb4-9a4e-6f0d2a5c9b11";
    const { video, saved } = await livingToEditor(imageId, render.key, owner);
    expect(saved).toBe(true);
    expect(video.normalized.frameCount).toBe(48);
    expect((await listProjects(owner)).map((project) => project.videoId)).toContain(video.id);
    await expect(livingToEditor(imageId, "0000000000000000", null)).rejects.toMatchObject({ code: "media_not_found" });
  }, 60_000);

  it("limits only renders that actually run", async () => {
    let admitted = 0;
    const admit = () => { admitted++; };
    const request = { ...defaultLivingRequest(inventory), durationSeconds: 6 as const };
    await renderLiving(imageId, request, undefined, admit);
    await renderLiving(imageId, request, undefined, admit);
    expect(admitted).toBe(1);
    const refused = () => { throw new AppError("rate_limited", 429, "Too many."); };
    await expect(renderLiving(imageId, { ...request, wind: "right" }, undefined, refused)).rejects.toMatchObject({ code: "rate_limited" });
  }, 60_000);

  it("refuses a motion a layer can't take and a layer that isn't there", async () => {
    const base = defaultLivingRequest(inventory);
    await expect(renderLiving(imageId, { ...base, layers: [{ id: "sky", motion: "breathe", strength: 1 }] })).rejects.toMatchObject({ code: "living_motion_invalid" });
    await expect(renderLiving(imageId, { ...base, layers: [{ id: "cape", motion: "sway", strength: 1 }] })).rejects.toMatchObject({ code: "living_layer_unknown" });
  });
});
