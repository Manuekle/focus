import { randomUUID } from "node:crypto";
import { test } from "@playwright/test";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");

function fixture(id: string) {
  const now = new Date().toISOString(), version = "v-000000000001";
  const poses = Array.from({ length: 96 }, (_, index) => ({ index, phase: `sample_${index}`, label: `At ${(index / 24).toFixed(2)} s`, description: "The character raises one arm gradually.", relativeRootY: 0, lift: 0 }));
  const frames = poses.map((pose) => ({ id: `s${pose.index}`, poseIndex: pose.index, phase: pose.phase, label: pose.label, status: "ready", approved: false, version, originalVersion: version, versions: [{ id: version, source: "generated", createdAt: now }], metrics: null, warnings: [], review: null, error: null }));
  return {
    id,
    imageId: randomUUID(),
    status: "ready",
    prompt: "Dance across the whole clip",
    title: "Continuous test",
    detail: null,
    progress: null,
    source: { width: 512, height: 768, hasAlpha: true },
    analysis: null,
    sequence: { durationSeconds: 4, drawingFps: 24 },
    plan: { mode: "sequence", motionId: randomUUID(), action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: 24, durationSeconds: 4, loop: false, poses },
    warnings: [],
    reference: { kind: "original", version, reason: "Fixture reference", createdAt: now },
    frames,
    order: frames.map((frame) => frame.id),
    alignment: { cellWidth: 512, cellHeight: 768, baselineY: 768, targetHeight: 768, strideX: 0, strideMeasured: false, transforms: Object.fromEntries(frames.map((frame) => [frame.id, { version, scale: 1, left: 0, top: 0, key: "1234567890abcdef" }])) },
    budget: { limit: 96, used: 96 },
    backgrounds: { scene: false, custom: false },
    audio: {
      version: "v-000000000002",
      name: "ScreenRecording_12-12-2025 10-03-04_1.mp3",
      durationSeconds: 16.4,
      offset: 0,
      startsAt: 0,
      volume: 1,
      createdAt: now,
    },
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

test("reproduce exact flipbook pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const flipbookId = "e43bd63d-12a4-44da-a59a-f98d33dba5af";
  const book = fixture(flipbookId);

  await page.route(`**/api/flipbooks/${flipbookId}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${flipbookId}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: randomUUID(), name: "User" } } }));

  // Go to URL 1
  await page.goto(`/flipbook?f=${flipbookId}`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/Users/manudev/.gemini/antigravity-cli/brain/4b661ead-3f71-4d2c-bddd-b4aa6986e645/scratch/exact_editor_top.png" });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/Users/manudev/.gemini/antigravity-cli/brain/4b661ead-3f71-4d2c-bddd-b4aa6986e645/scratch/exact_editor_scrolled.png" });
});
