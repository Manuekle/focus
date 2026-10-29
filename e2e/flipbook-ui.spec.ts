import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const illustration = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768"><rect width="512" height="768" fill="#202635"/><circle cx="256" cy="190" r="72" fill="#c2d2ff"/><path d="M190 300h132l28 210H162z" fill="#296ff0"/><path d="m194 510-16 170m140-170 16 170M180 320l-70 160m222-160 70 160" fill="none" stroke="#c2d2ff" stroke-width="34" stroke-linecap="round"/></svg>');

async function studio(page: Page) {
  const id = randomUUID(), ownerId = randomUUID(), now = new Date().toISOString(), version = "v-000000000001";
  const poses = Array.from({ length: 96 }, (_, index) => ({ index, phase: `sample_${index}`, label: `At ${(index / 24).toFixed(2)} s`, description: "The character gradually raises an arm.", relativeRootY: 0, lift: 0 }));
  const frames = poses.map((pose) => ({ id: `s${pose.index}`, poseIndex: pose.index, phase: pose.phase, label: pose.label, status: "ready", approved: false, version, originalVersion: version, versions: [{ id: version, source: "generated", createdAt: now }], metrics: null, warnings: [], review: null, error: null }));
  const book = {
    id, imageId: randomUUID(), ownerId, status: "ready", title: "Layout test", prompt: "Dance", detail: null, progress: null,
    source: { width: 512, height: 768, hasAlpha: true }, analysis: null,
    sequence: { durationSeconds: 4, drawingFps: 24 },
    plan: { mode: "sequence", motionId: randomUUID(), action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: 24, durationSeconds: 4, loop: false, poses },
    warnings: [], reference: { kind: "original", version, reason: "Original illustration", createdAt: now }, frames, order: frames.map((frame) => frame.id),
    alignment: { cellWidth: 512, cellHeight: 768, baselineY: 768, targetHeight: 768, strideX: 0, strideMeasured: false, transforms: Object.fromEntries(frames.map((frame) => [frame.id, { version, scale: 1, left: 0, top: 0, key: "1234567890abcdef" }])) },
    budget: { limit: 96, used: 96 }, backgrounds: { scene: false, custom: false },
    audio: { version: "000000000002", name: "ScreenRecording_12-12-2025 10-03-04_1.mp3", durationSeconds: 16.4, offset: 0, startsAt: 0, volume: 1 },
    review: null, exports: [], error: null, createdAt: now, updatedAt: now,
  };
  const character = {
    id: randomUUID(), ownerId, name: "Saved character", preset: null,
    references: [{ id: version, name: "Original", role: "identity", width: 512, height: 768 }],
    versions: [{ id: version, name: "Original version", prompt: "Character", parentId: null, operationId: randomUUID(), width: 512, height: 768, createdAt: now }],
    selectedVersionId: version, status: "ready", job: null, error: null, budget: { used: 1, limit: 32 }, operations: [], createdAt: now, updatedAt: now,
  };
  let savedAudio: unknown;
  // All mutations and media stay in this browser's fixtures, with no AI calls.
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: ownerId, name: "UI test", avatarUrl: null, simulated: true }, quota: null, authMode: "simulated" } }));
  await page.route("**/api/flipbooks", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/characters", (route) => route.fulfill({ json: [{ ...character, versions: 1, coverUrl: `/api/characters/${character.id}/media` }] }));
  await page.route(`**/api/characters/${character.id}`, (route) => route.fulfill({ json: character }));
  await page.route(`**/api/characters/${character.id}/media**`, (route) => route.fulfill({ body: illustration, contentType: "image/svg+xml" }));
  await page.route(`**/api/flipbooks/${id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${id}/media**`, (route) => route.fulfill({ body: illustration, contentType: "image/svg+xml" }));
  await page.route(`**/api/flipbooks/${id}/audio**`, (route) => {
    if (route.request().method() === "PATCH") {
      savedAudio = route.request().postDataJSON();
      return route.fulfill({ json: { ...book, audio: { ...book.audio, ...savedAudio as object } } });
    }
    return route.fulfill({ status: 204 });
  });
  return { book, character, savedAudio: () => savedAudio };
}

