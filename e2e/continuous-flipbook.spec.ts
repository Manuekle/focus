import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Flipbook } from "../shared/flipbook";

// All animation responses and media are fixtures; the test server also disables AI.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");
function fixture() {
  const id = randomUUID(), now = new Date().toISOString(), version = "v-000000000001";
  const poses = Array.from({ length: 96 }, (_, index) => ({ index, phase: `sample_${index}`, label: `At ${(index / 24).toFixed(2)} s`, description: "The character raises one arm gradually.", relativeRootY: 0, lift: 0 }));
  const frames = poses.map((pose) => ({ id: `s${pose.index}`, poseIndex: pose.index, phase: pose.phase, label: pose.label, status: "ready", approved: false, version, originalVersion: version, versions: [{ id: version, source: "generated", createdAt: now }], metrics: null, warnings: [], review: null, error: null }));
  return { id, imageId: randomUUID(), status: "ready", prompt: "Dance across the whole clip", title: "Continuous test", detail: null, progress: null, source: { width: 512, height: 768, hasAlpha: true }, analysis: null, sequence: { durationSeconds: 4, drawingFps: 24 }, plan: { mode: "sequence", motionId: randomUUID(), action: "dance", direction: "right", view: "side", motion: "in_place", drawingFps: 24, durationSeconds: 4, loop: false, poses }, warnings: [], reference: { kind: "original", version, reason: "Fixture reference", createdAt: now }, frames, order: frames.map((frame) => frame.id), alignment: { cellWidth: 512, cellHeight: 768, baselineY: 768, targetHeight: 768, strideX: 0, strideMeasured: false, transforms: Object.fromEntries(frames.map((frame) => [frame.id, { version, scale: 1, left: 0, top: 0, key: "1234567890abcdef" }])) }, budget: { limit: 96, used: 96 }, backgrounds: { scene: false, custom: false }, review: null, exports: [], error: null, createdAt: now, updatedAt: now };
}

test("an exhausted signed-in account sees the generation alert even with a stale session", async ({ page }) => {
  const book = fixture() as unknown as Flipbook;
  const ownerId = randomUUID();
  book.ownerId = ownerId;
  let exhausted = false;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: ownerId, name: "Generation test", avatarUrl: null, simulated: true }, quota: { limit: 3, used: exhausted ? 3 : 2, remaining: exhausted ? 0 : 1 }, authMode: "simulated" } }));
  await page.route("**/api/flipbooks", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/flipbooks/${book.id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.route(`**/api/flipbooks/${book.id}/frames/*`, (route) => {
    exhausted = true;
    return route.fulfill({ status: 403, json: { error: { code: "generation_limit_reached", message: "You’ve used all 3 free generations." } } });
  });
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByText("1 of 3 generations left", { exact: true })).toBeVisible();
  // The selected drawing's actions live in the inspector's Frame tab.
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page.getByRole("button", { name: "Redraw", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "No generations left" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("export your saved work");
  await expect(dialog.getByRole("button", { name: /Facebook/ })).toHaveCount(0);
  await expect(page.getByText("0 of 3 generations left", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/focus-generation-limit-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/focus-generation-limit-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Redraw", exact: true })).toBeVisible();
});

test("a returning account with zero generations sees the notice and keeps access to its animation", async ({ page }) => {
  const book = fixture() as unknown as Flipbook;
  book.ownerId = randomUUID();
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: book.ownerId, name: "Returning user", avatarUrl: null, simulated: true }, quota: { limit: 3, used: 3, remaining: 0 }, authMode: "simulated" } }));
  await page.route("**/api/flipbooks", (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/flipbooks/${book.id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  const dialog = page.getByRole("dialog", { name: "No generations left" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue to my work" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Contact sheet", exact: true })).toBeVisible();
});

test("warning alert fixes all eligible drawings after the allowance confirmation, including on mobile", async ({ page }) => {
  const book = fixture() as unknown as Flipbook;
  book.frames[0].warnings = [{ code: "color_shift", message: "Match the reference colors." }];
  book.frames[1].warnings = [{ code: "color_shift", message: "Match the reference colors." }];
  book.frames[1].approved = true;
  book.frames[2].review = { ok: false, issues: [{ code: "extra_limb", note: "Remove the extra hand." }] };
  const requests: unknown[] = [];
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: book });
    const action = route.request().postDataJSON();
    if (action.action !== "enhance_flagged") return route.fulfill({ json: book });
    requests.push(action);
    if (!action.confirmExtra) return route.fulfill({ status: 402, json: { error: { code: "budget_reached", message: "Confirm to draw 2 more." } } });
    book.frames[0].warnings = [];
    book.frames[2].review = null;
    return route.fulfill({ json: book });
  });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByText("3 drawings need attention", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 approved drawing stays unchanged/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const fix = page.getByRole("button", { name: "Fix all 2 drawings", exact: true });
  await fix.scrollIntoViewIfNeeded();
  await expect(fix).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/focus-flipbook-repair-alert-mobile.png" });
  await fix.click();
  await expect(page.getByText("Drawing budget reached", { exact: true })).toBeVisible();
  expect(requests).toEqual([{ action: "enhance_flagged", confirmExtra: false }]);
  await page.getByRole("button", { name: "Draw anyway", exact: true }).click();
  await expect.poll(() => requests).toEqual([{ action: "enhance_flagged", confirmExtra: false }, { action: "enhance_flagged", confirmExtra: true }]);
  await expect(page.getByText("1 drawing needs attention", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fix all/ })).toHaveCount(0);
});

