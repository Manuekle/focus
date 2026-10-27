import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  OUTPUT_FPS,
  PARALLAX_FAR,
  ZOOM_DEPTH,
  backgroundMotion,
  backgroundMoves,
  backgroundShiftAt,
  backgroundZoomAt,
  cellLeftAt,
  outputFrameCount,
  stageSize,
  tickAtOutputFrame,
  tickCount,
  type AnimationAction,
  type Cell,
  type ExportRequest,
  type FlipbookAlignment,
  type FlipbookDirection,
  type PlaybackSettings,
} from "../../shared/flipbook";
import { AppError } from "../errors";
import { verifyOutput } from "../video/compositor";
import { runFfmpeg, writeFrames } from "../video/frames";
import { listZip, writeZip } from "./zip";

// Exports reproduce the approved sequence exactly: the same drawings, in the
// same order, held for the same number of frames, at the same place on the
// stage as the browser player (both use shared/flipbook.ts). Every file is
// verified after it is written; nothing is offered before that.

export type ExportFrame = { readonly frameId: string; readonly label: string; readonly phase: string; readonly spritePath: string };

export type ExportFile = { readonly name: string; readonly path: string; readonly type: string; readonly bytes: number };
export type ExportResult = { readonly files: ExportFile[]; readonly facts: { width: number; height: number; frames: number; durationSeconds: number | null } };

const GIF_LONG_SIDE = 640;

type Rgba = { data: Buffer; width: number; height: number };

