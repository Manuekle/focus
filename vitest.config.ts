import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    // Live Meta API tests run only on demand: pnpm test:live
    exclude: ["**/*.live.test.ts", "node_modules/**"],
    testTimeout: 60_000,
  },
});