test("sequence, audio and character controls use compact system components", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const fixture = await studio(page);
  await page.goto(`/flipbook?f=${fixture.book.id}`);
  const sequence = page.getByRole("region", { name: "Continuous sequence", exact: true });
  await sequence.getByRole("slider", { name: "Length", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await sequence.getByRole("button", { name: "12", exact: true }).click();
  await expect(sequence.getByText(/60 drawings across 5 s/)).toBeVisible();
  await expect(sequence.getByRole("button", { name: "12", exact: true })).toHaveAttribute("aria-pressed", "true");

  const audio = page.getByRole("region", { name: "Audio", exact: true });
  const offset = audio.getByRole("spinbutton", { name: "Start within track (seconds)", exact: true });
  await offset.fill("1.5");
  await audio.getByRole("spinbutton", { name: "Start within clip (seconds)", exact: true }).fill("0.5");
  await audio.getByRole("slider", { name: "Volume", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(audio.getByRole("slider", { name: "Volume", exact: true })).toHaveAttribute("aria-valuenow", "0.95");
  await audio.getByRole("button", { name: "Save audio settings" }).click();
  await expect.poll(fixture.savedAudio).toEqual({ offset: 1.5, startsAt: 0.5, volume: 0.95 });
  expect((await offset.boundingBox())!.height).toBe(36);

  const duplicate = page.getByRole("region", { name: "Duplicate with another character" });
  const select = duplicate.getByRole("combobox", { name: "Character", exact: true });
  await select.click();
  await page.getByRole("option", { name: fixture.character.name }).click();
  await expect(duplicate.getByRole("combobox", { name: "Version", exact: true })).toContainText("Original version");
  const bounds = await select.evaluate((el) => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, parent: el.parentElement!.getBoundingClientRect().toJSON() }));
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.parent.left);
  expect(bounds.right).toBeLessThanOrEqual(bounds.parent.right);
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
  await audio.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/focus-flipbook-system-controls.png" });
});

