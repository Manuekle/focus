import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { limits } from "./media-limits";

const fixture = (name: string) => path.join(import.meta.dirname, ".fixtures", name);

async function uploadClip(page: Page) {
  const normalized = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/videos" && response.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles(fixture("clip.mp4"));
  expect((await normalized).status()).toBe(201);
}

test("plays the before / after demo without blocking the studio", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const demo = page.locator("[data-home-demo]");
  await expect(demo).toBeVisible();
  await demo.scrollIntoViewIfNeeded();
  await expect.poll(() => demo.locator("video").evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
  const divider = demo.getByRole("slider", { name: "Before and after divider" });
  await divider.focus();
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "0");
  await demo.getByRole("button", { name: "Pause demo" }).click();
  await expect(demo.getByRole("button", { name: "Play demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Drop your video here/ })).toBeEnabled();
  await expect(page.getByLabel("Describe the change")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Your drawings\.\s*In motion\.$/ })).toBeVisible();
});

test("shows the studio immediately and holds the demo still when motion is reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("[data-home-demo] video")).toHaveJSProperty("paused", true);
  await expect(page.locator("#studio")).toHaveCSS("opacity", "1");
  await expect(page.locator("#studio")).toHaveCSS("transform", "none");
  await uploadClip(page);
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator('[data-studio-step="ready"]')).toHaveCSS("transform", "none");
  await page.getByLabel("Describe the change").fill("Blur the background");
  await expect(page.getByLabel("Describe the change")).toHaveValue("Blur the background");
});

test("follows the saved theme, then the browser preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.getByRole("button", { name: "Dark mode", pressed: false }).click();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByRole("heading", { name: /Your drawings\.\s*In motion\.$/ })).toHaveCSS("color", "rgb(245, 245, 245)");
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("asks for a clip before revealing editing options", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your drawings\.\s*In motion\.$/ })).toBeVisible();
  await expect(page.getByText("Drop your video here")).toBeVisible();
  await expect(page.getByText(`MP4 or MOV · up to ${limits.maxDurationSeconds}s · ${limits.maxUploadMb} MB max`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate edit" })).toHaveCount(0);
  await expect(page.getByLabel("Describe the change")).toHaveCount(0);
  await expect(page.locator('[aria-label="Editing steps"] [aria-current="step"]')).toHaveText("1Add a clip");
  await expect(page.locator("#studio")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("#studio")).toHaveCSS("border-top-width", "0px");
});

test("rejects a file that is not a video, with a retry", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture("broken.mp4"));
  await expect(page.getByText(/We couldn’t read this file as a video/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry/ })).toBeVisible();
});

test("rejects a clip longer than the configured limit", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture("long.mp4"));
  await expect(page.getByText(`Trim it to ${limits.maxDurationSeconds}s or less`, { exact: false })).toBeVisible();
});

test("uploads, plays, and reports that AI editing is paused", async ({ page }) => {
  await page.goto("/");
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "clip.mp4", { type: "video/mp4" }));
    return data;
  }, Array.from(readFileSync(fixture("clip.mp4"))));
  const dropzone = page.getByRole("button", { name: /Drop your video here/ });
  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(dropzone).toHaveAttribute("data-dragging", "true");
  await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  const video = page.locator("#studio video");
  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\?v=[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: /Your drawings\.\s*In motion\.$/ })).toBeVisible();
  await expect(page.locator("#studio").getByLabel("Describe the change")).toBeVisible();
  await expect(page.locator('[aria-label="Editing steps"] [aria-current="step"]')).toHaveText("2Make it yours");

  // Real playback: time advances after pressing play.
  await page.locator("#studio").getByRole("button", { name: "Play" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);
  await expect(page.locator("#studio").getByRole("button", { name: "Pause" })).toBeVisible();

  // Generating hands the clip and instruction to the full editor through
  // localStorage; there, with the emergency switch on, the request is refused
  // with a clear message.
  await page.getByLabel("Describe the change").fill("Keep the subject in color");
  await page.getByLabel("Describe the change").press("Enter");
  await expect(page).toHaveURL(/\/editor\?v=[0-9a-f-]{36}/);
  await expect(page.getByText(/temporarily paused/)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("focus:editor-draft") ?? "{}").prompt)).toBe("Keep the subject in color");
  await expect(page.getByText(/3 of 3 free edits left|3 left/).first()).toBeVisible();

  // Reload keeps the video (it lives in the URL) and the instruction (localStorage), without generating again.
  await page.reload();
  await expect(page.locator("#editor video")).toBeVisible();
  await expect(page.getByLabel("Describe the change")).toHaveValue("Keep the subject in color");
});

test("cancels an upload and can start again without stale results", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/videos", async (route) => {
    await hold;
    await route.abort().catch(() => undefined);
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture("clip.mp4"));
  await expect(page.getByRole("progressbar", { name: "Video upload" })).toBeVisible();
  await expect(page.getByLabel("Describe the change")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel upload" }).click();
  release();
  await page.unroute("**/api/videos");
  await expect(page.getByRole("button", { name: /Drop your video here/ })).toBeEnabled();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await uploadClip(page);
  await expect(page.getByLabel("Describe the change")).toBeVisible();
});

test("keeps both steps usable at 320px and returns to upload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await uploadClip(page);
  const prompt = page.getByLabel("Describe the change");
  await expect(prompt).toBeVisible();
  // 16px on phones: smaller text makes iOS zoom into the field on focus.
  await expect(prompt).toHaveCSS("font-size", "16px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const tooSmall = await page.locator("#studio *").evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return element.children.length === 0 && element.textContent?.trim() && rect.width > 1 && rect.height > 1 && !element.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(element).fontSize) < 12;
  }).map((element) => element.textContent));
  expect(tooSmall).toEqual([]);
  await page.getByRole("button", { name: "Change clip" }).click();
  await expect(page.getByRole("button", { name: /Drop your video here/ })).toBeEnabled();
  await expect(prompt).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?v=/);
});

test("health endpoint reports FFmpeg and storage", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.checks).toMatchObject({ storageWritable: true, aiEnabled: false });
  expect(JSON.stringify(body)).not.toMatch(/sk-|key/i);
});