test("a failed motion update keeps its settings and offers a persistent retry", async ({ page }) => {
  const book = fixture();
  const requests: unknown[] = [];
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: book });
    const action = route.request().postDataJSON();
    if (action.action !== "sequence") return route.fulfill({ json: book });
    requests.push(action);
    return requests.length === 1
      ? route.fulfill({ status: 502, json: { error: { code: "meta_model_not_found", message: "Model unavailable." } } })
      : route.fulfill({ json: book });
  });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const sequence = page.getByRole("region", { name: "Continuous sequence", exact: true });
  await sequence.getByRole("button", { name: "12", exact: true }).click();
  await sequence.getByRole("button", { name: "Update motion plan", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "The change couldn’t be completed" });
  await expect(alert).toContainText("Animation generation is temporarily unavailable");
  await expect(sequence.getByRole("button", { name: "12", exact: true })).toHaveAttribute("aria-pressed", "true");
  await alert.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => requests).toHaveLength(2);
  expect(requests[1]).toEqual({ action: "sequence", settings: { durationSeconds: 4, drawingFps: 12 } });
  await expect(alert).toHaveCount(0);
});

test("a failed preparation retries the saved animation instead of requiring another upload", async ({ page }) => {
  const book = fixture() as unknown as Flipbook;
  book.status = "failed";
  book.reference = null;
  book.plan = null;
  book.error = { code: "meta_model_not_found", message: "Model unavailable." };
  let retry: unknown;
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "retry") {
      retry = route.request().postDataJSON();
      return route.fulfill({ json: { ...fixture(), id: book.id } });
    }
    return route.fulfill({ json: book });
  });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "This animation couldn’t be made" })).toContainText("saved drawings are still here");
  await page.getByRole("button", { name: "Retry preparation", exact: true }).click();
  await expect.poll(() => retry).toEqual({ action: "retry", confirmExtra: false });
  await expect(page.getByRole("button", { name: "Retry preparation", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(book.id));
});

test("reducing density keeps the selected drawing inside the shorter timeline", async ({ page }) => {
  let book = fixture();
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "sequence") {
      const poses = book.plan.poses.filter((_, index) => index % 3 === 0).map((pose, index) => ({ ...pose, index }));
      const frames = book.frames.filter((_, index) => index % 3 === 0).map((frame, index) => ({ ...frame, poseIndex: index }));
      book = { ...book, sequence: { durationSeconds: 4, drawingFps: 8 }, plan: { ...book.plan, drawingFps: 8, poses }, frames, order: frames.map((frame) => frame.id) };
    }
    return route.fulfill({ json: book });
  });
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  for (let index = 0; index < 3; index++) await page.getByRole("button", { name: "Next drawings", exact: true }).click();
  await page.getByRole("button", { name: /^Frame 96,/ }).click();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const sequence = page.getByRole("region", { name: "Continuous sequence", exact: true });
  await sequence.getByRole("button", { name: "8", exact: true }).click();
  await sequence.getByRole("button", { name: "Update motion plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Correct this drawing · 32 ·/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Frame 32,/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: /^Frame 32,/ })).toHaveAttribute("tabindex", "0");
});

test("a long exposure asks for more drawings instead of offering a paid pose repair", async ({ page }) => {
  const book = fixture() as unknown as Flipbook;
  book.frames[0].warnings = [{ code: "exposure_too_long", message: "This drawing is held for more than 125 ms. Add in-between drawings." }];
  await page.route(`**/api/flipbooks/${book.id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByText("1 drawing needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText(/For long exposures, add in-between drawings/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fix all/ })).toHaveCount(0);
});

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
  // The manual form sits behind Advanced; Guided asks Muse Spark, which is off here.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByText(/96 drawings across 4 s/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare continuous animation", exact: true }).click();
  await expect.poll(() => created).toMatchObject({ imageId: image.id, sequence: { durationSeconds: 4, drawingFps: 24 } });
});

test("the complete timeline, finite playback and all new controls work on desktop and mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const book = fixture();
  await page.route(`**/api/flipbooks/${book.id}`, (route) => route.fulfill({ json: book }));
  await page.route(`**/api/flipbooks/${book.id}/media**`, (route) => route.fulfill({ body: pixel, contentType: "image/png" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Continuous sequence", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("1–24 of 96", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next drawings", exact: true }).click();
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
