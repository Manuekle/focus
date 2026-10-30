import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { type AnimationAsset, type AssetKind } from "../../shared/reference-motion";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { SERVER_MAX_UPLOAD_BYTES } from "../media-limits";
import { describeSource, normalizedDimensions } from "../media-validation";
import { decodeImage, readUpload } from "../animation/image-input";
import { mediaLimiter, receiveMedia } from "../animation/media-input";
import { writeAtomic } from "../animation/store";
import { assetFiles, writeAsset } from "./store";

// Uploads for Reference Motion. Bytes are decoded for real (Sharp, FFprobe),
// never trusted by extension or MIME type, then normalized once: the
// character to a PNG flattened on white, the driving video to H.264 at a
// constant 24 fps with rotation applied. Variable frame rates and HEVC are
// converted here, before any GPU time is spent.

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function cleanName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "upload";
}

export async function ingestAsset(input: { kind: AssetKind; ownerId: string; body: ReadableStream<Uint8Array> | null; declaredBytes?: number; fileName: string }): Promise<AnimationAsset> {
  const id = randomUUID();
  const dir = assetFiles.dir(id);
  await mkdir(dir, { recursive: true });
  try {
    return input.kind === "character" ? await ingestCharacter(id, input) : await ingestDriving(id, input);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function ingestCharacter(id: string, input: Parameters<typeof ingestAsset>[0]): Promise<AnimationAsset> {
  const decoded = await decodeImage(await readUpload(input.body, input.declaredBytes), { minDimension: 256 });
  const file = assetFiles.media({ id, kind: "character" });
  // The engines take an RGB reference; transparency becomes the plain background they expect.
  await writeAtomic(file, decoded.flat);
  return writeAsset({
    id,
    ownerId: input.ownerId,
    kind: "character",
    originalName: cleanName(input.fileName),
    mime: "image/png",
    bytes: decoded.flat.byteLength,
    checksum: await sha256File(file),
    width: decoded.width,
    height: decoded.height,
    createdAt: new Date().toISOString(),
  });
}

async function ingestDriving(id: string, input: Parameters<typeof ingestAsset>[0]): Promise<AnimationAsset> {
  const raw = path.join(assetFiles.dir(id), "upload.bin");
  await receiveMedia(input.body, input.declaredBytes, raw, SERVER_MAX_UPLOAD_BYTES, true);
  try {
    const source = describeSource(await probe(raw, true), (await stat(raw)).size);
    if (source.durationSeconds < 1) throw new AppError("INPUT_INVALID", 422, "Choose a movement video at least one second long.");
    const size = normalizedDimensions(source.width, source.height);
    const file = assetFiles.media({ id, kind: "driving" });
    await mediaLimiter.run(() => ffmpeg([
      "-protocol_whitelist", "file,pipe", "-i", raw,
      "-map", "0:v:0", ...(source.hasAudio ? ["-map", "0:a:0"] : []),
      "-vf", `scale=${size.width}:${size.height},fps=24,setsar=1`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      ...(source.hasAudio ? ["-c:a", "aac", "-ac", "2"] : ["-an"]),
      "-movflags", "+faststart", file,
    ], Math.max(120_000, Math.ceil(source.durationSeconds) * 10_000)));
    await mediaLimiter.run(() => ffmpeg(["-protocol_whitelist", "file,pipe", "-i", file, "-frames:v", "1", "-q:v", "4", assetFiles.poster(id)]));
    const normalized = describeSource(await probe(file, true), (await stat(file)).size);
    return await writeAsset({
      id,
      ownerId: input.ownerId,
      kind: "driving",
      originalName: cleanName(input.fileName),
      mime: "video/mp4",
      bytes: normalized.sizeBytes,
      checksum: await sha256File(file),
      width: normalized.width,
      height: normalized.height,
      durationSeconds: normalized.durationSeconds,
      fps: 24,
      hasAudio: normalized.hasAudio,
      createdAt: new Date().toISOString(),
    });
  } finally {
    await rm(raw, { force: true });
  }
}
