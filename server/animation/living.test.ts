import path from "node:path";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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
import { blinkAmount, bodyTime, cameraView, depthFrame, depthViews, framedSize, inpaint, livingFrame, pickPart, prepareLiving, spritePlacement, viewFrame, type LivingScene } from "./living";
import { probe } from "../ffmpeg";
import { runFfmpeg } from "../video/frames";
import { listProjects } from "../projects";
import { seamlessPlate } from "./reference-manager";
import { addPart, findLayers, pruneRenders, livingFiles, livingServices, livingToEditor, parseInventoryOutput, prepareBlink, removePart, renderLiving, separateLivingScene, uploadTrack } from "./living-pictures";

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

  it("holds the character's pose on twos while the floating pieces move every frame", () => {
    const frames = 48;
    expect([0, 1, 2, 3, 46, 47].map((frame) => bodyTime(frame, frames) * frames)).toEqual([0, 0, 2, 2, 46, 46]);
    const prepared = prepareLiving(scene);
    // Frames 2 and 3 share the pose: only what follows t (the sprites) can differ between them.
    const still = prepareLiving({ ...scene, particles: [], sky: null });
    expect(livingFrame(still, 3 / frames, bodyTime(3, frames)).equals(livingFrame(still, 2 / frames, bodyTime(2, frames)))).toBe(true);
    expect(livingFrame(prepared, 3 / frames, bodyTime(3, frames)).equals(livingFrame(prepared, 2 / frames, bodyTime(2, frames)))).toBe(false);
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

describe("framing", () => {
  it("crops to the shape asked for, inside the picture, with even sides", () => {
    expect(framedSize("original", 1537, 865)).toEqual({ width: 1536, height: 864 });
    expect(framedSize("9:16", 1536, 864)).toEqual({ width: 486, height: 864 });
    expect(framedSize("1:1", 1536, 864)).toEqual({ width: 864, height: 864 });
    expect(framedSize("9:16", 600, 2000)).toEqual({ width: 600, height: 1066 });
  });

  it("moves the camera inside the picture and back to where it started", () => {
    const source = { width: 1536, height: 864 }, crop = { width: 486, height: 864 };
    for (const camera of ["zoom", "pan"] as const) {
      expect(cameraView(camera, 1, source, crop, { x: 1500, y: 400 })).toEqual(cameraView(camera, 0, source, crop, { x: 1500, y: 400 }));
      for (const t of [0, 0.2, 0.5, 0.8]) {
        const view = cameraView(camera, t, source, crop, { x: 1500, y: 400 });
        expect(view.x).toBeGreaterThanOrEqual(0);
        expect(view.x + view.width).toBeLessThanOrEqual(source.width + 1e-6);
        expect(view.y + view.height).toBeLessThanOrEqual(source.height + 1e-6);
      }
    }
    // Halfway through a slow zoom, the camera is closest.
    expect(cameraView("zoom", 0.5, source, crop, { x: 700, y: 400 }).width).toBeLessThan(crop.width);
  });

  it("slides the character more than the background, and shows the scene where it was", () => {
    const source = { width: 400, height: 200 }, crop = { width: 400, height: 200 };
    const quarter = depthViews(0.25, source, crop, { x: 200, y: 100 });
    const start = depthViews(0, source, crop, { x: 200, y: 100 });
    expect(Math.abs(quarter.front.x - start.front.x)).toBeGreaterThan(Math.abs(quarter.back.x - start.back.x));
    expect(depthViews(1, source, crop, { x: 200, y: 100 })).toEqual(start);
    // A red character on gray, a blue scene behind it: where the character slid away, blue shows.
    const width = 40, height = 10;
    const rgba = Buffer.alloc(width * height * 4);
    const cover = new Float32Array(width * height);
    const plate = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const character = x >= 18 && x < 22;
      rgba.set(character ? [255, 0, 0, 255] : [128, 128, 128, 255], i * 4);
      cover[i] = character ? 1 : 0;
      plate.set([0, 0, 255], i * 3);
    }
    const views = { back: { x: 0, y: 0, width, height }, front: { x: 3, y: 0, width, height } };
    const out = depthFrame(rgba, cover, plate, width, height, views, width, height);
    const at = (x: number) => [...out.subarray((5 * width + x) * 4, (5 * width + x) * 4 + 3)];
    expect(at(15)).toEqual([255, 0, 0]);
    expect(at(20)).toEqual([0, 0, 255]);
    expect(at(30)).toEqual([128, 128, 128]);
  });

  it("shuts the eyes, holds them shut, opens them, once per loop", () => {
    expect(blinkAmount(0.5, 0.6, 0.1)).toBe(0);
    expect(blinkAmount(0.6125, 0.6, 0.1)).toBeCloseTo(0.5);
    expect(blinkAmount(0.65, 0.6, 0.1)).toBe(1);
    expect(blinkAmount(0.6875, 0.6, 0.1)).toBeCloseTo(0.5);
    expect(blinkAmount(1.65, 0.6, 0.1)).toBe(1);
  });

  it("copies a still crop pixel for pixel", () => {
    const width = 8, height = 4;
    const rgba = Buffer.from(Array.from({ length: width * height * 4 }, (_, i) => i % 251));
    const view = cameraView("still", 0, { width, height }, { width: 4, height: 4 }, { x: 6, y: 2 });
    const out = viewFrame(rgba, width, height, view, 4, 4);
    expect([...out.subarray(0, 4)]).toEqual([...rgba.subarray(4 * 4, 4 * 4 + 4)]);
  });
});

describe("picking a part", () => {
  it("follows a shaded part to its outline and closes the thin lines inside it", () => {
    const width = 60, height = 40;
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      // Left: a gray part shaded from light to dark; a black outline at x = 30; right: navy.
      const value = x < 30 ? Math.round(200 - x * 1.5) : 0;
      rgb[at] = x === 30 ? 10 : x > 30 ? 30 : value;
      rgb[at + 1] = x === 30 ? 10 : x > 30 ? 40 : value;
      rgb[at + 2] = x === 30 ? 10 : x > 30 ? 110 : value + 5;
    }
    // A one-pixel strand line inside the gray part.
    for (let x = 5; x < 20; x++) { const at = (20 * width + x) * 3; rgb[at] = rgb[at + 1] = rgb[at + 2] = 60; }
    const part = pickPart(rgb, width, height, 3, 3, null)!;
    expect(part[3 * width + 28]).toBe(255);
    expect(part[3 * width + 40]).toBe(0);
    expect(part[20 * width + 10]).toBe(255);
    const inside = new Uint8Array(width * height);
    expect(pickPart(rgb, width, height, 3, 3, inside)).toBeNull();
  });
});

