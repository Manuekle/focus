import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Flipbook } from "../shared/flipbook";
import type { Character } from "../shared/characters";

const illustration = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#202635"/><circle cx="128" cy="100" r="50" fill="#c2d2ff"/></svg>');

async function fixture(page: Page) {
  const ownerId = randomUUID(), now = new Date().toISOString();
  let book: Flipbook = {
    id: randomUUID(), imageId: randomUUID(), ownerId, title: "Dance animation", prompt: "Dance", status: "generating",
    detail: "Drawing frame 3 of 12", progress: { done: 3, total: 12 }, source: { width: 256, height: 256, hasAlpha: false },
    analysis: null, plan: null, warnings: [], reference: null, frames: [], order: [], alignment: null, cast: [], extraReferences: [], inbetweens: [], look: null,
    budget: { limit: 32, used: 3 }, backgrounds: { scene: false, custom: false, reference: false, generated: null, depth: { scene: false, generated: false } }, review: null, exports: [], error: null, createdAt: now, updatedAt: now,
  };
  let character: Character = {
    id: randomUUID(), ownerId, name: "Character image", preset: null,
    references: [{ id: "v-000000000001", name: "Original", role: "identity", width: 256, height: 256 }],
    versions: [], selectedVersionId: null, status: "ready", job: null, error: null,
    budget: { used: 0, limit: 32 }, operations: [], createdAt: now, updatedAt: now,
  };
  let disconnected = false;
  const library = Array.from({ length: 40 }, (_, index) => ({ id: randomUUID(), title: `Saved animation ${index + 1}`, action: null, status: "ready", frames: 8, total: 8, posterUrl: "/activity-fixture.svg", updatedAt: now }));
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: ownerId, name: "Activity test", avatarUrl: null, simulated: true }, quota: null, authMode: "simulated" } }));
  await page.route("**/activity-fixture.svg", (route) => route.fulfill({ body: illustration, contentType: "image/svg+xml" }));
  await page.route("**/api/flipbooks", (route) => route.fulfill({ json: [{ id: book.id, title: book.title, action: null, status: book.status, frames: 3, total: 12, posterUrl: "/activity-fixture.svg", updatedAt: book.updatedAt }, ...library] }));
  await page.route(`**/api/flipbooks/${book.id}`, (route) => disconnected ? route.abort("internetdisconnected") : route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: illustration, contentType: "image/svg+xml" }));
  await page.route("**/api/characters", (route) => route.fulfill({ json: [{ ...character, versions: character.versions.length, coverUrl: "/activity-fixture.svg" }] }));
  await page.route(`**/api/characters/${character.id}`, (route) => route.fulfill({ json: character }));
  await page.route(`**/api/characters/${character.id}/media**`, (route) => route.fulfill({ body: illustration, contentType: "image/svg+xml" }));
  await page.route("**/api/projects", (route) => route.fulfill({ json: [] }));
  return {
    book, character, ownerId,
    updateBook: (change: Partial<typeof book>) => { book = { ...book, ...change, updatedAt: new Date(Date.now() + 100).toISOString() }; },
    updateCharacter: (change: Partial<typeof character>) => { character = { ...character, ...change, updatedAt: new Date().toISOString() }; },
    disconnect: (value: boolean) => { disconnected = value; },
  };
}

