import { mediaLimits } from "../shared/media-limits";

// The upload limits the server enforces, read from FOCUS_MAX_VIDEO_DURATION_SECONDS
// and FOCUS_MAX_UPLOAD_MB at runtime (.env.local). Server-only: the browser
// gets just the validated numbers compiled by next.config.ts.
const limits = mediaLimits({ duration: process.env.FOCUS_MAX_VIDEO_DURATION_SECONDS, uploadMb: process.env.FOCUS_MAX_UPLOAD_MB });

export const SERVER_MAX_DURATION_SECONDS = limits.maxDurationSeconds;
export const SERVER_MAX_UPLOAD_BYTES = limits.maxUploadMb * 1024 * 1024;
