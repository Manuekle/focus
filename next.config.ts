import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
};
export default config;
