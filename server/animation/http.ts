import path from "node:path";
import { readFile } from "node:fs/promises";
import { FrameIdSchema, orderedFrames } from "../../shared/flipbook";
import { AppError } from "../errors";
import { guardAiRequest } from "../guard";
import type { PaidWorkGate } from "../jobs";
import { serveFile } from "../serve-file";
import { contactSheet } from "./quality-control";
import { flipbookFiles, getFlipbook } from "./store";

// Small pieces shared by the Flipbook route handlers: the paid-work gate,
// upload sizes, and the media endpoint that serves only files the flipbook's
// own state names.

export function declaredLength(request: Request): number | undefined {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

/** Every paid Flipbook call passes the same abuse and budget guards as a video edit. */
export function paidGate(request: Request): PaidWorkGate {
  return (cost) => guardAiRequest(request, cost);
}

export function parseFrame(value: string) {
  const parsed = FrameIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  return parsed.data;
}

export async function flipbookMedia(request: Request, id: string): Promise<Response> {
  const flipbook = await getFlipbook(id);
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
    case "raw": {
      const frame = flipbook.frames.find((entry) => entry.id === parseFrame(search.get("frame") ?? ""));
      const version = search.get("v") ?? "";
      if (!frame?.versions.some((entry) => entry.id === version)) throw new AppError("media_not_found", 404, "This file is no longer available.");
      return png(path.join(flipbookFiles.versionDir(flipbook.id, frame.id, version), "raw.png"));
    }
    case "sprite":
      return png(flipbookFiles.sprite(flipbook.id, parseFrame(search.get("frame") ?? ""), search.get("a") ?? ""));
    case "scene":
    case "custom":
      if (!flipbook.backgrounds[kind]) throw new AppError("media_not_found", 404, "This file is no longer available.");
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
      const frames = orderedFrames(flipbook).filter((frame) => frame.version && alignment?.transforms[frame.id]?.version === frame.version);
      if (!alignment || !frames.length) throw new AppError("media_not_found", 404, "There are no drawings to show yet.");
      const sprites = await Promise.all(frames.map((frame) => readFile(flipbookFiles.sprite(flipbook.id, frame.id, alignment.transforms[frame.id]!.key))));
      const sheet = await contactSheet(sprites, { width: alignment.cellWidth, height: alignment.cellHeight });
      return new Response(new Uint8Array(sheet), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
    }
    default:
      throw new AppError("invalid_variant", 400, "Unknown file kind.");
  }
}