describe("a repeating plate", () => {
  it("fades a seam between unlike ends instead of cutting it, and still wraps", async () => {
    // The worst case: the strip ends black and starts white.
    const width = 1536, height = 64;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.fill(x < width / 2 ? 255 : 0, (y * width + x) * 3, (y * width + x) * 3 + 3);
    const strip = await seamlessPlate(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
    const { data, info } = await sharp(strip).raw().toBuffer({ resolveWithObject: true });
    let steepest = 0;
    // Only the seam: the overlap the strip starts with (12% of the plate); the plate's own middle edge stays as drawn.
    for (let y = 0; y < info.height; y++) for (let x = 1; x < Math.round(width * 0.12); x++) steepest = Math.max(steepest, Math.abs(data[(y * info.width + x) * 3] - data[(y * info.width + x - 1) * 3]));
    // A hard cut would jump by 255 between two neighbors.
    expect(steepest).toBeLessThan(60);
    // The wrap: the last column leads into the first.
    expect(Math.abs(data[0] - data[(info.width - 1) * 3])).toBeLessThan(60);
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
      // An "eye": a small spot near the top of the drawing.
      if (concept === "eye") return [mask((_x, y, i) => drawn(i) && y >= top + 30 && y < top + 36)];
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

  it("renders a portrait crop with a slow zoom", async () => {
    const render = await renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, camera: "zoom", aspect: "9:16" });
    const facts = await probe(path.join(livingFiles(imageId).renderDir(render.key), "focus-animation.mp4"));
    const video = facts.streams.find((stream) => stream.codec_type === "video")!;
    expect(video.width! / video.height!).toBeCloseTo(9 / 16, 1);
    expect([render.width, render.height]).toEqual([video.width, video.height]);
  }, 60_000);

  it("adds a part picked with a click, renders it, and removes it", async () => {
    await expect(addPart(imageId, { x: 2, y: 2 })).rejects.toMatchObject({ code: "living_part_outside" });
    const { image, flat } = await getCharacterImage(imageId);
    const { data } = await sharp(flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const body = await sharp(livingFiles(imageId).mask("walker")).extractChannel(0).raw().toBuffer();
    // The walker's shirt: the blue it is drawn in.
    let spot = -1;
    for (let i = 0; i < body.length && spot < 0; i++) if (body[i] >= 128 && data[i * 3 + 2] > 180 && data[i * 3] < 90) spot = i;
    const added = await addPart(imageId, { x: spot % image.width, y: Math.floor(spot / image.width) });
    const part = added.layers.at(-1)!;
    expect(part).toMatchObject({ kind: "flowing", custom: true });
    const render = await renderLiving(imageId, { ...defaultLivingRequest(added), durationSeconds: 2 });
    expect(render.frames).toBe(48);
    const removed = await removePart(imageId, part.id);
    expect(removed.layers.some((layer) => layer.id === part.id)).toBe(false);
    await expect(removePart(imageId, "walker")).rejects.toMatchObject({ code: "living_layer_unknown" });
    const again = await addPart(imageId, { x: spot % image.width, y: Math.floor(spot / image.width) });
    expect(again.layers.at(-1)!.id).not.toBe(part.id);
    inventory = await removePart(imageId, again.layers.at(-1)!.id);
  }, 60_000);

  it("reports progress while it renders, and none when the render is cached", async () => {
    const seen: number[] = [];
    const request = { ...defaultLivingRequest(inventory), durationSeconds: 2 as const, camera: "pan" as const };
    await renderLiving(imageId, request, undefined, undefined, (fraction) => seen.push(fraction));
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.every((value, index) => index === 0 || value >= seen[index - 1])).toBe(true);
    expect(seen.at(-1)).toBeGreaterThanOrEqual(0.9);
    const again: number[] = [];
    await renderLiving(imageId, request, undefined, undefined, (fraction) => again.push(fraction));
    expect(again).toEqual([]);
  }, 60_000);

  it("separates the character from a plain background for free, then renders with depth", async () => {
    await expect(renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, camera: "depth" })).rejects.toMatchObject({ code: "living_scene_missing" });
    let drawn = 0;
    livingServices.scene = async () => { drawn++; throw new Error("no drawing expected on a plain background"); };
    inventory = await separateLivingScene(imageId);
    expect(inventory.scene).toBe(true);
    expect(drawn).toBe(0);
    const render = await renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, camera: "depth" });
    expect(render.frames).toBe(48);
  }, 60_000);

  it("blinks with the eyes of a closed-eyes drawing, nothing else from it", async () => {
    await expect(renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, blink: true })).rejects.toMatchObject({ code: "living_blink_missing" });
    // The "closed eyes" drawing: the whole picture painted green, so any pixel taken from it shows.
    const { image } = await getCharacterImage(imageId);
    livingServices.closedEyes = async () => ({ png: await sharp({ create: { width: image.width * 2, height: image.height * 2, channels: 3, background: "#00ff00" } }).png().toBuffer(), width: image.width * 2, height: image.height * 2 });
    inventory = await prepareBlink(imageId);
    expect(inventory.blink).toBe(true);
    const { data: picture } = await sharp(livingFiles(imageId).blink).raw().toBuffer({ resolveWithObject: true });
    const alpha = await sharp(livingFiles(imageId).blinkMask).extractChannel(0).raw().toBuffer();
    let changedOutside = 0, eye = 0;
    const { data: original } = await sharp((await getCharacterImage(imageId)).flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] === 0 && picture[i * 3] !== original[i * 3]) changedOutside++;
      if (alpha[i] >= 200) eye++;
    }
    expect(eye).toBeGreaterThan(0);
    expect(changedOutside).toBe(0);
    const render = await renderLiving(imageId, { ...defaultLivingRequest(inventory), durationSeconds: 2, blink: true });
    expect(render.frames).toBe(48);
  }, 60_000);

  it("refuses a motion a layer can't take and a layer that isn't there", async () => {
    const base = defaultLivingRequest(inventory);
    await expect(renderLiving(imageId, { ...base, layers: [{ id: "sky", motion: "breathe", strength: 1 }] })).rejects.toMatchObject({ code: "living_motion_invalid" });
    await expect(renderLiving(imageId, { ...base, layers: [{ id: "cape", motion: "sway", strength: 1 }] })).rejects.toMatchObject({ code: "living_layer_unknown" });
  });

  it("keeps only the newest renders of a picture, never the one just made nor one still being drawn", async () => {
    const files = livingFiles(imageId);
    await rm(path.dirname(files.renderDir("x")), { recursive: true, force: true });
    const keys = ["a", "b", "c", "d", "e"].map((letter) => letter.repeat(16));
    for (const [index, key] of keys.entries()) {
      await mkdir(files.renderDir(key), { recursive: true });
      await writeFile(files.render(key), "{}");
      const at = new Date(Date.now() - (keys.length - index) * 60_000);
      await utimes(files.render(key), at, at);
    }
    const drawing = "f".repeat(16);
    await mkdir(files.renderDir(drawing), { recursive: true });
    // `a` is the oldest but is the one just made: it stays, with the two newest of the rest.
    await pruneRenders(imageId, keys[0], 3);
    expect((await readdir(path.dirname(files.renderDir("x")))).sort()).toEqual([keys[0], keys[3], keys[4], drawing].sort());
  });
});
