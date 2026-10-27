import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { EditJobSchema, VideoAssetSchema } from "../shared/schemas";
import { RenderParamsSchema } from "../shared/render";
import { lastFrameMs } from "../shared/temporal";
import type { Tracking, TrackingFrame } from "../shared/tracking";
import { readFrames } from "../server/video/frames";
import { probe } from "../server/ffmpeg";

// Only planning/SAM are replaced: masks come from the decoded moving sprite.
// Upload, selection controls, job rendering, comparison and export are real.
const data = path.join(process.cwd(), ".focus-data-e2e");

test.beforeEach(() => {
  test.skip(process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS !== "true", "Build and run with NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=true to test the experimental editor.");
});

async function seed(page: Page, request: APIRequestContext, auto = false) {
  await page.goto("/");
  const normalized = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/videos" && response.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles(path.join(import.meta.dirname, ".fixtures", "jump.mp4"));
  expect((await normalized).status()).toBe(201);
  await expect(page.getByRole("button", { name: "Time Freeze", exact: true })).toBeVisible();
  const videoId = new URL(page.url()).searchParams.get("v")!;
  const video = VideoAssetSchema.parse(await (await request.get(`/api/videos/${videoId}`)).json());
  const segmentationId = "c-ui-jump";
  const codec = await import(pathToFileURL(path.join(process.cwd(), "node_modules/@meta-sam/parser/dist/mask-codec.js")).href) as {
    encodeSegmentationMask(raster: Uint8Array, width: number, height: number): { encoding: "one_bit"; payload: string; width: number; height: number };
  };
  const frames: TrackingFrame[] = [];
  const { width, height, fps, frameCount } = video.normalized;
  for await (const pixels of readFrames(path.join(data, "videos", video.id, "normalized.mp4"), width, height)) {
    let left = width, top = height, right = 0, bottom = 0;
    for (let i = 0; i < width * height; i++) {
      if (pixels[i * 4] > 150 && pixels[i * 4 + 1] < 110 && pixels[i * 4 + 2] < 110) {
        left = Math.min(left, i % width); top = Math.min(top, Math.floor(i / width));
        right = Math.max(right, i % width + 1); bottom = Math.max(bottom, Math.floor(i / width) + 1);
      }
    }
    const w = right - left, h = bottom - top;
    const raster = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y + top) * width + x + left) * 4;
      raster[y * w + x] = pixels[i] > 150 && pixels[i + 1] < 110 && pixels[i + 2] < 110 ? 1 : 0;
    }
    const frameIndex = frames.length;
    frames.push({ frameIndex, timestamp: frameIndex / fps, objects: [{ objectId: "0", box: { left, top, right, bottom }, confidence: 0.9, mask: codec.encodeSegmentationMask(raster, w, h) }] });
  }
  const objects: Tracking["objects"] = [{ id: "0", framesPresent: frames.length, firstFrame: 0, lastFrame: frames.length - 1, meanConfidence: 0.9, meanArea: 1600, source: "concept" }];
  const tracking: Tracking = { id: segmentationId, videoId: video.id, source: "concept", prompt: "person", width, height, fps, frameCount, frames, objects, missingFrames: [], diagnostics: [], outcome: { status: "completed" }, videoFramesProcessed: frameCount, createdAt: new Date().toISOString() };
  const segmentationFile = path.join(data, "videos", video.id, "segmentations", `${segmentationId}.json`);
  await mkdir(path.dirname(segmentationFile), { recursive: true });
  await writeFile(segmentationFile, JSON.stringify(tracking));
  const now = new Date().toISOString();
  const job = EditJobSchema.parse({
    id: randomUUID(), videoId: video.id, request: { videoId: video.id, effect: "time-freeze", prompt: "Freeze the person with four echoes" },
    status: "ready_to_render", detail: "Choose the freeze point on the timeline.", progress: 1,
    plan: { supported: true, target: { concept: "person", selection: "single" }, effect: "time_freeze_echo", parameters: {}, needsClarification: false },
    segmentationId, objects, selection: ["0"], reused: { plan: true, segmentation: true }, error: null,
    params: RenderParamsSchema.parse({ effect: "time_freeze_echo", trigger: auto ? { mode: "auto", event: "jump_apex" } : { mode: "manual" } }),
    resultUrl: null, createdAt: now, updatedAt: now,
  });
  await mkdir(path.join(data, "jobs"), { recursive: true });
  await writeFile(path.join(data, "jobs", `${job.id}.json`), JSON.stringify(job));
  await page.route("**/api/edits", async (route) => {
    if (auto) {
      const started = await request.post(`/api/jobs/${job.id}/render`, { data: { params: job.params } });
      expect(started.ok()).toBe(true);
      await route.fulfill({ status: 202, json: await started.json() });
    } else await route.fulfill({ status: 202, json: job });
  });
  await page.getByRole("button", { name: "Time Freeze", exact: true }).click();
  await expect(page.getByText("Freeze a moment. Multiply the motion.")).toBeVisible();
  await page.getByLabel("Describe the change").fill(job.request.prompt);
  await page.getByRole("button", { name: "Generate edit" }).click();
  await expect(page).toHaveURL(/\/editor\?v=/);
  return { job, video, segmentationFile };
}

