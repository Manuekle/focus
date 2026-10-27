import {
  DURATION_TOLERANCE_SECONDS,
  MAX_SOURCE_DIMENSION,
  MIN_DIMENSION,
  NORMALIZED_LONG_SIDE,
  NORMALIZED_SHORT_SIDE,
} from "../shared/media";
import type { SourceMedia } from "../shared/schemas";
import { AppError } from "./errors";
import { SERVER_MAX_DURATION_SECONDS as MAX_DURATION_SECONDS } from "./media-limits";
import type { Probe, ProbeStream } from "./ffmpeg";

// Pure functions over FFprobe output: what the file actually is, not what its
// extension or MIME type claims.

const ACCEPTED_CONTAINERS = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"];

export function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!Number.isFinite(num)) return 0;
  if (den === undefined) return num;
  return den > 0 ? num / den : 0;
}

function rotationOf(stream: ProbeStream): number {
  const fromSideData = stream.side_data_list?.find((entry) => typeof entry.rotation === "number")?.rotation;
  if (typeof fromSideData === "number") return fromSideData;
  const fromTag = Number(stream.tags?.rotate);
  return Number.isFinite(fromTag) ? fromTag : 0;
}

/** Validates a probe and returns the media facts the rest of the pipeline uses. */
export function describeSource(probe: Probe, sizeBytes: number): SourceMedia {
  const containers = probe.format.format_name.split(",");
  if (!containers.some((name) => ACCEPTED_CONTAINERS.includes(name))) {
    throw new AppError("unsupported_container", 415, "Formato no compatible. Sube un archivo MP4 o MOV.");
  }

  const video = probe.streams.find((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  if (!video || !video.width || !video.height) {
    throw new AppError("no_video_stream", 422, "El archivo no contiene una pista de video legible.");
  }

  const rotation = rotationOf(video);
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = quarterTurn ? video.height : video.width;
  const height = quarterTurn ? video.width : video.height;

  if (Math.min(width, height) < MIN_DIMENSION) {
    throw new AppError("resolution_too_small", 422, `El video es demasiado pequeño (${width}×${height}). Usa al menos ${MIN_DIMENSION} px por lado.`);
  }
  if (Math.max(width, height) > MAX_SOURCE_DIMENSION) {
    throw new AppError("resolution_too_large", 422, `La resolución ${width}×${height} supera el máximo de ${MAX_SOURCE_DIMENSION} px.`);
  }

  const durationSeconds = Number(probe.format.duration ?? video.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AppError("unknown_duration", 422, "No pudimos leer la duración del video. Exporta el archivo de nuevo e inténtalo otra vez.");
  }
  if (durationSeconds > MAX_DURATION_SECONDS + DURATION_TOLERANCE_SECONDS) {
    throw new AppError(
      "duration_too_long",
      422,
      `El video dura ${durationSeconds.toFixed(1)} s. Recórtalo a ${MAX_DURATION_SECONDS} s o menos y vuelve a subirlo.`,
    );
  }

  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  if (!(fps > 0)) {
    throw new AppError("unknown_frame_rate", 422, "No pudimos leer la cadencia de fotogramas del video.");
  }

  return {
    sizeBytes,
    container: containers[0],
    codec: video.codec_name ?? "unknown",
    width,
    height,
    rotation,
    durationSeconds,
    fps: Math.round(fps * 1000) / 1000,
    hasAudio: probe.streams.some((stream) => stream.codec_type === "audio"),
  };
}

/** Fits display dimensions inside ~720p, keeps aspect ratio, never upscales, even sizes for H.264. */
export function normalizedDimensions(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, NORMALIZED_LONG_SIDE / long, NORMALIZED_SHORT_SIDE / short);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}
