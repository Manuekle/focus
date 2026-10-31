import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import type { Flipbook } from "../shared/flipbook";
import { videoAnimationPrompt } from "../shared/animation-prompt";

const illustration = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768"><rect width="512" height="768" fill="#202635"/><circle cx="256" cy="190" r="72" fill="#c2d2ff"/><path d="M190 300h132l28 210H162z" fill="#296ff0"/><path d="m194 510-16 170m140-170 16 170M180 320l-70 160m222-160 70 160" fill="none" stroke="#c2d2ff" stroke-width="34" stroke-linecap="round"/></svg>');
// Zero-based timestamps keep exact keyboard-seek assertions independent of B-frame offsets.
const motionVideo = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x240:rate=24:duration=2", "-c:v", "libx264", "-bf", "0", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]);

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
  await expect(page.getByRole("heading", { name: "Layout test", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  await page.goto(`/flipbook?f=${book.id}`);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
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

  // The outer workspace and inner editor straddle the old anonymous query threshold here.
  for (const width of [1368, 1384, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    const outer = page.getByRole("main").locator('[data-slot="scroll-area-viewport"]').first();
    await expect(outer).toHaveCSS("overflow-y", "hidden");
    await expect(rightPane).toHaveCSS("overflow-y", "auto");
    await rightPane.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole("heading", { name: "Export", exact: true })).toBeInViewport();
  }

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
  // The manual form sits behind Advanced; Guided asks Muse Spark, which is off here.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Length", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your character illustration", exact: true })).toBeVisible();
  const setup = page.getByRole("region", { name: "Animation setup", exact: true });
  const motion = page.getByRole("region", { name: "Motion & direction", exact: true });
  const setupBounds = (await setup.boundingBox())!, motionBounds = (await motion.boundingBox())!;
  expect(Math.abs(setupBounds.x - motionBounds.x)).toBeLessThan(2);
  expect(motionBounds.y).toBeGreaterThan(setupBounds.y + setupBounds.height);
  await motion.getByRole("button", { name: "Dance", exact: true }).click();
  await expect(motion.getByRole("button", { name: "Dance", exact: true })).toHaveAttribute("aria-pressed", "true");
  const picker = page.getByRole("button", { name: "Choose reference video", exact: true });
  await setup.getByRole("button", { name: "From a video", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await picker.click();
  await (await chooser).setFiles({ name: "reference.mp4", mimeType: "video/mp4", buffer: motionVideo });
  await expect(page.getByText("reference.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await expect(picker).toBeVisible();
  await setup.getByRole("button", { name: "Describe motion", exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 650 });
  const mainScroller = page.getByRole("main").locator('[data-slot="scroll-area-viewport"]').first();
  await expect(mainScroller).toHaveCSS("overflow-y", "auto");
  await mainScroller.hover();
  await page.mouse.wheel(0, 1400);
  await expect.poll(() => mainScroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Prepare continuous animation", exact: true })).toBeInViewport();
  const drawing = (await page.getByRole("region", { name: "Drawing", exact: true }).boundingBox())!;
  expect(drawing.y).toBeGreaterThanOrEqual(60);
  await expect(page.getByRole("button", { name: "Hide sidebar", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/focus-flipbook-character-desktop.png" });
  for (const width of [1280, 860, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const instruction = page.getByRole("textbox", { name: "Describe the motion", exact: true });
    await instruction.scrollIntoViewIfNeeded();
    await expect(instruction).toBeInViewport();
    const submit = page.getByRole("button", { name: "Prepare continuous animation", exact: true });
    await instruction.focus();
    await submit.focus();
    await expect(submit).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "/tmp/focus-flipbook-character-mobile.png" });
});

test("video movement replaces manual controls and uploads and applies the exact segment before planning", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book, character } = await studio(page);
  const operations: string[] = [];
  let created: Record<string, unknown> | undefined;
  let attached: unknown;
  const reference = { version: "aabbccddeeff", name: "performance.mp4", sourceSeconds: 2, start: 0, durationSeconds: 2, hasAudio: false };
  let pending = { ...book, status: "awaiting_motion", motionSource: "video", analysis: null, plan: null, reference: null, alignment: null, frames: book.frames.slice(0, 12).map((frame, index) => ({ ...frame, id: `s${index * 2}`, poseIndex: index, phase: `sample_${index * 2}`, status: "pending", version: null, originalVersion: null, versions: [] })), order: Array.from({ length: 12 }, (_, index) => `s${index * 2}`), motionDraft: null as typeof reference | null };
  await page.route("**/api/flipbooks", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    operations.push("create");
    created = route.request().postDataJSON();
    pending = { ...pending, prompt: created!.prompt as string, sequence: created!.sequence as typeof book.sequence };
    return route.fulfill({ status: 202, json: pending });
  });
  await page.route(`**/api/flipbooks/${book.id}/motion`, (route) => {
    if (route.request().headers()["content-type"]?.includes("application/json")) {
      operations.push("apply"); attached = route.request().postDataJSON();
      return route.fulfill({ status: 202, json: { ...pending, status: "planning", motionDraft: null, motionReference: { ...reference, ...attached as object } } });
    }
    operations.push("upload");
    pending = { ...pending, motionDraft: reference };
    return route.fulfill({ json: pending });
  });
  await page.goto(`/flipbook?character=${character.id}&version=${character.selectedVersionId}`);
  // The manual form sits behind Advanced; Guided asks Muse Spark, which is off here.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: "From a video", exact: true }).click();
  await expect(page.getByRole("region", { name: "Motion & direction", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Video movement", exact: true })).toBeVisible();
  const prepare = page.getByRole("button", { name: "Prepare continuous animation", exact: true });
  await expect(prepare).toBeDisabled();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose reference video", exact: true }).click();
  await (await chooser).setFiles({ name: "performance.mp4", mimeType: "video/mp4", buffer: motionVideo });
  const start = page.getByRole("spinbutton", { name: "Start in reference (seconds)", exact: true });
  const length = page.getByRole("spinbutton", { name: "Segment length (whole seconds)", exact: true });
  await expect(start).toBeVisible();
  await length.fill("4");
  await expect(prepare).toBeDisabled();
  await length.fill("1");
  await start.fill("1");
  await page.getByRole("button", { name: "12", exact: true }).click();
  await page.getByRole("switch", { name: "Use audio from the video if available", exact: true }).click();
  await page.getByRole("textbox", { name: "Additional direction (optional)", exact: true }).fill("Make finger gestures clear.");
  await page.getByText("Review animation instructions", { exact: true }).click();
  await expect(page.getByText(/Animate the selected character by following the single performer's movement/)).toContainText("from 1.00 to 2.00 seconds");
  await prepare.click();
  await expect.poll(() => operations).toEqual(["create", "upload", "apply"]);
  await expect(page.getByRole("heading", { name: "Layout test", exact: true })).toBeInViewport();
  expect(await page.getByRole("main").locator('[data-slot="scroll-area-viewport"]').first().evaluate((el) => el.scrollTop)).toBe(0);
  expect(created).toMatchObject({ motionSource: "video", sequence: { durationSeconds: 1, drawingFps: 12 } });
  expect(created).not.toHaveProperty("action");
  expect(created).not.toHaveProperty("view");
  expect(created!.prompt).toContain("12 timed drawings");
  expect(created!.prompt).toContain("Make finger gestures clear.");
  expect(created!.prompt).not.toContain("Walk across the screen");
  expect(attached).toEqual({ version: reference.version, start: 1, durationSeconds: 1, useAudio: true });
});

test("reference video uses system controls, keyboard seeking and bounded segment playback", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { character } = await studio(page);
  await page.goto(`/flipbook?character=${character.id}&version=${character.selectedVersionId}`);
  // The manual form sits behind Advanced; Guided asks Muse Spark, which is off here.
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: "From a video", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose reference video", exact: true }).click();
  await (await chooser).setFiles({ name: "performance.mp4", mimeType: "video/mp4", buffer: motionVideo });
  const player = page.getByRole("group", { name: "Movement reference preview player", exact: true });
  const media = player.locator("video");
  const play = player.getByRole("button", { name: "Play reference video", exact: true });
  await expect(play).toBeEnabled();
  expect(await media.evaluate((el: HTMLVideoElement) => el.controls)).toBe(false);
  await play.click();
  await expect(player.getByRole("button", { name: "Pause reference video", exact: true })).toBeVisible();
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
  await player.getByRole("button", { name: "Pause reference video", exact: true }).click();
  await expect(play).toBeVisible();
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  const seek = player.getByRole("slider", { name: "Video position", exact: true });
  await seek.focus();
  await page.keyboard.press("Home");
  await expect(seek).toHaveAttribute("aria-valuenow", "0");
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBe(0);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.01, 2);
  await player.getByRole("button", { name: "Unmute reference video", exact: true }).click();
  expect(await media.evaluate((el: HTMLVideoElement) => el.muted)).toBe(false);
  await player.getByRole("button", { name: "Mute reference video", exact: true }).click();
  expect(await media.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);

  await page.getByRole("spinbutton", { name: "Segment length (whole seconds)", exact: true }).fill("1");
  await page.getByRole("spinbutton", { name: "Start in reference (seconds)", exact: true }).fill("0.5");
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.5, 2);
  await seek.focus();
  await page.keyboard.press("End");
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(1.5, 2);
  await play.click();
  await expect.poll(() => media.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  expect(await media.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(1.5, 2);
  await player.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  await expect.poll(() => player.evaluate((el) => document.fullscreenElement === el)).toBe(true);
  await player.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await player.scrollIntoViewIfNeeded();
  await player.screenshot({ path: "/tmp/focus-reference-video-controls.png" });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await player.scrollIntoViewIfNeeded();
    await expect(play).toBeInViewport();
    expect((await media.boundingBox())!.height).toBeLessThanOrEqual(321);
    expect(await player.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("a rejected video keeps its media, offers recovery and blocks unavailable editing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  const base = book as unknown as Flipbook;
  const prompt = videoAnimationPrompt({ settings: base.sequence!, start: 0 });
  let current: Flipbook = {
    ...base, title: prompt.slice(0, 80), prompt, status: "unsupported", plan: null, reference: null, alignment: null,
    motionSource: "video", motionReference: { version: "aabbccddeeff", name: "performance.mp4", sourceSeconds: 4, start: 0, durationSeconds: 4, hasAudio: false },
    analysis: { characterCount: 1, subject: "girl", facing: "front", view: "front", fullBodyVisible: true, feetVisible: true, background: "plain", style: "anime", hair: "blonde", clothing: "shirt", accessories: [], palette: ["#333333"], proportions: "human", requestedAction: "gesture" },
    frames: base.frames.map((frame) => ({ ...frame, status: "pending", version: null, originalVersion: null, versions: [] })),
    budget: { used: 0, limit: 16 }, error: { code: "unsupported_animation", message: "Ask your character for a supported preset." },
  };
  const retries: unknown[] = [];
  await page.route(`**/api/flipbooks/${book.id}`, (route) => {
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON();
      if (action.action === "retry") { retries.push(action); current = { ...current, status: "analyzing", error: null }; }
    }
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/flipbooks/${book.id}/motion**`, (route) => route.fulfill({ body: motionVideo, contentType: "video/mp4" }));
  await page.goto(`/flipbook?f=${book.id}`);
  await expect(page.getByRole("heading", { name: "Video movement", exact: true })).toBeVisible();
  await expect(page.getByText("Flipbook · video movement", { exact: true })).toBeVisible();
  const frame = page.getByRole("region", { name: /^Correct this drawing/ });
  await expect(frame.getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
  await expect(frame.getByRole("textbox", { name: "Correction note for the redraw", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Generate background", exact: true })).toBeDisabled();
  const video = page.getByRole("region", { name: "Video movement reference", exact: true });
  await expect(video.getByRole("button", { name: "Replace reference video", exact: true })).toBeEnabled();
  await expect(video.getByRole("button", { name: "Play reference video", exact: true })).toBeEnabled();
  expect(await video.locator("video").evaluate((el: HTMLVideoElement) => el.controls)).toBe(false);
  await page.getByRole("button", { name: "Retry preparation", exact: true }).click();
  await expect.poll(() => retries).toEqual([{ action: "retry", confirmExtra: false }]);
  await expect(page.getByText("This animation isn’t supported yet", { exact: true })).toHaveCount(0);
});

test("scroll edges blur during movement and clear at the start, end and idle", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { book } = await studio(page);
  await page.goto(`/flipbook?f=${book.id}`);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
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
