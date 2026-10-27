// Upload limits, configured on the server (.env.local):
//
//   FOCUS_MAX_VIDEO_DURATION_SECONDS=60
//   FOCUS_MAX_UPLOAD_MB=150
//
// No imports: next.config.ts uses this file too, to compile the validated
// numbers (never the raw variables) into the browser bundle.

export const DEFAULT_MAX_VIDEO_DURATION_SECONDS = 60;
export const DEFAULT_MAX_UPLOAD_MB = 150;
/** SAM 3.1 tracks at most 15,000 frames per request: about 10 minutes at 24 fps. */
export const VIDEO_DURATION_RANGE = [1, 600] as const;
export const UPLOAD_MB_RANGE = [1, 1024] as const;

/** A whole number inside the range, or the default for anything missing, malformed or out of range. */
export function parseLimit(value: string | undefined, fallback: number, [min, max]: readonly [number, number]): number {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return fallback;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : fallback;
}

export type MediaLimits = { readonly maxDurationSeconds: number; readonly maxUploadMb: number };

export function mediaLimits(env: { readonly duration?: string; readonly uploadMb?: string }): MediaLimits {
  return {
    maxDurationSeconds: parseLimit(env.duration, DEFAULT_MAX_VIDEO_DURATION_SECONDS, VIDEO_DURATION_RANGE),
    maxUploadMb: parseLimit(env.uploadMb, DEFAULT_MAX_UPLOAD_MB, UPLOAD_MB_RANGE),
  };
}
