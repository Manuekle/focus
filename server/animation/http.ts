import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { DrawingIdSchema, FrameIdSchema, orderedFrames } from "../../shared/flipbook";
import { AppError } from "../errors";
import { guardAiRequest } from "../guard";
import type { PaidWorkGate } from "../jobs";
import { serveFile } from "../serve-file";
import { ensureSceneLoop } from "./flipbooks";
import { contactSheet } from "./quality-control";
import { flipbookFiles } from "./store";
import { requireFlipbookAccess } from "./access";

// Small pieces shared by the Flipbook route handlers: the paid-work gate,
// upload sizes, and the media endpoint that serves only files the flipbook's
// own state names.

export function declaredLength(request: Request): number | undefined {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

/** Every paid Flipbook call passes the same abuse and budget guards as a video edit. */
export function paidGate(request: Request, options: { charge?: boolean; continuation?: boolean } = {}): PaidWorkGate {
  return (cost) => guardAiRequest(request, cost, options);
}

export function parseFrame(value: string) {
  const parsed = FrameIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  return parsed.data;
}

/** A key drawing or an in-between, for media that both have. */
function parseDrawing(value: string) {
  const parsed = DrawingIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  return parsed.data;
}

export async function flipbookMedia(request: Request, id: string): Promise<Response> {
  const flipbook = await requireFlipbookAccess(request, id);
  const search = new URL(request.url).searchParams;
  const kind = search.get("kind");
  const png = (file: string) => serveFile(request, file, "image/png");
  switch (kind) {
    case "source":
      return png(flipbookFiles.source(flipbook.id));
    case "reference": {
      const version = search.get("v") ?? flipbook.reference?.version;
      if (!version) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.reference(flipbook.id, version));
    }
    case "extra": {
      const version = search.get("v") ?? "";
      if (!flipbook.extraReferences.some((entry) => entry.version === version)) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.extraReference(flipbook.id, version));
    }
    case "raw": {
      const frame = flipbook.frames.find((entry) => entry.id === parseFrame(search.get("frame") ?? ""));
      const version = search.get("v") ?? "";
      if (!frame?.versions.some((entry) => entry.id === version)) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(path.join(flipbookFiles.versionDir(flipbook.id, frame.id, version), "raw.png"));
    }
    case "sprite": {
      const file = flipbookFiles.sprite(flipbook.id, parseDrawing(search.get("frame") ?? ""), search.get("a") ?? "");
      if (search.get("thumb") === "1") return new Response(new Uint8Array(await sharp(file).resize(120, 120, { fit: "inside" }).png().toBuffer()), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
      return png(file);
    }
    case "scene":
    case "custom":
      if (!flipbook.backgrounds[kind]) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.background(flipbook.id, kind));
    case "bg-reference":
      if (!flipbook.backgrounds.reference) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.background(flipbook.id, kind));
    case "scene-loop":
      if (!flipbook.backgrounds.scene) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(await ensureSceneLoop(flipbook.id));
    case "generated":
    case "generated-loop":
      if (!flipbook.backgrounds.generated) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.background(flipbook.id, kind));
    case "scene-far":
    case "scene-near":
    case "generated-far":
    case "generated-near":
      if (!flipbook.backgrounds.depth[kind.startsWith("scene") ? "scene" : "generated"]) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(flipbookFiles.background(flipbook.id, kind));
    case "export": {
      const record = flipbook.exports.find((entry) => entry.key === search.get("x"));
      const file = record?.files.find((entry) => entry.name === search.get("name"));
      if (!record || !file) throw new AppError("media_not_found", 404, "This export is no longer available.");
      return serveFile(request, path.join(flipbookFiles.exportDir(flipbook.id, record.key), file.name), file.type, search.get("download") === "1" ? file.name : undefined);
    }
    case "contact": {
      // Every registered drawing in playback order on one sheet, for review by eye.
      const alignment = flipbook.alignment;
      const page = Number(search.get("page") ?? "0");
      if (!Number.isInteger(page) || page < 0 || page > 29) throw new AppError("invalid_variant", 400, "Choose a valid contact-sheet page.");
      const ordered = orderedFrames(flipbook);
      const frames = (flipbook.sequence ? ordered.slice(page * 16, page * 16 + 16) : ordered).filter((frame) => frame.version && alignment?.transforms[frame.id]?.version === frame.version);
      if (!alignment || !frames.length) throw new AppError("media_not_found", 404, "There are no drawings to show yet.");
      const sprites = await Promise.all(frames.map((frame) => readFile(flipbookFiles.sprite(flipbook.id, frame.id, alignment.transforms[frame.id]!.key))));
      const sheet = await contactSheet(sprites, { width: alignment.cellWidth, height: alignment.cellHeight });
      return new Response(new Uint8Array(sheet), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
    }
    default:
      throw new AppError("invalid_variant", 400, "Unknown file kind.");
  }
}
