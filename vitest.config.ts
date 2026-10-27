import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"],
    // Live Meta API tests run only on demand: pnpm test:live
    exclude: ["**/*.live.test.ts", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Suites encode real video: bound concurrent FFmpeg/sharp workloads.
    maxWorkers: 1,
  },
});
