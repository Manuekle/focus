import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import { thumbWidth } from "../shared/thumbs";
import { AppError } from "./errors";
import { parseRange } from "./http-range";

type ServeOptions = {
  readonly revalidate?: boolean;
  /** Asked width (`?w=`) for a picture: a WebP at most that wide, never larger than the file. Ignored for downloads. */
  readonly width?: number;
};

/**
 * Streams a local file, honoring Range. `downloadName` turns it into an attachment. `revalidate` is for a file that
 * can be rewritten under the same URL: the browser asks every time and gets 304 while it is unchanged.
 */
export async function serveFile(request: Request, file: string, type: string, downloadName?: string, options: ServeOptions = {}): Promise<Response> {
  const info = await stat(file).catch(() => null);
  if (!info) throw new AppError("media_not_found", 404, "This file is no longer available.");
  const width = type.startsWith("image/") && !downloadName ? thumbWidth(options.width) : undefined;
  if (width) return serveThumb(request, file, info, width, options.revalidate ?? false);
  const size = info.size;
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": options.revalidate ? "private, no-cache" : "private, max-age=3600",
  });
  if (options.revalidate) {
    const tag = `"${size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
    headers.set("ETag", tag);
    if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  }
  if (downloadName) {
    headers.set("Content-Disposition", `attachment; filename="${downloadName.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  }
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const stream = createReadStream(file, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
}

// Small copies of pictures for strips, cards and avatars: a full frame is often 1–3 MB of PNG where 20 KB of WebP
// does. Kept in memory up to a byte budget, so a strip scrolled back and forth is resized once.
const THUMB_BUDGET = 64 * 1024 * 1024;
const thumbs = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
let thumbBytes = 0;

async function serveThumb(request: Request, file: string, info: Stats, width: number, revalidate: boolean): Promise<Response> {
  // The source's size and time are in the tag, so a rewritten file is a new thumbnail.
  const tag = `"w${width}-${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const headers = new Headers({ "Content-Type": "image/webp", "Cache-Control": revalidate ? "private, no-cache" : "private, max-age=3600", ETag: tag, "X-Content-Type-Options": "nosniff" });
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  const body = await thumbnail(`${file}\0${tag}`, file, width);
  headers.set("Content-Length", String(body.length));
  return new Response(new Uint8Array(body), { status: 200, headers });
}

function thumbnail(key: string, file: string, width: number): Promise<Buffer> {
  const cached = thumbs.get(key);
  if (cached) {
    // Most recently used goes last; the oldest is dropped first.
    thumbs.delete(key);
    thumbs.set(key, cached);
    return Promise.resolve(cached);
  }
  const running = pending.get(key);
  if (running) return running;
  const made = sharp(file, { failOn: "none" })
    .resize({ width, height: width * 2, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, alphaQuality: 90, effort: 2 })
    .toBuffer()
    .then((buffer) => {
      thumbs.set(key, buffer);
      thumbBytes += buffer.length;
      for (const [old, kept] of thumbs) {
        if (thumbBytes <= THUMB_BUDGET) break;
        thumbs.delete(old);
        thumbBytes -= kept.length;
      }
      return buffer;
    })
    .finally(() => pending.delete(key));
  pending.set(key, made);
  return made;
}
