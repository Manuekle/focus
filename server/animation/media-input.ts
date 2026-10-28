import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { AppError } from "../errors";
import { Limiter } from "../ai/meta";

export const mediaLimiter = ((globalThis as { __focusAnimationMedia?: Limiter }).__focusAnimationMedia ??= new Limiter(2));

export async function receiveMedia(body: ReadableStream<Uint8Array> | null, declaredBytes: number | undefined, file: string, limit: number, video = false): Promise<void> {
  if (!body) throw new AppError("empty_file", 400, "Choose a media file.");
  if (declaredBytes !== undefined && declaredBytes > limit) throw new AppError("file_too_large", 413, `Choose a file smaller than ${Math.floor(limit / 1024 / 1024)} MB.`);
  await mkdir(path.dirname(file), { recursive: true });
  let size = 0;
  try {
    await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > limit ? new AppError("file_too_large", 413, "This media file is too large.") : null, chunk);
    } }), createWriteStream(file));
    const handle = await open(file, "r");
    const prefix = Buffer.alloc(128);
    try { await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
    const text = prefix.toString("utf8").trimStart();
    if (!size || /^(?:#EXT|ffconcat|https?:|file:|<\?xml|<MPD)/i.test(text) || (video && !["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(prefix.toString("ascii", 4, 8)))) {
      throw new AppError("unreadable_media", 422, video ? "Upload an MP4 or MOV file, not a playlist or a link." : "Upload an audio file, not a playlist or a link.");
    }
  } catch (error) { await rm(file, { force: true }); throw error; }
}
