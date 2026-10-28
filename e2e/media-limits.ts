import { readFileSync } from "node:fs";
import path from "node:path";
import { mediaLimits } from "../shared/media-limits";

// Read the production build's limits, including overrides used by Railway.
const build = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", ".next", "required-server-files.json"), "utf8")) as {
  config: { env: Record<string, string> };
};
export const limits = mediaLimits({
  duration: build.config.env.NEXT_PUBLIC_FOCUS_MAX_VIDEO_DURATION_SECONDS,
  uploadMb: build.config.env.NEXT_PUBLIC_FOCUS_MAX_UPLOAD_MB,
});