test("activity stays at the sidebar bottom, follows jobs across studios and restores after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const run = await fixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/flipbook?f=${run.book.id}`);
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByRole("meter", { name: "Dance animation progress" })).toHaveAttribute("aria-valuenow", "25");
  await expect(activity.getByText("1 running", { exact: true })).toBeVisible();
  await expect(activity).toBeInViewport();
  const sidebar = page.locator("#flipbook-library");
  const bounds = await sidebar.boundingBox(), footer = await activity.boundingBox();
  expect(Math.abs(bounds!.y + bounds!.height - footer!.y - footer!.height - 16)).toBeLessThan(2);
  const library = sidebar.locator('[data-slot="scroll-area-viewport"]').first();
  await library.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(activity).toBeInViewport();
  await page.screenshot({ path: "/tmp/focus-sidebar-activity-running.png" });
  await sidebar.getByRole("link", { name: "My characters", exact: true }).click();
  await expect(page).toHaveURL(/\/characters$/);
  await expect(activity.getByRole("meter")).toHaveAttribute("aria-valuenow", "25");
  await page.reload();
  await expect(activity.getByRole("meter")).toHaveAttribute("aria-valuenow", "25");
  run.updateBook({ status: "ready", detail: null, progress: null });
  await expect(activity.getByText("Completed", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(activity.getByRole("meter")).toHaveCount(0);
  await expect(activity.getByRole("link")).toHaveAttribute("href", `/flipbook?f=${run.book.id}`);
  const dismiss = activity.getByRole("button", { name: "Dismiss Dance animation", exact: true });
  await expect(dismiss).toHaveCSS("opacity", "0");
  await activity.getByRole("link").hover();
  await expect(dismiss).toHaveCSS("opacity", "1");
  await dismiss.hover();
  await expect(page.getByRole("tooltip", { name: "Dismiss notification", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/focus-sidebar-activity-completed.png" });
  expect(errors).toEqual([]);
});

test("connection loss stays in progress, errors remain reviewable and dismissal works with the keyboard", async ({ page }) => {
  const run = await fixture(page);
  await page.goto(`/flipbook?f=${run.book.id}`);
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText("25%", { exact: true })).toBeVisible();
  run.disconnect(true);
  await page.locator("#flipbook-library").getByRole("link", { name: "My characters", exact: true }).click();
  await expect(activity.getByText("Reconnecting…", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(activity.getByText("In progress", { exact: true })).toBeVisible();
  await expect(activity.getByText("Failed", { exact: true })).toHaveCount(0);
  run.disconnect(false);
  run.updateBook({ status: "failed", progress: null, detail: null, error: { code: "generation_failed", message: "The drawing couldn’t be generated. Try again." } });
  await expect(activity.getByText("Failed", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(activity.getByText("The drawing couldn’t be generated. Try again.", { exact: true })).toBeVisible();
  const dismiss = activity.getByRole("button", { name: "Dismiss Dance animation", exact: true });
  const beforeDismiss = page.url();
  await dismiss.focus();
  await page.keyboard.press("Enter");
  expect(page.url()).toBe(beforeDismiss);
  await expect(activity.getByText("Your tasks and their progress appear here.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(activity.getByRole("link")).toHaveCount(0);
});

test("image generation uses the existing spinner, stays visible on mobile and honors reduced motion", async ({ page }) => {
  const run = await fixture(page);
  run.updateBook({ status: "ready" });
  run.updateCharacter({ status: "generating" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/characters?c=${run.character.id}`);
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText("Character image", { exact: true })).toBeVisible();
  await expect(activity.getByRole("meter")).toHaveCount(0);
  await expect(activity.locator(".animate-spin")).toHaveCSS("animation-name", "none");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(activity).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "/tmp/focus-sidebar-activity-mobile.png" });
  run.updateCharacter({ status: "ready" });
  await expect(activity.getByText("Completed", { exact: true })).toBeVisible();
});

test("a generation request appears immediately and hands off to the character job", async ({ page }) => {
  const run = await fixture(page);
  run.updateBook({ status: "ready" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/characters/${run.character.id}/generate`, async (route) => {
    await gate;
    run.updateCharacter({ status: "generating" });
    await route.fulfill({ json: { ...run.character, status: "generating", updatedAt: new Date().toISOString() } });
  });
  await page.goto(`/characters?c=${run.character.id}`);
  await page.getByRole("textbox", { name: "Describe the design", exact: true }).fill("A full-body character with a blue coat");
  await page.getByRole("button", { name: "Create design", exact: true }).click();
  const activity = page.getByRole("region", { name: "Activity", exact: true });
  await expect(activity.getByText("Generating image", { exact: true })).toBeVisible();
  await expect(activity.getByText("In progress", { exact: true })).toBeVisible();
  release();
  await expect(activity.getByText("Drawing a new version…", { exact: true })).toBeVisible();
  await expect(activity.getByRole("link")).toHaveCount(1);
  run.updateCharacter({ status: "failed", error: { code: "generation_failed", message: "Try another reference." } });
  await expect(activity.getByText("Failed", { exact: true })).toBeVisible();
  await expect(activity.getByText("Try another reference.", { exact: true })).toBeVisible();
});