test("desktop panes scroll independently and narrower layouts keep every panel reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  await page.goto(`/flipbook?f=${book.id}`);
  const sequence = page.getByRole("heading", { name: "Continuous sequence", exact: true });
  await expect(sequence).toBeAttached();
  const header = page.getByRole("banner");
  const sidebar = page.getByRole("complementary", { name: "Your animations" });
  const toggle = page.getByRole("button", { name: "Hide sidebar", exact: true });
  const before = { sidebar: await sidebar.boundingBox(), toggle: await toggle.boundingBox() };
  const rightPane = page.locator('[class*="columnSide"]').last().locator('[data-slot="scroll-area-viewport"]').first();
  await rightPane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeInViewport();
  expect(await rightPane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect((await header.boundingBox())!.y).toBe(0);
  expect((await sidebar.boundingBox())!.y).toBe(before.sidebar!.y);
  expect((await toggle.boundingBox())!.y).toBe(before.toggle!.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const mainPane = page.locator('[class*="columnMain"]');
  const box = (await mainPane.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(60);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: "/tmp/focus-flipbook-layout-desktop.png" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => rightPane.evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");
  await page.getByRole("main").locator('[data-slot="scroll-area-viewport"]').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeInViewport();
  await expect(toggle).toBeInViewport();
  expect((await mainPane.boundingBox())!.y).toBeGreaterThanOrEqual(60);
  await page.screenshot({ path: "/tmp/focus-flipbook-layout-medium.png" });
  for (const width of [860, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await sequence.scrollIntoViewIfNeeded();
    await expect(sequence).toBeInViewport();
    await page.getByRole("heading", { name: "Audio", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("slider", { name: "Volume", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("slider", { name: "Volume", exact: true })).toBeInViewport();
    if (width <= 520) await expect(page.getByRole("textbox", { name: "Animation name", includeHidden: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "/tmp/focus-flipbook-layout-mobile.png" });
});

test("starting from a saved character uses the system upload and scrolls below the header", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { character } = await studio(page);
  await page.goto(`/flipbook?character=${character.id}&version=${character.selectedVersionId}`);
  await expect(page.getByRole("slider", { name: "Length", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your character illustration", exact: true })).toBeVisible();
  const picker = page.getByRole("button", { name: "Choose reference video", exact: true });
  const chooser = page.waitForEvent("filechooser");
  await picker.click();
  await (await chooser).setFiles({ name: "reference.mp4", mimeType: "video/mp4", buffer: Buffer.from("fixture") });
  await expect(page.getByText("reference.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await expect(picker).toBeVisible();
  await page.getByRole("main").locator('[data-slot="scroll-area-viewport"]').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const drawing = (await page.getByRole("region", { name: "Drawing", exact: true }).boundingBox())!;
  expect(drawing.y).toBeGreaterThanOrEqual(60);
  await expect(page.getByRole("button", { name: "Hide sidebar", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/focus-flipbook-character-desktop.png" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await picker.scrollIntoViewIfNeeded();
    await expect(picker).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "/tmp/focus-flipbook-character-mobile.png" });
});

test("scroll edges blur during movement and clear at the start, end and idle", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByRole("heading", { name: "Continuous sequence", exact: true })).toBeAttached();
  const area = page.locator('[class*="columnSide"]').last();
  const viewport = area.locator('[data-slot="scroll-area-viewport"]').first();
  const top = area.locator('[data-slot="scroll-fade-top"]');
  const bottom = area.locator('[data-slot="scroll-fade-bottom"]');
  await expect(top).toHaveCSS("opacity", "0");
  await expect(bottom).toHaveCSS("opacity", "0");

  const scroll = async (position: number) => viewport.evaluate(async (el, position) => {
    el.scrollTop = position === -1 ? el.scrollHeight : position;
    el.dispatchEvent(new Event("scroll"));
    await new Promise(requestAnimationFrame);
    const area = el.closest<HTMLElement>('[data-slot="scroll-area"]')!;
    return { scrolling: area.dataset.scrolling, top: area.dataset.fadeTop, bottom: area.dataset.fadeBottom };
  }, position);

  expect(await scroll(200)).toEqual({ scrolling: "true", top: "true", bottom: "true" });
  expect(await scroll(0)).toEqual({ scrolling: "true", top: "false", bottom: "true" });
  expect(await scroll(-1)).toEqual({ scrolling: "true", top: "true", bottom: "false" });
  await expect(bottom).toHaveCSS("pointer-events", "none");
  await expect.poll(() => area.getAttribute("data-scrolling")).toBeNull();
  await expect(top).toHaveCSS("opacity", "0");
  await expect(bottom).toHaveCSS("opacity", "0");

  await scroll(300);
  await viewport.hover();
  await page.mouse.wheel(0, 80);
  await page.mouse.wheel(0, 80);
  await expect(area).toHaveAttribute("data-scrolling", "true");
  await page.screenshot({ path: "/tmp/focus-flipbook-scroll-blur.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(top).toHaveCSS("transition-duration", "0s");
  await expect(top).toHaveCSS("backdrop-filter", "none");
});

test("sidebar toggle stays in the header and resizing still works", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  await page.goto(`/flipbook?f=${book.id}`);
  const header = page.getByRole("banner");
  const toggle = header.getByRole("button", { name: "Hide sidebar", exact: true });
  await expect(toggle).toHaveAttribute("aria-controls", "flipbook-library");
  const before = (await toggle.boundingBox())!;
  const separator = page.getByRole("separator", { name: "Resize sidebar" });
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "264");
  await toggle.click();
  const show = header.getByRole("button", { name: "Show sidebar", exact: true });
  await expect(show).toBeInViewport();
  expect((await show.boundingBox())!.x).toBe(before.x);
  expect((await show.boundingBox())!.y).toBe(before.y);
  await show.click();
  await expect(toggle).toBeInViewport();
  await expect(page.locator('aside#flipbook-library')).toBeVisible();
  await expect(page.locator('[class*="body"] > button[aria-expanded]')).toHaveCount(0);
});
