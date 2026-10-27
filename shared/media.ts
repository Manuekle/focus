import { mediaLimits } from "./media-limits";

// Media limits shared by the browser and the server. The server re-checks
// everything with FFprobe; the browser copy only avoids a pointless upload.
//
// These are the validated copies next.config.ts compiles from the server's
// FOCUS_MAX_VIDEO_DURATION_SECONDS / FOCUS_MAX_UPLOAD_MB (NEXT_PUBLIC_FOCUS_MAX_*).
// The server enforces the runtime values (server/media-limits.ts): change the
// variables, then rebuild (or restart pnpm dev) so the interface matches.
const limits = mediaLimits({
  duration: process.env.NEXT_PUBLIC_FOCUS_MAX_VIDEO_DURATION_SECONDS,
  uploadMb: process.env.NEXT_PUBLIC_FOCUS_MAX_UPLOAD_MB,
});

export const MAX_UPLOAD_BYTES = limits.maxUploadMb * 1024 * 1024;
export const MAX_DURATION_SECONDS = limits.maxDurationSeconds;
/** Container rounding: a "10 s" export often probes as 10.02 s. */
export const DURATION_TOLERANCE_SECONDS = 0.1;
export const MIN_DIMENSION = 64;
export const MAX_SOURCE_DIMENSION = 4096;

/** Normalized media: the single version both segmentation and compositing use. */
export const NORMALIZED_FPS = 24;
export const NORMALIZED_LONG_SIDE = 1280;
export const NORMALIZED_SHORT_SIDE = 720;

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export const ACCEPTED_VIDEO_EXTENSIONS = [".mp4", ".mov"] as const;
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_VIDEO_TYPES, ...ACCEPTED_VIDEO_EXTENSIONS].join(",");

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isAcceptedVideoType(type: string): boolean {
  return (ACCEPTED_VIDEO_TYPES as readonly string[]).includes(type);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
