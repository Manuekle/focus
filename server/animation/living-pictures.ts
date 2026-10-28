import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  LIVING_KINDS,
  LivingInventorySchema,
  LivingRenderSchema,
  LivingTrackSchema,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MOTIONS_FOR,
  videoSeconds,
  type Ambience,
  type LivingInventory,
  type LivingKind,
  type LivingLayer,
  type LivingPartRequest,
  type LivingRender,
  type LivingRequest,
  type LivingTrack,
} from "../../shared/living";
import { ConceptSchema } from "../../shared/schemas";
import { AppError } from "../errors";
import { probe } from "../ffmpeg";
import { Limiter, metaClient, metaError, plannerLimiter, requireMetaConfig, withRetry } from "../ai/meta";
import { recordUsage } from "../ai/usage";
import { activeWorkCount, type PaidWorkGate } from "../jobs";
import type { VideoAsset } from "../../shared/schemas";
import { projectForVideo } from "../projects";
import { ingestVideo } from "../videos";
import { verifyOutput } from "../video/compositor";
import { runFfmpeg, writeFrames } from "../video/frames";
import { parseGif } from "./export";
import { readUploadedImage } from "./flipbooks";
import { extractSubject, segmentation } from "./frame-alignment";
import { getCharacterImage, imageFiles } from "./image-input";
import { generateImage } from "./muse-image";
import { LIVING_FPS, blurField, bodyTime, cameraView, depthFrame, depthViews, focusOf, framedSize, inpaint, livingLayers, pickPart, prepareLiving, viewFrame, type LivingScene } from "./living";
import { drawScenePlate, growMask, keepAroundSubject, subjectMask } from "./reference-manager";
import { readJsonFile, writeAtomic } from "./store";

// "Animate as is", the service around the engine in living.ts. Finding what
// can move is paid: one Muse Spark look at the upload to name its parts, then
// one SAM frame per part. Rendering is free and deterministic: the same
// choices give the same verified MP4 and GIF, kept beside the upload.

// ── Naming what's in the picture ───────────────────────────────────────────

export const INVENTORY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["wind", "objects"],
  properties: {
    wind: { type: "string", enum: ["left", "right"] },
    objects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind"],
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: [...LIVING_KINDS, "still"] },
        },
      },
    },
  },
} as const;

export const INVENTORY_INSTRUCTIONS = `You look at an illustration that will be animated exactly as it is: nothing is redrawn, only its own pixels move. Name what is in it for an image segmentation model that finds things by short, plain English nouns. You never draw and never execute anything; you return JSON. Write every name in English, singular, lowercase.

Return:
- objects: at most 8, the most important first.
  - kind "character": the main character, exactly one entry. name: the plain noun the segmentation model can find ("girl", "boy", "woman", "cat", "robot"), 1–2 words.
  - kind "flowing": a part of the main character that sways with wind or motion: hair (ponytails included), cape, scarf, ribbon, skirt, coat, tail. One entry per part, name a single plain noun ("hair", "cape", "scarf", "ribbon", "skirt").
  - kind "floating": many small separate things in the air: leaves, petals, snowflakes, feathers, bubbles, sparks, confetti. name: the singular noun ("leaf", "petal").
  - kind "sky": the open sky, name "sky", only when sky is visible.
  - kind "still": anything else worth naming that should stay as it is (other people, buildings, the ground, furniture), 1–3 words.
- wind: which way things already blow in the picture (streaming hair, flying leaves), from the viewer's point of view; "right" when nothing shows it.`;

export type InventoryReading = { readonly wind: "left" | "right"; readonly objects: readonly { readonly name: string; readonly kind: LivingKind | "still" }[] };

/** Pure: model text into a clean list: one character at most, plain unique names, at most 8. */
export function parseInventoryOutput(text: string): InventoryReading {
  let raw: { wind?: unknown; objects?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("inventory_invalid", 502, "Muse Spark returned an unreadable list of what’s in your picture. Try again.");
  }
  const seen = new Set<string>();
  const objects: { name: string; kind: LivingKind | "still" }[] = [];
  let characters = 0;
  for (const entry of Array.isArray(raw.objects) ? raw.objects : []) {
    if (!entry || typeof entry !== "object") continue;
    const { name, kind } = entry as { name?: unknown; kind?: unknown };
    if (typeof kind !== "string" || ![...LIVING_KINDS, "still"].includes(kind)) continue;
    const concept = ConceptSchema.safeParse(typeof name === "string" ? name.slice(0, 60) : "");
    if (!concept.success || seen.has(concept.data)) continue;
    if (kind === "character" && characters++ > 0) continue;
    seen.add(concept.data);
    objects.push({ name: concept.data, kind: kind as LivingKind | "still" });
    if (objects.length === 8) break;
  }
  return { wind: raw.wind === "left" ? "left" : "right", objects };
}