const renderRequest = (page: Page) => page.waitForRequest((request) => /\/api\/jobs\/[^/]+\/render$/.test(request.url()) && request.method() === "POST");

async function waitForReplacement(page: Page, request: APIRequestContext, jobId: string, previousKey: string) {
  await expect.poll(async () => {
    const next = EditJobSchema.parse(await (await request.get(`/api/jobs/${jobId}`)).json());
    return next.status === "completed" && next.render?.key !== previousKey;
  }, { timeout: 30_000 }).toBe(true);
  const next = EditJobSchema.parse(await (await request.get(`/api/jobs/${jobId}`)).json()).render!;
  // The old result intentionally remains visible until the replacement arrives.
  await expect(page.locator("#editor video").first()).toHaveAttribute("src", next.urls.compare);
  return next;
}

test("selects a manual freeze point, previews real echoes, adjusts parameters and exports", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { job, video, segmentationFile } = await seed(page, request);
  const masksBefore = await stat(segmentationFile);
  const marker = page.getByRole("slider", { name: "Freeze point", exact: true });
  await expect(marker).toBeVisible();
  await expect(page.getByText("Not set", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview Time Freeze" }).click();
  await expect(marker).toBeFocused();
  await expect(marker).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Choose a freeze point before previewing.")).toBeVisible();
  // A valid timestamp can still lack enough tracked history for echoes.
  // Keep the controls usable after that real render failure.
  await page.getByRole("button", { name: "Freeze here", exact: true }).click();
  await page.getByRole("button", { name: "Preview Time Freeze" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /isn’t tracked in enough moments/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Time Freeze" })).toBeEnabled();
  // Seek first, then place the marker. End selects the last decodable frame.
  const playhead = page.getByRole("slider", { name: "Video position", exact: true });
  await playhead.focus();
  await playhead.press("End");
  await page.getByRole("button", { name: "Freeze here", exact: true }).click();
  await expect(marker).toHaveValue(String(video.normalized.frameCount - 1));
  await expect(marker).not.toHaveAttribute("aria-invalid", "true");
  const previewRequest = renderRequest(page);
  await page.getByRole("button", { name: "Preview Time Freeze" }).click();
  expect((await previewRequest).postDataJSON().params.trigger).toEqual({ mode: "manual", timestampMs: lastFrameMs(video.normalized) });
  await expect(page.getByRole("heading", { name: "Time Freeze ready", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-freeze-span]")).toBeVisible();
  await expect(page.getByText(/in the edited video$/)).toBeVisible();
  const first = EditJobSchema.parse(await (await request.get(`/api/jobs/${job.id}`)).json()).render!;
  const firstBytes = await (await request.get(first.urls.video)).body();
  const firstDownload = await request.get(first.urls.download);
  expect(firstDownload.headers()["content-disposition"]).toContain("attachment;");
  expect((await firstDownload.body()).equals(firstBytes)).toBe(true);
  // Both preview modes expose the same edited soundtrack and share a clock.
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect(page.locator("#editor video").first()).toHaveJSProperty("muted", false);
  const outputPosition = page.getByRole("slider", { name: "Video position", exact: true });
  await outputPosition.focus();
  await outputPosition.press("Home");
  await outputPosition.press("ArrowRight");
  await outputPosition.press("ArrowRight");
  const position = Number(await outputPosition.inputValue());
  await page.getByRole("button", { name: "Edited", exact: true }).click();
  await expect(page.getByLabel("Edited video", { exact: true })).toHaveAttribute("src", first.urls.video);
  await expect(page.getByLabel("Edited video", { exact: true })).toHaveJSProperty("muted", false);
  await expect.poll(async () => Number(await outputPosition.inputValue())).toBeCloseTo(position, 2);
  await page.getByRole("button", { name: "Before / after", exact: true }).click();
  await expect(page.locator("#editor video").first()).toHaveJSProperty("muted", false);
  await expect.poll(async () => Number(await outputPosition.inputValue())).toBeCloseTo(position, 2);
  await page.getByRole("button", { name: "Adjust freeze point" }).click();
  await marker.focus();
  await marker.press("ArrowLeft");
  await page.getByRole("slider", { name: "Echoes", exact: true }).focus();
  await page.getByRole("slider", { name: "Echoes", exact: true }).press("ArrowRight");
  await page.getByRole("slider", { name: "Echo spacing", exact: true }).focus();
  await page.getByRole("slider", { name: "Echo spacing", exact: true }).press("ArrowRight");
  await page.getByRole("slider", { name: "Echo intensity", exact: true }).focus();
  await page.getByRole("slider", { name: "Echo intensity", exact: true }).press("ArrowLeft");
  await page.getByRole("slider", { name: "Freeze duration", exact: true }).focus();
  await page.getByRole("slider", { name: "Freeze duration", exact: true }).press("End");
  const applied = renderRequest(page);
  await page.getByRole("button", { name: "Apply adjustments" }).click();
  expect((await applied).postDataJSON().params).toMatchObject({ freezeDurationMs: 3000, echo: { count: 5, spacingMs: 180, opacity: 0.8 }, trigger: { mode: "manual" } });
  const latest = await waitForReplacement(page, request, job.id, first.key);
  await expect(page.getByRole("heading", { name: "Time Freeze ready", exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await stat(segmentationFile)).mtimeMs).toBe(masksBefore.mtimeMs);
  // A completed new render cannot change the bytes behind an older URL.
  expect((await (await request.get(first.urls.video)).body()).equals(firstBytes)).toBe(true);
  const range = await request.get(first.urls.video, { headers: { Range: "bytes=128-255" } });
  expect(range.status()).toBe(206);
  expect((await range.body()).equals(firstBytes.subarray(128, 256))).toBe(true);
  const invalid = new URL(first.urls.video, page.url());
  invalid.searchParams.set("r", "../normalized");
  expect((await request.get(invalid.toString())).status()).toBe(404);
  const latestBytes = await (await request.get(latest.urls.video)).body();
  expect(latestBytes.equals(firstBytes)).toBe(false);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).first().click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  const downloadPath = (await download.path())!;
  expect((await readFile(downloadPath)).equals(latestBytes)).toBe(true);
  const facts = await probe(downloadPath);
  expect(facts.streams.find((stream) => stream.codec_type === "video")).toMatchObject({ codec_name: "h264", nb_frames: String(latest.frameCount), pix_fmt: "yuv420p" });
  expect(Number(facts.streams.find((stream) => stream.codec_type === "audio")?.duration)).toBeCloseTo(latest.durationSeconds, 1);
});

test("reviews an automatic suggestion, drags and restores it, and stays usable at 320px", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const { job, video } = await seed(page, request, true);
  await expect(page.getByRole("heading", { name: "Time Freeze ready", exact: true })).toBeVisible({ timeout: 30_000 });
  const first = EditJobSchema.parse(await (await request.get(`/api/jobs/${job.id}`)).json()).render!;
  await page.getByRole("button", { name: "Adjust freeze point" }).click();
  const marker = page.getByRole("slider", { name: "Freeze point", exact: true });
  await expect(marker).toHaveAttribute("data-suggested", "true");
  await expect(page.getByText(/Suggested jump apex · 90% confidence/).first()).toBeVisible();
  const initial = Number(await marker.inputValue());
  await expect(page.getByRole("slider", { name: "Video position", exact: true })).toHaveValue(String(initial));
  await marker.scrollIntoViewIfNeeded();
  const bounds = (await marker.boundingBox())!;
  const x = bounds.x + 6 + (bounds.width - 12) * initial / (video.normalized.frameCount - 1);
  await page.mouse.move(x, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(Math.min(bounds.x + bounds.width - 6, x + 35), bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: path.join(data, "time-freeze-drag.png"), fullPage: true });
  expect(Number(await marker.inputValue())).toBeGreaterThan(initial);
  await expect(page.getByText("Manual point", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply adjustments" })).toBeEnabled();
  await page.getByRole("button", { name: "Use suggestion", exact: true }).click();
  await expect(marker).toHaveValue(String(initial));
  await expect(marker).toHaveAttribute("data-suggested", "true");
  await expect(page.getByRole("button", { name: "Apply adjustments" })).toBeDisabled();
  await marker.focus();
  await marker.press("ArrowRight");
  const applied = renderRequest(page);
  await page.getByRole("button", { name: "Apply adjustments" }).click();
  expect((await applied).postDataJSON().params.trigger.mode).toBe("manual");
  await waitForReplacement(page, request, job.id, first.key);
  await expect(page.getByRole("heading", { name: "Time Freeze ready", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Adjust freeze point" }).click();
  await expect(page.getByRole("button", { name: "Use suggestion", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(import.meta.dirname, "..", ".focus-data-e2e", "time-freeze-mobile.png"), fullPage: true });
});
