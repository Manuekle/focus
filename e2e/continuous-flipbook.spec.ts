import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// All animation responses and media are fixtures; the test server also disables AI.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");
function fixture() {
  const id = randomUUID(), now = new Date().toISOString(), version = "v-000000000001";
  const poses = Array.from({ length: 96 }, (_, index) => ({ index, phase: `sample_${index}`, label: `At ${(index / 24).toFixed(2)} s`, description: "The character raises one arm gradually.", relativeRootY: 0, lift: 0 }));
  const frames = poses.map((pose) => ({ id: `s${pose.index}`, poseIndex: pose.index, phase: pose.phase, label: pose.label, status: "ready", approved: false, version, originalVersion: version, versions: [{ id: version, source: "generated", createdAt: now }], metrics: null, warnings: [], review: null, error: null }));
  return { id, imageId: randomUUID(), status: "ready", prompt: "Dance across the whole clip", title: "Continuous test", detail: null, progress: null, source: { width: 512, height: 768, hasAlpha: true }, analysis: null, sequence: { durationSeconds: 4, drawingFps: 24 }, plan: { mode: "sequence", motionId: randomUUID(), action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: 24, durationSeconds: 4, loop: false, poses }, warnings: [], reference: { kind: "original", version, reason: "Fixture reference", createdAt: now }, frames, order: frames.map((frame) => frame.id), alignment: { cellWidth: 512, cellHeight: 768, baselineY: 768, targetHeight: 768, strideX: 0, strideMeasured: false, transforms: Object.fromEntries(frames.map((frame) => [frame.id, { version, scale: 1, left: 0, top: 0, key: "1234567890abcdef" }])) }, budget: { limit: 96, used: 96 }, backgrounds: { scene: false, custom: false }, review: null, exports: [], error: null, createdAt: now, updatedAt: now };
}

test("creation defaults to 96 drawings and sends continuous settings", async ({ page }) => {
  const book = fixture();
  const image = { id: book.imageId, originalName: "character.png", width: 512, height: 768, hasAlpha: true, createdAt: book.createdAt, url: `data:image/png;base64,${pixel.toString("base64")}` };
  const analysis = { characterCount: 1, subject: "character", facing: "right", view: "side", fullBodyVisible: true, feetVisible: true, background: "plain", style: "flat", hair: "short", clothing: "shirt", accessories: [], palette: ["#3366aa"], proportions: "human", requestedAction: "walk" };
  let created: unknown;
  await page.route("**/api/flipbooks/images", (route) => route.fulfill({ status: 201, json: image }));
  await page.route(`**/api/flipbooks/images/${image.id}/look`, (route) => route.fulfill({ json: { imageId: image.id, analysis, summary: "A full-body character", setting: null, warnings: [], ideas: [], layers: { character: true, scene: false } } }));
  await page.route("**/api/flipbooks", (route) => { created = route.request().postDataJSON(); return route.fulfill({ status: 202, json: book }); });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto("/flipbook");
  await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({ name: "character.png", mimeType: "image/png", buffer: pixel });
  await expect(page.getByText(/96 drawings across 4 s/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare continuous animation", exact: true }).click();
  await expect.poll(() => created).toMatchObject({ imageId: image.id, sequence: { durationSeconds: 4, drawingFps: 24 } });
});

test("the complete timeline, finite playback and all new controls work on desktop and mobile", async ({ page }) => {
  const book = fixture();
  await page.route(`**/api/flipbooks/${book.id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByRole("heading", { name: "Continuous sequence", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("1–40 of 96", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next drawings", exact: true }).click();
  await page.getByRole("button", { name: "Next drawings", exact: true }).click();
  await page.getByRole("button", { name: /^Frame 96,/ }).click();
  await expect(page.getByRole("heading", { name: /Correct this drawing · 96/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audio", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Duplicate with another character", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Video movement reference", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/focus-continuous-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Upload audio", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/focus-continuous-mobile.png", fullPage: true });
});

test("restoring a cycle resynchronizes its drawing rate after a continuous sequence", async ({ page }) => {
  const book = fixture();
  const phases = ["dance_center", "dance_reach", "dance_open", "dance_sway", "dance_point", "dance_step", "dance_cross", "dance_return"];
  const poses = book.plan.poses.slice(0, 8).map((pose, i) => ({ ...pose, phase: phases[i] }));
  const frames = book.frames.slice(0, 8).map((frame, i) => ({ ...frame, id: `f${i}`, phase: phases[i] }));
  const plan = { ...book.plan, mode: "cycle", motionId: undefined, loop: true, drawingFps: 8, durationSeconds: 2, poses };
  const alignment = { ...book.alignment, transforms: Object.fromEntries(frames.map((frame, i) => [frame.id, book.alignment.transforms[`s${i}`]])) };
  const snapshot = { id: "v-abcdef123456", createdAt: book.createdAt, plan, frames, order: frames.map((frame) => frame.id), alignment };
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    const restore = route.request().method() === "POST" && route.request().postDataJSON()?.action === "revision";
    return route.fulfill({ json: restore ? { ...book, sequence: undefined, plan, frames, order: snapshot.order, alignment, look: { settings: { drawingFps: 8, durationSeconds: 2, motion: "in_place", aspect: "16:9", speed: 1 }, background: { kind: "color", color: "#ffffff" } }, revisions: [] } : { ...book, revisions: [snapshot] } });
  });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await page.getByLabel("Motion history").click();
  await page.getByRole("option", { name: /Cycle.*8 drawings/ }).click();
  await expect(page.getByText(/Each drawing is held for 125 ms/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "true");
});