async function loadSprite(file: string, cell: { width: number; height: number }): Promise<Rgba> {
  const { data, info } = await sharp(file).ensureAlpha().resize(cell.width, cell.height, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * The stage behind the sprites at one drawing tick. Still backgrounds are one
 * layer, cover-fitted once. A scrolling plate is fitted to the stage height
 * and slides by backgroundShiftAt, wrapping around; in parallax the far layer
 * (the sky) slides at PARALLAX_FAR of that under the near one. A slow zoom
 * crops into one cover-fitted picture by backgroundZoomAt. The player does
 * the same with the same functions.
 */
type Backdrop =
  | { readonly kind: "still"; readonly layer: Buffer }
  | { readonly kind: "scroll"; readonly strip: Rgba }
  | { readonly kind: "parallax"; readonly far: Rgba; readonly near: Rgba }
  | { readonly kind: "zoom"; readonly picture: Rgba };

async function fitHeight(file: string, height: number, flatten: boolean): Promise<Rgba> {
  const image = sharp(file).resize({ height, kernel: "lanczos3" });
  const { data, info } = await (flatten ? image.flatten({ background: "#000000" }) : image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function loadBackground(request: ExportRequest, stage: { width: number; height: number }, files: { plate: string | null; far: string | null }): Promise<Backdrop> {
  const background = request.background;
  if (background.kind === "transparent") return { kind: "still", layer: Buffer.alloc(stage.width * stage.height * 4) };
  if (background.kind === "color") {
    const [r, g, b] = [1, 3, 5].map((offset) => parseInt(background.color.slice(offset, offset + 2), 16));
    const buffer = Buffer.alloc(stage.width * stage.height * 4);
    for (let index = 0; index < buffer.length; index += 4) { buffer[index] = r; buffer[index + 1] = g; buffer[index + 2] = b; buffer[index + 3] = 255; }
    return { kind: "still", layer: buffer };
  }
  const plate = files.plate;
  if (!plate) throw new AppError("background_missing", 409, background.kind === "scene" ? "Create the scene background first." : background.kind === "generated" ? "Generate a background first." : "Upload a background image first.");
  const motion = backgroundMotion(background);
  if (motion === "parallax") {
    if (!files.far) throw new AppError("depth_unavailable", 409, "This background has no depth layers.");
    return { kind: "parallax", far: await fitHeight(files.far, stage.height, true), near: await fitHeight(plate, stage.height, false) };
  }
  if (motion === "scroll") return { kind: "scroll", strip: await fitHeight(plate, stage.height, true) };
  if (motion === "zoom") {
    // Cover-fitted at the deepest zoom once; each tick crops into it.
    const width = Math.ceil(stage.width * (1 + ZOOM_DEPTH));
    const height = Math.ceil(stage.height * (1 + ZOOM_DEPTH));
    const { data, info } = await sharp(plate).resize(width, height, { fit: "cover", position: "centre" }).flatten({ background: "#000000" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { kind: "zoom", picture: { data, width: info.width, height: info.height } };
  }
  return { kind: "still", layer: await sharp(plate).resize(stage.width, stage.height, { fit: "cover", position: "centre" }).flatten({ background: "#000000" }).ensureAlpha().raw().toBuffer() };
}

/** The stage-wide window of a repeating strip, starting `shift` pixels in. */
function scrolled(strip: Rgba, stageWidth: number, shift: number): Buffer {
  const out = Buffer.alloc(stageWidth * strip.height * 4);
  const start = ((shift % strip.width) + strip.width) % strip.width;
  for (let y = 0; y < strip.height; y++) {
    let x = 0;
    let from = start;
    while (x < stageWidth) {
      const run = Math.min(stageWidth - x, strip.width - from);
      strip.data.copy(out, (y * stageWidth + x) * 4, (y * strip.width + from) * 4, (y * strip.width + from + run) * 4);
      x += run;
      from = 0;
    }
  }
  return out;
}

async function backdropAt(backdrop: Backdrop, stage: { width: number; height: number }, tick: number, settings: PlaybackSettings, cell: Cell, count: number, facing: FlipbookDirection): Promise<Buffer> {
  if (backdrop.kind === "still") return Buffer.from(backdrop.layer);
  if (backdrop.kind === "zoom") {
    // The picture is the cover fit at the deepest zoom: at zoom z the stage shows 1/z of it, centered.
    const { picture } = backdrop;
    const zoom = backgroundZoomAt(tick, settings);
    const cropWidth = Math.min(picture.width, Math.max(1, Math.round(picture.width / zoom)));
    const cropHeight = Math.min(picture.height, Math.max(1, Math.round(picture.height / zoom)));
    const left = Math.round((picture.width - cropWidth) / 2);
    const top = Math.round((picture.height - cropHeight) / 2);
    return sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(stage.width, stage.height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
  }
  const shift = backgroundShiftAt(tick, settings, cell, count, facing);
  if (backdrop.kind === "scroll") return scrolled(backdrop.strip, stage.width, shift);
  const frame = scrolled(backdrop.far, stage.width, Math.round(shift * PARALLAX_FAR));
  blend(frame, stage.width, { data: scrolled(backdrop.near, stage.width, shift), width: stage.width, height: stage.height }, 0);
  return frame;
}

/** Straight-alpha "over" of one sprite cell onto the stage at x. */
function blend(target: Buffer, stageWidth: number, sprite: Rgba, x0: number): void {
  const fromX = Math.max(0, -x0);
  const toX = Math.min(sprite.width, stageWidth - x0);
  for (let y = 0; y < sprite.height; y++) {
    for (let x = fromX; x < toX; x++) {
      const s = (y * sprite.width + x) * 4;
      const a = sprite.data[s + 3];
      if (a === 0) continue;
      const d = (y * stageWidth + x0 + x) * 4;
      if (a === 255) {
        target[d] = sprite.data[s]; target[d + 1] = sprite.data[s + 1]; target[d + 2] = sprite.data[s + 2]; target[d + 3] = 255;
        continue;
      }
      const sa = a / 255;
      const da = target[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) target[d + c] = Math.round((sprite.data[s + c] * sa + target[d + c] * da * (1 - sa)) / oa);
      target[d + 3] = Math.round(oa * 255);
    }
  }
}

function cellOf(alignment: FlipbookAlignment): Cell {
  return { width: alignment.cellWidth, height: alignment.cellHeight, strideX: alignment.strideX };
}

const sizeOf = async (file: string) => (await stat(file)).size;

export async function renderExport(input: {
  readonly request: ExportRequest;
  readonly frames: readonly ExportFrame[];
  readonly alignment: FlipbookAlignment;
  /** The stored plate for scene, custom and generated backgrounds (the near layer in parallax). */
  readonly plate: string | null;
  /** The far layer, in parallax only. */
  readonly far?: string | null;
  /** Which way the character faces: a scrolling background slides against it. */
  readonly facing?: FlipbookDirection;
  readonly outputDir: string;
  readonly baseName: string;
  readonly action?: AnimationAction;
  readonly signal?: AbortSignal;
}): Promise<ExportResult> {
  const { request, frames, alignment, outputDir, signal } = input;
  const facing = input.facing ?? "right";
  const { settings } = request;
  const cell = cellOf(alignment);
  const count = frames.length;
  if (!count) throw new AppError("export_not_ready", 409, "There are no frames to export yet.");
  await mkdir(outputDir, { recursive: true });
  const sprites = await Promise.all(frames.map((frame) => loadSprite(frame.spritePath, cell)));

  if (request.format === "mp4") {
    if (request.background.kind === "transparent") throw new AppError("mp4_needs_background", 400, "MP4 can’t be transparent. Choose a color, the scene or your own background.");
    const stage = stageSize(settings.motion, cell);
    const background = await loadBackground(request, stage, { plate: input.plate, far: input.far ?? null });
    const total = outputFrameCount(settings.durationSeconds);
    const file = path.join(outputDir, `${input.baseName}.mp4`);
    const writer = writeFrames({ output: file, width: stage.width, height: stage.height, fps: OUTPUT_FPS, frameCount: total, signal });
    try {
      let lastTick = -1;
      let frame: Buffer = Buffer.alloc(0);
      for (let index = 0; index < total; index++) {
        if (signal?.aborted) throw new AppError("canceled", 499, "Export canceled.");
        const tick = tickAtOutputFrame(index, settings.drawingFps);
        if (tick !== lastTick) {
          frame = await backdropAt(background, stage, tick, settings, cell, count, facing);
          blend(frame, stage.width, sprites[tick % count], cellLeftAt(tick, settings, cell, count));
          lastTick = tick;
        }
        await writer.write(frame);
      }
      await writer.finish();
    } catch (error) {
      writer.abort();
      throw error;
    }
    const verified = await verifyOutput(file, { width: stage.width, height: stage.height, fps: OUTPUT_FPS, frameCount: total, hasAudio: false });
    return {
      files: [{ name: `${input.baseName}.mp4`, path: file, type: "video/mp4", bytes: await sizeOf(file) }],
      facts: { width: stage.width, height: stage.height, frames: total, durationSeconds: verified.durationSeconds },
    };
  }

  if (request.format === "gif") {
    const stage = stageSize(settings.motion, cell);
    const background = await loadBackground(request, stage, { plate: input.plate, far: input.far ?? null });
    // In place is one cycle looping forever; moving across (or a moving background) needs the whole length.
    const ticks = settings.motion === "in_place" && !backgroundMoves(request.background) ? count : tickCount(settings.durationSeconds, settings.drawingFps);
    const sourceDir = path.join(outputDir, "gif-source");
    await mkdir(sourceDir, { recursive: true });
    for (let tick = 0; tick < ticks; tick++) {
      if (signal?.aborted) throw new AppError("canceled", 499, "Export canceled.");
      const frame = await backdropAt(background, stage, tick, settings, cell, count, facing);
      blend(frame, stage.width, sprites[tick % count], cellLeftAt(tick, settings, cell, count));
      await writeFile(path.join(sourceDir, `frame_${String(tick).padStart(4, "0")}.png`), await sharp(frame, { raw: { width: stage.width, height: stage.height, channels: 4 } }).png().toBuffer());
    }
    const scale = Math.min(1, GIF_LONG_SIDE / Math.max(stage.width, stage.height));
    const width = Math.max(2, Math.round(stage.width * scale));
    const height = Math.max(2, Math.round(stage.height * scale));
    const transparent = request.background.kind === "transparent";
    const file = path.join(outputDir, `${input.baseName}.gif`);
    // Every number in the graph is computed here; nothing user-typed reaches it.
    const graph = `scale=${width}:${height}:flags=lanczos,split[a][b];[a]palettegen=max_colors=255:reserve_transparent=${transparent ? 1 : 0}:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a${transparent ? ":alpha_threshold=128" : ""}`;
    await runFfmpeg(["-framerate", String(settings.drawingFps), "-i", path.join(sourceDir, "frame_%04d.png"), "-filter_complex", graph, "-loop", "0", file], signal);
    const facts = parseGif(await readFile(file));
    const expectedCs = (ticks * 100) / settings.drawingFps;
    const problems: string[] = [];
    if (facts.width !== width || facts.height !== height) problems.push(`size ${facts.width}×${facts.height}`);
    if (facts.frames !== ticks) problems.push(`${facts.frames} frames, expected ${ticks}`);
    if (!facts.loopsForever) problems.push("no infinite loop");
    if (Math.abs(facts.totalDelayCs - expectedCs) > ticks) problems.push(`duration ${facts.totalDelayCs} cs, expected ${expectedCs}`);
    if (problems.length) throw new AppError("export_invalid", 500, "The GIF didn’t pass verification.", problems.join(", "));
    return {
      files: [{ name: `${input.baseName}.gif`, path: file, type: "image/gif", bytes: await sizeOf(file) }],
      facts: { width, height, frames: ticks, durationSeconds: facts.totalDelayCs / 100 },
    };
  }

  if (request.background.kind === "scene" || request.background.kind === "custom" || request.background.kind === "generated") {
    throw new AppError("sprites_background", 400, "Sprite sheets and frame sequences use a transparent or solid background.");
  }
  const flatten = request.background.kind === "color" ? request.background.color : null;
  const framePngs = await Promise.all(frames.map(async (frame) => {
    const image = sharp(frame.spritePath).resize(cell.width, cell.height, { fit: "fill" });
    return (flatten ? image.flatten({ background: flatten }) : image.ensureAlpha()).png().toBuffer();
  }));
  const frameMs = Math.round(1000 / settings.drawingFps);
  const names = frames.map((_frame, index) => `frame_${String(index).padStart(3, "0")}`);
  const meta = {
    app: "Focus Flipbook",
    animation: input.action ?? "walk",
    loop: true,
    frameRate: settings.drawingFps,
    frameDurationMs: frameMs,
    cell: { w: cell.width, h: cell.height },
    baselineY: alignment.baselineY,
    strideX: alignment.strideX,
    order: frames.map((frame, index) => ({ name: `${names[index]}.png`, phase: frame.phase, pose: frame.label })),
  };

  if (request.format === "spritesheet") {
    const columns = Math.min(4, count);
    const rows = Math.ceil(count / columns);
    const width = columns * cell.width;
    const height = rows * cell.height;
    const sheetName = `${input.baseName}-spritesheet.png`;
    const sheetFile = path.join(outputDir, sheetName);
    const sheet = sharp({ create: { width, height, channels: 4, background: flatten ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(framePngs.map((png, index) => ({ input: png, left: (index % columns) * cell.width, top: Math.floor(index / columns) * cell.height })));
    await writeFile(sheetFile, await (flatten ? sheet.flatten({ background: flatten }) : sheet).png().toBuffer());
    const atlas = {
      frames: Object.fromEntries(names.map((name, index) => [`${name}.png`, {
        frame: { x: (index % columns) * cell.width, y: Math.floor(index / columns) * cell.height, w: cell.width, h: cell.height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: cell.width, h: cell.height },
        sourceSize: { w: cell.width, h: cell.height },
        duration: frameMs,
        phase: frames[index].phase,
      }])),
      animations: { [input.action ?? "walk"]: names.map((name) => `${name}.png`) },
      meta: { ...meta, image: sheetName, format: "RGBA8888", size: { w: width, h: height }, scale: "1" },
    };
    const atlasName = `${input.baseName}-atlas.json`;
    const atlasFile = path.join(outputDir, atlasName);
    await writeFile(atlasFile, JSON.stringify(atlas, null, 2));
    const check = await sharp(sheetFile).metadata();
    const problems: string[] = [];
    if (check.width !== width || check.height !== height) problems.push(`size ${check.width}×${check.height}`);
    if (!flatten && !check.hasAlpha) problems.push("missing alpha channel");
    if (problems.length) throw new AppError("export_invalid", 500, "The sprite sheet didn’t pass verification.", problems.join(", "));
    return {
      files: [
        { name: sheetName, path: sheetFile, type: "image/png", bytes: await sizeOf(sheetFile) },
        { name: atlasName, path: atlasFile, type: "application/json", bytes: await sizeOf(atlasFile) },
      ],
      facts: { width, height, frames: count, durationSeconds: count / settings.drawingFps },
    };
  }

  const zipName = `${input.baseName}-frames.zip`;
  const zipFile = path.join(outputDir, zipName);
  const entries = [
    ...framePngs.map((data, index) => ({ name: `${names[index]}.png`, data })),
    { name: "animation.json", data: Buffer.from(JSON.stringify(meta, null, 2)) },
  ];
  await writeFile(zipFile, writeZip(entries));
  const listed = listZip(await readFile(zipFile));
  if (listed.length !== entries.length || listed.some((entry, index) => entry.name !== entries[index].name || entry.size !== entries[index].data.length)) {
    throw new AppError("export_invalid", 500, "The frame archive didn’t pass verification.");
  }
  return {
    files: [{ name: zipName, path: zipFile, type: "application/zip", bytes: await sizeOf(zipFile) }],
    facts: { width: cell.width, height: cell.height, frames: count, durationSeconds: count / settings.drawingFps },
  };
}

/** Reads a GIF's structure: size, frame count, delays and the NETSCAPE loop count. */
export function parseGif(buffer: Buffer): { width: number; height: number; frames: number; totalDelayCs: number; loopsForever: boolean } {
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header !== "GIF89a" && header !== "GIF87a") throw new AppError("export_invalid", 500, "The GIF couldn’t be read.");
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10];
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  let frames = 0;
  let totalDelayCs = 0;
  let loopsForever = false;
  const skipSubBlocks = () => {
    while (at < buffer.length) {
      const size = buffer[at++];
      if (size === 0) return;
      at += size;
    }
  };
  while (at < buffer.length) {
    const block = buffer[at++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buffer[at++];
      if (label === 0xf9) {
        totalDelayCs += buffer.readUInt16LE(at + 2);
        at += 1 + buffer[at];
        at++; // terminator
      } else if (label === 0xff) {
        const size = buffer[at];
        const app = buffer.subarray(at + 1, at + 1 + size).toString("ascii");
        at += 1 + size;
        if (app.startsWith("NETSCAPE") && buffer[at] >= 3) loopsForever = buffer.readUInt16LE(at + 2) === 0;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
    } else if (block === 0x2c) {
      frames++;
      const local = buffer[at + 8];
      at += 9 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      at++; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new AppError("export_invalid", 500, "The GIF has an unexpected structure.");
    }
  }
  return { width, height, frames, totalDelayCs, loopsForever };
}
