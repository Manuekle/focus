import { defineConfig } from "@playwright/test";

// Browser E2E against the production build. Meta AI is switched off
// (FOCUS_AI_DISABLED=1): these tests never spend credits. The live Meta path
// is covered by `pnpm test:live` and by the documented manual journey.
const PORT = 3401;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  // All files share one server, data directory and CPU render queue.
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Uses the installed Chrome when present; otherwise run `pnpm exec playwright install chromium`.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    viewport: { width: 1280, height: 800 },
  },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Override only the start-time value to verify Next's compiled flag.
      NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS: process.env.FOCUS_E2E_RUNTIME_TEMPORAL_EFFECTS ?? process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS ?? "false",
      FOCUS_AI_DISABLED: "1",
      FOCUS_DATA_DIR: ".focus-data-e2e",
      MODEL_API_KEY: "",
      META_API_KEY: "",
    },
  },
});
