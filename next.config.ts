import type { NextConfig } from "next";
import { mediaLimits, parseLimit } from "./shared/media-limits";

// Upload limits come from the server's FOCUS_* variables (.env.local); only
// their validated numbers reach the browser.
const limits = mediaLimits({ duration: process.env.FOCUS_MAX_VIDEO_DURATION_SECONDS, uploadMb: process.env.FOCUS_MAX_UPLOAD_MB });

const config: NextConfig = {
  devIndicators: false,
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Always compile an explicit boolean, even when the variable is absent.
  // Only this public release value is exposed; server credentials stay private.
  env: {
    NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS: process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS === "true" ? "true" : "false",
    NEXT_PUBLIC_ENABLE_FLIPBOOK: process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK === "true" ? "true" : "false",
    NEXT_PUBLIC_FOCUS_MAX_VIDEO_DURATION_SECONDS: String(limits.maxDurationSeconds),
    NEXT_PUBLIC_FOCUS_MAX_UPLOAD_MB: String(limits.maxUploadMb),
    NEXT_PUBLIC_FOCUS_MAX_IMAGE_UPLOAD_MB: String(parseLimit(process.env.FOCUS_MAX_IMAGE_UPLOAD_MB, 15, [1, 15])),
  },
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
};
export default config;
