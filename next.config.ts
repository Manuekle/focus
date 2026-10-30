import type { NextConfig } from "next";
import { mediaLimits, parseLimit } from "./shared/media-limits";
import { loadStoredSettings } from "./server/settings";

// Values saved on the settings page (<FOCUS_DATA_DIR>/settings/env.json) join
// the environment before anything below reads it, so build-time flags and
// limits saved there apply on the next `pnpm dev` start or `next build`.
loadStoredSettings();

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
    NEXT_PUBLIC_ENABLE_REFERENCE_MOTION: process.env.NEXT_PUBLIC_ENABLE_REFERENCE_MOTION === "true" ? "true" : "false",
    NEXT_PUBLIC_ENABLE_ROTOSCOPE: process.env.NEXT_PUBLIC_ENABLE_ROTOSCOPE === "true" ? "true" : "false",
    NEXT_PUBLIC_FOCUS_MAX_VIDEO_DURATION_SECONDS: String(limits.maxDurationSeconds),
    NEXT_PUBLIC_FOCUS_MAX_UPLOAD_MB: String(limits.maxUploadMb),
    NEXT_PUBLIC_FOCUS_MAX_IMAGE_UPLOAD_MB: String(parseLimit(process.env.FOCUS_MAX_IMAGE_UPLOAD_MB, 15, [1, 15])),
  },
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
};
export default config;
