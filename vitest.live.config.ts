import { defineConfig } from "vitest/config";

// Paid Meta API tests. Run explicitly with `pnpm test:live`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.live.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 300_000,
  },
});
