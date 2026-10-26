import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  experimental: { optimizePackageImports: ["@hugeicons/core-free-icons", "radix-ui"] },
};
export default config;
