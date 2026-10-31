import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { AppError } from "./errors";
import { parseRange } from "./http-range";

/**
 * Streams a local file, honoring Range. `downloadName` turns it into an attachment. `revalidate` is for a file that
 * can be rewritten under the same URL: the browser asks every time and gets 304 while it is unchanged.
 */
export async function serveFile(request: Request, file: string, type: string, downloadName?: string, options: { readonly revalidate?: boolean } = {}): Promise<Response> {
  const info = await stat(file).catch(() => null);
  if (!info) throw new AppError("media_not_found", 404, "This file is no longer available.");
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
