import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  MAX_UPLOAD_BYTES,
  NORMALIZED_FPS,
  formatBytes,
  hasAcceptedExtension,
} from "../shared/media";
import { VideoAssetSchema, type NormalizedMedia, type VideoAsset, type VideoId } from "../shared/schemas";
import { Limiter } from "./ai/meta";
import { AppError } from "./errors";
import { MediaToolError, ffmpeg, probe } from "./ffmpeg";
import { describeSource, normalizedDimensions, parseRate } from "./media-validation";
import { VIDEO_FILES, createVideoDir, parseVideoId, removeVideoDir, videoDir } from "./storage";

export type IngestInput = {
  readonly body: ReadableStream<Uint8Array>;
  readonly fileName: string;
  readonly declaredBytes?: number;
};

const normalizeLimiter = ((globalThis as { __focusNormalize?: Limiter }).__focusNormalize ??= new Limiter(2));

function cleanFileName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f]/g, "").trim();
  return base.slice(0, 255) || "video";
}

/** Streams the body to disk and stops as soon as it passes the size limit. */
async function writeLimited(body: ReadableStream<Uint8Array>, target: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) callback(tooLarge());
      else callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), limiter, createWriteStream(target));
  return bytes;
}

function tooLarge(): AppError {
  return new AppError("file_too_large", 413, `El archivo supera ${formatBytes(MAX_UPLOAD_BYTES)}. Exporta una versión más corta o más ligera.`);
}

/**
 * Upload → validate with FFprobe → normalize once with FFmpeg.
 *
 * The normalized file (≈720p, 24 fps CFR, H.264, rotation applied) is what the
 * editor previews and what every later stage — segmentation and compositing —
 * reads, so masks and frames always share dimensions and frame indexing.
 */
export async function ingestVideo({ body, fileName, declaredBytes }: IngestInput): Promise<VideoAsset> {
  const originalName = cleanFileName(fileName);
  if (!hasAcceptedExtension(originalName)) {
    throw new AppError("unsupported_type", 415, "Formato no compatible. Sube un archivo MP4 o MOV.");
  }
  if (declaredBytes !== undefined && declaredBytes > MAX_UPLOAD_BYTES) throw tooLarge();

  const id = randomUUID();
  const dir = await createVideoDir(id);
  try {
    const extension = path.extname(originalName).toLowerCase();
    const sourcePath = path.join(dir, VIDEO_FILES.source(extension));
    const sizeBytes = await writeLimited(body, sourcePath);
    if (sizeBytes === 0) throw new AppError("empty_file", 400, "El archivo está vacío.");

    const source = describeSource(await probeOrReject(sourcePath), sizeBytes);
    // FFmpeg normalization is CPU-heavy: at most two at a time per instance.
    const normalized = await normalizeLimiter.run(() => normalize(sourcePath, dir, source.width, source.height, source.hasAudio));

    const asset: VideoAsset = {
      id,
      originalName,
      createdAt: new Date().toISOString(),
      source,
      normalized,
      urls: {
        preview: `/api/videos/${id}/media?variant=normalized`,
        poster: `/api/videos/${id}/media?variant=poster`,
        source: `/api/videos/${id}/media?variant=source`,
      },
    };
    await writeFile(path.join(dir, VIDEO_FILES.asset), JSON.stringify(asset, null, 2));
    return asset;
  } catch (error) {
    await removeVideoDir(id);
    throw error;
  }
}

/** FFmpeg's own words, tail only, with server paths removed. */
function toolDetail(error: unknown, dir: string): string | undefined {
  if (!(error instanceof MediaToolError)) return undefined;
  return error.stderr.replaceAll(dir + path.sep, "").replaceAll(dir, "").trim().slice(-400) || undefined;
}

async function probeOrReject(file: string) {
  try {
    return await probe(file);
  } catch (error) {
    throw new AppError(
      "unreadable_media",
      422,
      "No pudimos leer este archivo como video. Puede estar dañado o usar un formato no compatible.",
      toolDetail(error, path.dirname(file)),
    );
  }
}

async function normalize(
  sourcePath: string,
  dir: string,
  width: number,
  height: number,
  hasAudio: boolean,
): Promise<NormalizedMedia> {
  const target = normalizedDimensions(width, height);
  const output = path.join(dir, VIDEO_FILES.normalized);
  try {
    // FFmpeg autorotates by default, so the display-oriented size above is
    // also the size of the frames it produces.
    await ffmpeg([
      "-i", sourcePath,
      "-map", "0:v:0",
      ...(hasAudio ? ["-map", "0:a:0"] : []),
      "-vf", `scale=${target.width}:${target.height}:flags=lanczos,fps=${NORMALIZED_FPS},format=yuv420p,setsar=1`,
      "-fps_mode", "cfr",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-profile:v", "high",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ac", "2"] : ["-an"]),
      "-movflags", "+faststart",
      output,
    ]);
    await ffmpeg(["-i", output, "-frames:v", "1", "-q:v", "3", path.join(dir, VIDEO_FILES.poster)]);
  } catch (error) {
    throw new AppError(
      "normalization_failed",
      422,
      "No pudimos preparar este video para editarlo. Exporta el archivo como MP4 (H.264) e inténtalo de nuevo.",
      toolDetail(error, dir),
    );
  }

  const result = await probe(output);
  const video = result.streams.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new AppError("normalization_failed", 500, "La normalización no produjo un video válido.");
  const durationSeconds = Number(result.format.duration ?? video.duration);
  const fps = parseRate(video.avg_frame_rate) || NORMALIZED_FPS;
  const frameCount = Number(video.nb_frames) || Math.max(1, Math.round(durationSeconds * fps));
  return {
    width: video.width,
    height: video.height,
    fps,
    frameCount,
    durationSeconds,
    codec: "h264",
    hasAudio: result.streams.some((stream) => stream.codec_type === "audio"),
  };
}

export async function getVideo(id: string): Promise<VideoAsset> {
  const videoId = parseVideoId(id);
  try {
    const raw = await readFile(path.join(videoDir(videoId), VIDEO_FILES.asset), "utf8");
    return VideoAssetSchema.parse(JSON.parse(raw));
  } catch {
    throw new AppError("video_not_found", 404, "Ese video no existe o ya se eliminó.");
  }
}

export async function deleteVideo(id: string): Promise<void> {
  await removeVideoDir(parseVideoId(id));
}

export type MediaVariant = "normalized" | "poster" | "source";

export async function mediaFile(id: VideoId, variant: MediaVariant): Promise<{ path: string; size: number; type: string }> {
  const asset = await getVideo(id);
  const dir = videoDir(asset.id);
  const file =
    variant === "normalized"
      ? VIDEO_FILES.normalized
      : variant === "poster"
        ? VIDEO_FILES.poster
        : VIDEO_FILES.source(path.extname(asset.originalName).toLowerCase());
  const type =
    variant === "poster" ? "image/jpeg" : file.endsWith(".mov") ? "video/quicktime" : "video/mp4";
  const full = path.join(dir, file);
  const info = await stat(full).catch(() => null);
  if (!info) throw new AppError("media_not_found", 404, "Ese archivo ya no está disponible.");
  return { path: full, size: info.size, type };
}
