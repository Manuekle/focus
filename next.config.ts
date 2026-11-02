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
  // Phone testing goes through a Cloudflare tunnel (`cloudflared tunnel --url http://127.0.0.1:3200`);
  // without its hostname the dev server blocks its own /_next assets and HMR socket. Named tunnels: FOCUS_DEV_ORIGINS=app.example.com,...
  allowedDevOrigins: ["*.trycloudflare.com", ...(process.env.FOCUS_DEV_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [])],
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
  // The animation-principles SKILL.md files are read at runtime (server/policies/loader.ts) and verified by hash.
  outputFileTracingIncludes: { "/api/rotoscope/**": ["./server/policies/skills/**/*"] },
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
  // public/ files have no hash in their names, so Next sends them with max-age=0 and every visit asks again.
  // Fonts and pictures change rarely: keep them a while, and refresh in the background once stale.
  async headers() {
    const cache = (source: string, maxAge: number) => ({ source, headers: [{ key: "Cache-Control", value: `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 7}` }] });
    const day = 86_400;
    return [
      cache("/fonts/:path*", 30 * day),
      ...["/backgrounds", "/demo", "/logos", "/characters", "/patterns", "/textures", "/brand"].map((dir) => cache(`${dir}/:path*`, day)),
    ];
  },
};
export default config;