export async function nameLayers(input: { readonly imagePng: Buffer; readonly imageId: string; readonly signal?: AbortSignal }): Promise<InventoryReading> {
  const config = requireMetaConfig();
  const client = metaClient(config);
  const started = Date.now();
  try {
    const response = await plannerLimiter.run(() =>
      withRetry(
        () =>
          client.responses.create(
            {
              model: config.plannerModel,
              instructions: INVENTORY_INSTRUCTIONS,
              reasoning: { effort: "low" },
              input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${input.imagePng.toString("base64")}`, detail: "high" }] }],
              text: { format: { type: "json_schema", name: "living_layers", strict: true, schema: INVENTORY_JSON_SCHEMA as unknown as Record<string, unknown> } },
            },
            { signal: input.signal },
          ),
        { signal: input.signal },
      ),
    );
    await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: true, flipbookId: input.imageId, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, durationMs: Date.now() - started });
    if (response.status !== "completed" || !response.output_text) {
      throw new AppError("inventory_incomplete", 502, "Muse Spark didn’t finish looking at your picture. Try again.");
    }
    return parseInventoryOutput(response.output_text);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await recordUsage({ model: config.plannerModel, kind: "flipbook_analyze", cached: false, ok: false, flipbookId: input.imageId, error: String(error), durationMs: Date.now() - started });
    }
    throw metaError(error, "finding what can move");
  }
}

/** Replaceable in tests: no Muse Spark or Muse Image call ever runs. */
/** The same picture with the eyes shut: one Muse Image edit, at the picture's own aspect. */
export async function drawClosedEyes(input: { readonly sourceFlat: Buffer; readonly flipbookId: string; readonly signal?: AbortSignal }) {
  return generateImage({
    prompt: [
      "Redraw Image 1 with the character's eyes closed, as in the middle of a natural blink: both eyelids fully shut, lashes drawn in the illustration's own style.",
      "Change nothing else: same face, expression, mouth, hair, colors, line art, lighting, framing and background, everything else identical.",
    ].join("\n"),
    references: [{ png: input.sourceFlat, role: "the illustration to edit." }],
    action: "edit",
    flipbookId: input.flipbookId,
    signal: input.signal,
  });
}

export const livingServices = { name: nameLayers, scene: drawScenePlate, closedEyes: drawClosedEyes };

// ── Files ──────────────────────────────────────────────────────────────────

export function livingFiles(imageId: string) {
  const dir = path.join(path.dirname(imageFiles(imageId).look), "living");
  return {
    dir,
    inventory: path.join(dir, "layers.json"),
    /** One mask per layer (all its pieces), and per piece for floating things. */
    mask: (layerId: string, piece?: number) => path.join(dir, piece === undefined ? `${layerId}.png` : `${layerId}-${piece}.png`),
    renderDir: (key: string) => path.join(dir, "renders", key),
    render: (key: string) => path.join(dir, "renders", key, "render.json"),
    /** The uploaded track, normalized; one per upload, replaced by the next. */
    track: path.join(dir, "track.json"),
    trackAudio: (version: string) => path.join(dir, "audio", `${version}.m4a`),
    /** The picture with the character taken out, for the "depth" camera. */
    scene: path.join(dir, "scene.png"),
    /** The picture with the eyes shut where `blinkMask` says, for blinking. */
    blink: path.join(dir, "blink.png"),
    blinkMask: path.join(dir, "blink-mask.png"),
  };
}

export function readInventory(imageId: string): Promise<LivingInventory | null> {
  return readJsonFile(livingFiles(imageId).inventory, (value) => LivingInventorySchema.parse(value));
}

async function writeMask(file: string, mask: Uint8Array, width: number, height: number): Promise<void> {
  await writeAtomic(file, await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } }).png().toBuffer());
}

async function readMask(file: string): Promise<Uint8Array> {
  return Uint8Array.from(await sharp(file).extractChannel(0).raw().toBuffer());
}

// ── Finding the layers ─────────────────────────────────────────────────────

/** Floating things are small: a mask larger than this share is something else. */
const FLOATING_MAX_SHARE = 0.03;
/** The sky is large: smaller sky masks are gaps, not sky. */
const SKY_MIN_SHARE = 0.03;
/** Sprites per layer, the largest kept. */
const MAX_PIECES = 80;

const slug = (name: string) => name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "layer";

/**
 * What in the upload can move, found once and kept: Muse Spark names the
 * parts, SAM finds each one. A flowing part counts only where it belongs to
 * the character; floating things are small; the sky is large. A part SAM
 * can't find is dropped, never guessed.
 */
export async function findLayers(imageId: string, gate?: PaidWorkGate): Promise<LivingInventory> {
  const cached = await readInventory(imageId);
  if (cached) return cached;
  const look = await readUploadedImage(imageId, gate);
  const { image, png, flat } = await getCharacterImage(imageId);
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 + 8 });
  const flatPng = await readFile(flat);
  const reading = await livingServices.name({ imagePng: flatPng, imageId: image.id });
  const { width, height } = image;
  const total = width * height;
  const files = livingFiles(image.id);
  await rm(files.dir, { recursive: true, force: true });
  await mkdir(files.dir, { recursive: true });

  const layers: LivingLayer[] = [];
  const stills = reading.objects.filter((object) => object.kind === "still").map((object) => object.name);
  const ids = new Set<string>();
  const add = async (name: string, kind: LivingKind, masks: Uint8Array[]) => {
    if (!masks.length) return;
    let id = slug(name);
    for (let n = 2; ids.has(id); n++) id = `${slug(name).slice(0, 36)}-${n}`;
    ids.add(id);
    const union = new Uint8Array(total);
    for (const mask of masks) for (let i = 0; i < total; i++) if (mask[i] > union[i]) union[i] = mask[i];
    let covered = 0;
    for (const value of union) if (value >= 128) covered++;
    await writeMask(files.mask(id), union, width, height);
    if (kind === "floating") await Promise.all(masks.map((mask, piece) => writeMask(files.mask(id, piece), mask, width, height)));
    layers.push({ id, name, kind, pieces: masks.length, share: covered / total, custom: false });
  };

  // The character: the same cut-out the flipbook uses, with its fallbacks.
  const character = reading.objects.find((object) => object.kind === "character");
  let body: Uint8Array | null = null;
  try {
    const { cutout, measure } = await extractSubject({ png: await readFile(png), concept: character?.name ?? look.analysis.subject, flipbookId: image.id, allowAlpha: image.hasAlpha });
    body = await subjectMask(cutout, measure);
    await add(character?.name ?? look.analysis.subject, "character", [body]);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }

  const near = body ? growMask(body, width, height, Math.round(Math.max(width, height) * 0.01)) : null;
  for (const object of reading.objects) {
    if (object.kind === "character" || object.kind === "still" || !segmentation.segment) continue;
    let masks: Uint8Array[];
    try {
      masks = (await segmentation.segment({ png: flatPng, width, height, concept: object.name, flipbookId: image.id })).map((mask) => mask.alpha);
    } catch (error) {
      if (error instanceof AppError && error.code === "canceled") throw error;
      console.warn(`[focus] living: SAM couldn’t find “${object.name}”`, error instanceof Error ? error.message : error);
      continue;
    }
    const area = (mask: Uint8Array) => mask.reduce((sum, value) => sum + (value >= 128 ? 1 : 0), 0);
    if (object.kind === "flowing") {
      // Only the character's own: most of the mask lies on or right beside it.
      const own = masks.filter((mask) => {
        const size = area(mask);
        if (!near) return size < total * 0.3;
        let inside = 0;
        for (let i = 0; i < total; i++) if (mask[i] >= 128 && near[i] >= 128) inside++;
        return size > 0 && inside / size >= 0.5;
      });
      if (own.length) {
        const union = new Uint8Array(total);
        for (const mask of own) for (let i = 0; i < total; i++) if (mask[i] > union[i]) union[i] = mask[i];
        await add(object.name, "flowing", [union]);
      }
    } else if (object.kind === "floating") {
      const pieces = masks.map((mask) => ({ mask, size: area(mask) })).filter((entry) => entry.size > 8 && entry.size < total * FLOATING_MAX_SHARE).sort((a, b) => b.size - a.size).slice(0, MAX_PIECES);
      await add(object.name, "floating", pieces.map((entry) => entry.mask));
    } else if (object.kind === "sky" && !layers.some((layer) => layer.kind === "sky")) {
      const large = masks.filter((mask) => area(mask) >= total * SKY_MIN_SHARE);
      if (large.length) {
        const union = new Uint8Array(total);
        for (const mask of large) for (let i = 0; i < total; i++) if (mask[i] > union[i]) union[i] = mask[i];
        await add(object.name, "sky", [union]);
      }
    }
  }

  const inventory: LivingInventory = { imageId: image.id, wind: reading.wind, layers, stills: stills.slice(0, 12), scene: false, blink: false, createdAt: new Date().toISOString() };
  await writeAtomic(files.inventory, JSON.stringify(inventory));
  return inventory;
}

// ── The scene behind the character ─────────────────────────────────────────

/**
 * The picture with the character taken out, so the "depth" camera can slide
 * the character over it. A transparent or plain background is filled from
 * its surroundings, free; a detailed one is redrawn once by Muse Image and
 * kept only where the character was (keepAroundSubject), every other pixel
 * being the upload's own.
 */
export async function separateLivingScene(imageId: string, gate?: PaidWorkGate): Promise<LivingInventory> {
  const inventory = await readInventory(imageId);
  if (!inventory) throw new AppError("living_layers_missing", 409, "Find what can move in your picture first.");
  const character = inventory.layers.find((layer) => layer.kind === "character");
  if (!character) throw new AppError("living_no_character", 409, "Focus didn’t find a character to separate from the background.");
  const files = livingFiles(imageId);
  if (inventory.scene && (await stat(files.scene).catch(() => null))) return inventory;
  const look = await readUploadedImage(imageId, gate);
  const { image, flat } = await getCharacterImage(imageId);
  const sourceFlat = await readFile(flat);
  const { data: rgb, info } = await sharp(sourceFlat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const body = await readMask(files.mask(character.id));
  let plate: Buffer | null = null;
  if (!image.hasAlpha && look.analysis.background !== "plain") {
    await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 1 });
    const drawn = await livingServices.scene({ sourceFlat, analysis: look.analysis, flipbookId: image.id });
    plate = await keepAroundSubject(sourceFlat, drawn.png, body);
  }
  if (!plate) {
    // A plain or transparent background, or a redraw that came back in another shape: filled from around the character.
    const hole = growMask(body, info.width, info.height, Math.max(3, Math.round(Math.max(info.width, info.height) * 0.006)));
    plate = await sharp(inpaint(rgb, hole.map((value) => (value >= 128 ? 1 : 0)), info.width, info.height), { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  }
  await writeAtomic(files.scene, plate);
  const next: LivingInventory = { ...inventory, scene: true };
  await writeAtomic(files.inventory, JSON.stringify(next));
  return next;
}

// ── Blinking ───────────────────────────────────────────────────────────────

/** Eyes are small: a SAM "eye" larger than this share of the picture is something else. */
const EYE_MAX_SHARE = 0.02;

/**
 * Lets the character blink: SAM finds its eyes, Muse Image redraws the
 * picture with them shut, and only the eyes (grown to take in the lids,
 * feathered) are kept from that drawing. Every other pixel stays the
 * upload's own. One SAM frame and one drawing.
 */
export async function prepareBlink(imageId: string, gate?: PaidWorkGate): Promise<LivingInventory> {
  const inventory = await readInventory(imageId);
  if (!inventory) throw new AppError("living_layers_missing", 409, "Find what can move in your picture first.");
  const character = inventory.layers.find((layer) => layer.kind === "character");
  if (!character) throw new AppError("living_no_character", 409, "Focus didn’t find a character to blink.");
  const files = livingFiles(imageId);
  if (inventory.blink && (await stat(files.blink).catch(() => null))) return inventory;
  if (!segmentation.segment) throw new AppError("living_no_eyes", 422, "Focus can’t look for the eyes right now. Try again later.");
  const { image, flat } = await getCharacterImage(imageId);
  const sourceFlat = await readFile(flat);
  const { data: rgb, info } = await sharp(sourceFlat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const total = width * height;
  const body = await readMask(files.mask(character.id));
  await gate?.({ activeJobs: activeWorkCount(), estimatedFrames: 2 });
  const near = growMask(body, width, height, 4);
  const eyes = (await segmentation.segment({ png: sourceFlat, width, height, concept: "eye", flipbookId: image.id }))
    .filter((mask) => mask.area > 4 && mask.area < total * EYE_MAX_SHARE && near[Math.floor((mask.box.top + mask.box.bottom) / 2) * width + Math.floor((mask.box.left + mask.box.right) / 2)] >= 128);
  if (!eyes.length) throw new AppError("living_no_eyes", 422, "Focus couldn’t find the character’s eyes, so it can’t blink.");
  // Each eye grown by half its height, to take in the lids that close over it.
  const region = new Uint8Array(total);
  for (const eye of eyes) {
    const grown = growMask(eye.alpha, width, height, Math.max(3, Math.ceil((eye.box.bottom - eye.box.top) * 0.5)));
    for (let i = 0; i < total; i++) if (grown[i] > region[i]) region[i] = grown[i];
  }
  const drawn = await livingServices.closedEyes({ sourceFlat, flipbookId: image.id });
  const meta = await sharp(drawn.png).metadata();
  if (!meta.width || !meta.height || Math.abs(meta.width / meta.height / (width / height) - 1) > 0.03) {
    throw new AppError("living_blink_failed", 502, "The closed-eyes drawing came back in another shape. Try again.");
  }
  const closed = await sharp(drawn.png).removeAlpha().resize(width, height, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const soft = blurField(Float32Array.from(region, (value) => value / 255), width, height, 2);
  const out = Buffer.from(rgb);
  const alpha = Buffer.alloc(total);
  for (let i = 0; i < total; i++) {
    const a = Math.min(1, soft[i]);
    alpha[i] = Math.round(a * 255);
    if (a > 0) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgb[i * 3 + c] * (1 - a) + closed[i * 3 + c] * a);
  }
  await writeAtomic(files.blink, await sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer());
  await writeMask(files.blinkMask, alpha, width, height);
  const next: LivingInventory = { ...inventory, blink: true };
  await writeAtomic(files.inventory, JSON.stringify(next));
  return next;
}

/** How long a blink lasts. */
const BLINK_SECONDS = 0.18;
/** Where in the loop it happens. */
const BLINK_AT = 0.6;

// ── Parts picked by hand ───────────────────────────────────────────────────

/** A picked part smaller than this share of the picture is a speck; larger than this share of the character is the character. */
const PART_MIN_SHARE = 0.0005;
const PART_MAX_OF_CHARACTER = 0.6;
const MAX_CUSTOM_PARTS = 4;

/**
 * A part SAM didn't find (a tail, a ribbon), picked by a click: the region
 * of the character around it (pickPart), added as a flowing layer that
 * sways from where it meets the rest of the body. No AI, no cost.
 */
export async function addPart(imageId: string, input: LivingPartRequest): Promise<LivingInventory> {
  const inventory = await readInventory(imageId);
  if (!inventory) throw new AppError("living_layers_missing", 409, "Find what can move in your picture first.");
  if (inventory.layers.filter((layer) => layer.custom).length >= MAX_CUSTOM_PARTS) throw new AppError("living_parts_full", 409, `You can add up to ${MAX_CUSTOM_PARTS} parts. Remove one first.`);
  if (inventory.layers.length >= 8) throw new AppError("living_parts_full", 409, "This picture already has as many moving parts as Focus can handle.");
  const { image, flat } = await getCharacterImage(imageId);
  const { data: rgb, info } = await sharp(flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (input.x >= info.width || input.y >= info.height) throw new AppError("living_part_outside", 400, "That spot is outside the picture.");
  const files = livingFiles(image.id);
  const character = inventory.layers.find((layer) => layer.kind === "character");
  const body = character ? await readMask(files.mask(character.id)) : null;
  const part = pickPart(rgb, info.width, info.height, input.x, input.y, body);
  if (!part) throw new AppError("living_part_outside", 400, "Click on the character: only its own parts can be added.");
  const total = info.width * info.height;
  let size = 0, bodySize = 0;
  for (let i = 0; i < total; i++) {
    if (part[i] >= 128) size++;
    if (body && body[i] >= 128) bodySize++;
  }
  if (size < total * PART_MIN_SHARE) throw new AppError("living_part_small", 400, "That spot is too small to move on its own. Click in the middle of the part.");
  if (body && size > bodySize * PART_MAX_OF_CHARACTER) throw new AppError("living_part_large", 400, "That picks up most of the character. Click on a smaller part, like a tail or a ribbon.");
  // Never reused: renders are cached by layer id, and a new pick is a new mask.
  const id = `${slug(input.name ?? "part").slice(0, 30)}-${randomBytes(3).toString("hex")}`;
  await writeMask(files.mask(id), part, info.width, info.height);
  const next: LivingInventory = {
    ...inventory,
    layers: [...inventory.layers, { id, name: input.name ?? "part", kind: "flowing", pieces: 1, share: size / total, custom: true }],
  };
  await writeAtomic(files.inventory, JSON.stringify(next));
  return next;
}

/** Removes a part that was picked by hand; found layers stay. */
export async function removePart(imageId: string, layerId: string): Promise<LivingInventory> {
  const inventory = await readInventory(imageId);
  const layer = inventory?.layers.find((entry) => entry.id === layerId);
  if (!inventory || !layer?.custom) throw new AppError("living_layer_unknown", 404, "That part isn’t there.");
  const next: LivingInventory = { ...inventory, layers: inventory.layers.filter((entry) => entry.id !== layerId) };
  await writeAtomic(livingFiles(imageId).inventory, JSON.stringify(next));
  await rm(livingFiles(imageId).mask(layerId), { force: true });
  return next;
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** Bumped when the engine's output changes, so old renders aren't reused. */
export const LIVING_RENDER_VERSION = 9;
const GIF_FPS = 12;
const GIF_LONG_SIDE = 640;

const renderLimiter = ((globalThis as { __focusLivingLimiter?: Limiter }).__focusLivingLimiter ??= new Limiter(1));
/** Renders running or waiting their turn; past MAX_WAITING the server says it's busy instead of queueing more. */
const renderQueue = ((globalThis as { __focusLivingQueue?: { size: number } }).__focusLivingQueue ??= { size: 0 });
const MAX_WAITING = 4;

export function livingKey(inventory: Pick<LivingInventory, "createdAt">, request: LivingRequest): string {
  return createHash("sha256").update(JSON.stringify({ v: LIVING_RENDER_VERSION, at: inventory.createdAt, request })).digest("hex").slice(0, 16);
}

/** The scene the engine moves: every layer as the person chose, read from its stored masks. */
async function sceneFor(imageId: string, inventory: LivingInventory, request: LivingRequest, rgb: Buffer, width: number, height: number): Promise<LivingScene> {
  const files = livingFiles(imageId);
  const choice = new Map(request.layers.map((layer) => [layer.id, layer]));
  let body: LivingScene["body"] = null;
  let sky: LivingScene["sky"] = null;
  const flows: { mask: Uint8Array; strength: number }[] = [];
  const particles: { masks: Uint8Array[]; motion: "drift" | "flutter"; strength: number }[] = [];
  for (const layer of inventory.layers) {
    const picked = choice.get(layer.id);
    const motion = picked?.motion ?? MOTIONS_FOR[layer.kind][0];
    const strength = picked?.strength ?? 1;
    // The character's mask is also where things pass behind, so it's read even when it keeps still.
    if (layer.kind === "character") body = { mask: await readMask(files.mask(layer.id)), strength: motion === "still" ? 0 : strength };
    if (motion === "still" || strength <= 0) continue;
    if (layer.kind === "flowing") flows.push({ mask: await readMask(files.mask(layer.id)), strength });
    else if (layer.kind === "sky") sky = { mask: await readMask(files.mask(layer.id)), strength };
    else if (layer.kind === "floating") {
      const masks = await Promise.all(Array.from({ length: layer.pieces }, (_, piece) => readMask(files.mask(layer.id, piece))));
      particles.push({ masks, motion: motion === "flutter" ? "flutter" : "drift", strength });
    }
  }
  const blink = request.blink && inventory.blink
    ? {
      rgb: await sharp(files.blink).removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer(),
      alpha: Float32Array.from(await readMask(files.blinkMask), (value) => value / 255),
      at: BLINK_AT,
      length: Math.min(0.5, BLINK_SECONDS / request.durationSeconds),
    }
    : null;
  return { width, height, rgb, body, flows, particles, sky, wind: request.wind === "left" ? -1 : 1, blink };
}

/** Checks a request against the layers it names; an unknown layer or a motion its kind can't take is refused. */
export function assertRequestFits(inventory: LivingInventory, request: LivingRequest): void {
  for (const entry of request.layers) {
    const layer = inventory.layers.find((candidate) => candidate.id === entry.id);
    if (!layer) throw new AppError("living_layer_unknown", 400, "That part of the picture is no longer there. Find what can move again.");
    if (!MOTIONS_FOR[layer.kind].includes(entry.motion)) throw new AppError("living_motion_invalid", 400, `“${layer.name}” can’t ${entry.motion}.`);
  }
  if (request.camera === "depth" && !inventory.scene) throw new AppError("living_scene_missing", 409, "Separate the character from the background first.");
  if (request.blink && !inventory.blink) throw new AppError("living_blink_missing", 409, "Add blinking first.");
}

export async function readLivingRender(imageId: string, key: string): Promise<LivingRender | null> {
  if (!/^[a-f0-9]{16}$/.test(key)) return null;
  return readJsonFile(livingFiles(imageId).render(key), (value) => LivingRenderSchema.parse(value));
}

/**
 * The picture in motion, as an MP4 that loops seamlessly and a GIF. No AI:
 * the stored masks and the upload's pixels only. Both files are verified
 * before they're offered; the same request returns the same files.
 */
export async function renderLiving(imageId: string, request: LivingRequest, signal?: AbortSignal, admit?: () => void, onProgress?: (fraction: number) => void): Promise<LivingRender> {
  const inventory = await readInventory(imageId);
  if (!inventory) throw new AppError("living_layers_missing", 409, "Find what can move in your picture first.");
  assertRequestFits(inventory, request);
  const key = livingKey(inventory, request);
  const existing = await readLivingRender(imageId, key);
  if (existing) return existing;
  // Only new work is limited: a cached render above was free.
  admit?.();
  if (renderQueue.size >= MAX_WAITING) throw new AppError("render_busy", 503, "Focus is busy rendering other animations. Try again in a moment.");
  renderQueue.size++;
  try {
    return await renderOnce(imageId, inventory, request, key, signal, onProgress);
  } finally {
    renderQueue.size--;
  }
}

/** Share of a render's time spent drawing the loop; the video and the GIF take the rest. */
const DRAWING_SHARE = 0.85;

function renderOnce(imageId: string, inventory: LivingInventory, request: LivingRequest, key: string, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<LivingRender> {
  return renderLimiter.run(async () => {
    const again = await readLivingRender(imageId, key);
    if (again) return again;
    const { image, flat } = await getCharacterImage(imageId);
    const { data: rgb, info } = await sharp(flat).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const scene = await sceneFor(image.id, inventory, request, rgb, info.width, info.height);
    const depth = request.camera === "depth";
    const prepared = prepareLiving(scene, { cover: depth });
    const plate = depth ? await sharp(livingFiles(image.id).scene).removeAlpha().resize(info.width, info.height, { fit: "fill" }).raw().toBuffer() : null;
    // The video's shape and where the camera looks; framedSize keeps the sides even, as H.264 needs.
    const { width, height } = framedSize(request.aspect, info.width, info.height);
    const focus = focusOf(scene.body?.mask ?? null, info.width, info.height);
    const frames = request.durationSeconds * LIVING_FPS;
    const dir = livingFiles(image.id).renderDir(key);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // One silent loop first: the GIF is made from it, and the video repeats it.
    const loop = path.join(dir, "loop.mp4");
    const writer = writeFrames({ output: loop, width, height, fps: LIVING_FPS, frameCount: frames, signal });
    try {
      for (let frame = 0; frame < frames; frame++) {
        if (signal?.aborted) throw new AppError("canceled", 499, "Render canceled.");
        const t = frame / frames;
        onProgress?.((frame / frames) * DRAWING_SHARE);
        // The character holds each pose for two frames (anime "on twos"); the camera moves on every frame.
        const { rgba, cover } = livingLayers(prepared, t, bodyTime(frame, frames));
        await writer.write(plate && cover
          ? depthFrame(rgba, cover, plate, info.width, info.height, depthViews(t, info, { width, height }, focus), width, height, prepared.wideCover ?? cover)
          : viewFrame(rgba, info.width, info.height, cameraView(depth ? "pan" : request.camera as "still" | "zoom" | "pan", t, info, { width, height }, focus), width, height));
      }
      await writer.finish();
    } catch (error) {
      writer.abort();
      throw error;
    }
    await verifyOutput(loop, { width, height, fps: LIVING_FPS, frameCount: frames, hasAudio: false });

    const seconds = videoSeconds(request);
    const hasAudio = request.audio.kind !== "none";
    const mp4 = path.join(dir, "focus-animation.mp4");
    const track = request.audio.kind === "upload" ? await trackFor(image.id, request.audio.version) : null;
    // The loop repeated without re-encoding, and the sound laid under it.
    await runFfmpeg([
      "-y",
      "-stream_loop", String(Math.round(seconds / request.durationSeconds) - 1), "-i", loop,
      ...(track ? ["-i", livingFiles(image.id).trackAudio(track.version)] : []),
      ...(request.audio.kind === "none" ? ["-map", "0:v"] : [
        "-filter_complex", soundGraph(request.audio.kind === "ambience" ? { ambience: request.audio.ambience } : { input: 1 }, seconds),
        "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      ]),
      "-c:v", "copy", "-t", seconds.toFixed(3), "-movflags", "+faststart", mp4,
    ], signal);
    await verifyOutput(mp4, { width, height, fps: LIVING_FPS, frameCount: seconds * LIVING_FPS, hasAudio });
    onProgress?.(0.93);

    const scale = Math.min(1, GIF_LONG_SIDE / Math.max(width, height));
    const gifWidth = Math.max(2, Math.round(width * scale)), gifHeight = Math.max(2, Math.round(height * scale));
    const gif = path.join(dir, "focus-animation.gif");
    // Every number in the graph is computed here; nothing user-typed reaches it.
    await runFfmpeg(["-y", "-i", loop, "-filter_complex", `fps=${GIF_FPS},scale=${gifWidth}:${gifHeight}:flags=lanczos,split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`, "-loop", "0", gif], signal);
    const facts = parseGif(await readFile(gif));
    const gifFrames = request.durationSeconds * GIF_FPS;
    if (facts.width !== gifWidth || facts.height !== gifHeight || Math.abs(facts.frames - gifFrames) > 1 || !facts.loopsForever) {
      throw new AppError("export_invalid", 500, "The GIF didn’t pass verification.", `${facts.width}×${facts.height}, ${facts.frames} frames`);
    }

    const render: LivingRender = {
      key,
      width,
      height,
      frames: seconds * LIVING_FPS,
      durationSeconds: seconds,
      hasAudio,
      files: [
        { name: "focus-animation.mp4", type: "video/mp4", bytes: (await stat(mp4)).size },
        { name: "focus-animation.gif", type: "image/gif", bytes: (await stat(gif)).size },
      ],
      createdAt: new Date().toISOString(),
    };
    await writeAtomic(livingFiles(image.id).render(key), JSON.stringify(render));
    await pruneRenders(image.id, key).catch(() => undefined);
    return render;
  });
}

/** Renders one picture keeps (a few MB each) before the oldest are dropped; the picture expires after a day anyway. */
export const MAX_CACHED_RENDERS = 12;

/** Removes the oldest renders past MAX_CACHED_RENDERS, never `keep`; one asked for again is simply drawn again. */
export async function pruneRenders(imageId: string, keep: string, max = MAX_CACHED_RENDERS): Promise<void> {
  const root = path.dirname(livingFiles(imageId).renderDir("x"));
  const entries: { key: string; at: number }[] = [];
  for (const key of await readdir(root).catch(() => [] as string[])) {
    if (key === keep || !/^[a-f0-9]{16}$/.test(key)) continue;
    const info = await stat(livingFiles(imageId).render(key)).catch(() => null);
    // A directory without render.json is a render still being made or one that failed: left alone here.
    if (info) entries.push({ key, at: info.mtimeMs });
  }
  entries.sort((a, b) => b.at - a.at);
  for (const { key } of entries.slice(Math.max(0, max - 1))) await rm(livingFiles(imageId).renderDir(key), { recursive: true, force: true });
}

// ── Sound ──────────────────────────────────────────────────────────────────

/** Seconds of a sound's end crossfaded into its start, so the video can repeat without a seam. */
const AUDIO_SEAM = 0.5;

/** An ambience as filtered noise with fixed seeds: the same sound on every render. Ends in [src]. */
function ambienceSource(ambience: Ambience, seconds: number): string {
  const noise = (color: string, seed: number, amplitude: number) => `anoisesrc=d=${seconds.toFixed(3)}:c=${color}:r=48000:a=${amplitude}:s=${seed}`;
  const wind = (seed: number, gain: number) => `${noise("brown", seed, 0.6)},highpass=f=40,lowpass=f=500,tremolo=f=0.13:d=0.5,volume=${gain}`;
  switch (ambience) {
    case "wind":
      return `${wind(7, 2)}[src]`;
    case "leaves":
      return `${wind(7, 1.6)}[wind];${noise("pink", 11, 0.35)},bandpass=f=4000:width_type=o:w=2,tremolo=f=5:d=0.8,volume=0.8[rustle];[wind][rustle]amix=inputs=2:normalize=0[src]`;
    case "rain":
      return `${noise("white", 13, 0.3)},highpass=f=1200,lowpass=f=7000[drops];${noise("brown", 17, 0.4)},lowpass=f=200,volume=1.2[rumble];[drops][rumble]amix=inputs=2:normalize=0[src]`;
    case "waves":
      return `${noise("brown", 19, 0.7)},highpass=f=30,lowpass=f=700,tremolo=f=0.11:d=0.9,volume=1.8[src]`;
  }
}

/**
 * The filter graph for the sound under `seconds` of video: an ambience or an
 * input's audio, made that long, with its last half-second crossfaded into
 * its start (equal power) so the end runs straight into the beginning.
 * Every number is computed here; nothing user-typed reaches it. Pure.
 */
export function soundGraph(source: { ambience: Ambience } | { input: number }, seconds: number): string {
  const total = seconds + AUDIO_SEAM;
  const start = "ambience" in source
    ? ambienceSource(source.ambience, total)
    : `[${source.input}:a]apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[src]`;
  return [
    start,
    `[src]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[head][rest]`,
    `[head]atrim=0:${seconds.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${AUDIO_SEAM}:curve=qsin[main]`,
    `[rest]atrim=${seconds.toFixed(3)}:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:d=${AUDIO_SEAM}:curve=qsin[tail]`,
    `[main][tail]amix=inputs=2:duration=first:normalize=0[aout]`,
  ].join(";");
}

export function readTrack(imageId: string): Promise<LivingTrack | null> {
  return readJsonFile(livingFiles(imageId).track, (value) => LivingTrackSchema.parse(value));
}

async function trackFor(imageId: string, version: string): Promise<LivingTrack> {
  const track = await readTrack(imageId);
  if (!track || track.version !== version) throw new AppError("living_audio_missing", 409, "That track is no longer there. Upload it again.");
  return track;
}

/**
 * A track the person brings: any common audio file, read with FFprobe,
 * normalized to stereo AAC and cut to MAX_AUDIO_SECONDS. It replaces the
 * previous one. A file with no readable sound is refused.
 */
export async function uploadTrack(imageId: string, body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined, name: string): Promise<LivingTrack> {
  const { image } = await getCharacterImage(imageId);
  if (!body) throw new AppError("empty_file", 400, "We didn’t receive a file.");
  const tooLarge = () => new AppError("audio_too_large", 413, `This track is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`);
  if (declaredBytes !== undefined && declaredBytes > MAX_AUDIO_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_AUDIO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  const files = livingFiles(image.id);
  const version = randomBytes(6).toString("hex");
  const raw = path.join(files.dir, "audio", `${version}.upload`);
  const out = files.trackAudio(version);
  await mkdir(path.dirname(raw), { recursive: true });
  await writeFile(raw, Buffer.concat(chunks));
  const invalid = () => new AppError("audio_invalid", 400, "We couldn’t read any sound in that file. Upload an MP3, M4A, WAV or OGG.");
  try {
    const facts = await probe(raw).catch(() => null);
    if (!facts?.streams.some((stream) => stream.codec_type === "audio")) throw invalid();
    await runFfmpeg(["-y", "-i", raw, "-vn", "-map", "0:a:0", "-t", String(MAX_AUDIO_SECONDS), "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", out]).catch(() => { throw invalid(); });
    const duration = Number((await probe(out)).format.duration);
    if (!(duration > 0.2)) throw invalid();
    const previous = await readTrack(image.id);
    const track: LivingTrack = { version, name: name.slice(0, 120) || "track", durationSeconds: Math.round(duration * 100) / 100 };
    await writeAtomic(files.track, JSON.stringify(track));
    if (previous) await rm(files.trackAudio(previous.version), { force: true });
    return track;
  } catch (error) {
    await rm(out, { force: true });
    throw error;
  } finally {
    await rm(raw, { force: true });
  }
}

// ── Keeping it ────────────────────────────────────────────────────────────

/**
 * The finished MP4 (with its sound) as a clip in the video editor. For a
 * signed-in person it becomes a saved project, kept out of the 24-hour
 * cleanup that the upload and its renders are subject to.
 */
export async function livingToEditor(imageId: string, key: string, ownerId: string | null): Promise<{ video: VideoAsset; saved: boolean }> {
  const render = await readLivingRender(imageId, key);
  const file = render?.files.find((entry) => entry.type === "video/mp4");
  if (!render || !file) throw new AppError("media_not_found", 404, "This animation is no longer available. Render it again.");
  const { image } = await getCharacterImage(imageId);
  const title = `${image.originalName.replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N} _-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "Picture"} in motion`;
  const video = await ingestVideo({
    body: Readable.toWeb(createReadStream(path.join(livingFiles(image.id).renderDir(render.key), file.name))) as ReadableStream<Uint8Array>,
    fileName: `${title}.mp4`,
    declaredBytes: file.bytes,
  });
  if (ownerId) await projectForVideo(ownerId, video.id, { title });
  return { video, saved: Boolean(ownerId) };
}
