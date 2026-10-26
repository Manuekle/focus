import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AppError } from "./errors";
import { parseRange } from "./http-range";
import { parseVideoId } from "./storage";
import { mediaFile, type MediaVariant } from "./videos";

const VARIANTS: readonly MediaVariant[] = ["normalized", "poster", "source"];

/** Serves a stored file with byte-range support — what lets Safari play and every browser seek. */
export async function mediaResponse(request: Request, id: string): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("variant") ?? "normalized";
  const variant = VARIANTS.find((name) => name === requested);
  if (!variant) throw new AppError("invalid_variant", 400, "Variante de archivo desconocida.");

  const file = await mediaFile(parseVideoId(id), variant);
  const headers = new Headers({
    "Content-Type": file.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });

  const range = parseRange(request.headers.get("range"), file.size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const stream = createReadStream(file.path, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(file.size));
  return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, { status: 200, headers });
}
