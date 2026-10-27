import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  // Always compile an explicit boolean, even when the variable is absent.
  // Only this public release value is exposed; server credentials stay private.
  env: { NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS: process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS === "true" ? "true" : "false" },
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
};
export default config;
