import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Fresh isolated volume, no provider credentials. Replays the actual Phase 8
// plan and SAM response, then exercises the production UI/API/FFmpeg in Docker.
const image = process.argv[2] ?? "focus-phase10-temporal";
const capture = path.resolve(process.env.FOCUS_ACCEPTANCE_CAPTURE_DIR ?? ".focus-data/phase8/e249dcac5f5da1dd");
const artifacts = path.resolve(".focus-data/phase10/container");
const name = `focus-acceptance-${randomUUID().slice(0, 8)}`;
const volume = `${name}-data`;
const base = "http://127.0.0.1:3402";
const envFile = path.join(artifacts, `${name}.env`);
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
const report = { status: "running", startedAt: new Date().toISOString(), image, scope: "Docker arm64, real footage, recorded Muse Spark/SAM, live UI/API/render/download", providerCalls: 0 };
let browser;
let jobId;
let ownsVolume = false;
let ownsContainer = false;
await mkdir(artifacts, { recursive: true });
try {
  const recorded = JSON.parse(await readFile(path.join(capture, "report.json"), "utf8"));
  const tracking = JSON.parse(await readFile(path.join(capture, "live-8fc9014bbed48944.json"), "utf8"));
  const source = await readFile(path.join(capture, "excerpt.mp4"));
  assert.equal(recorded.status, "passed");
  assert.equal(tracking.frames.length, recorded.media.frameCount);
  await writeFile(envFile, `FOCUS_AI_DISABLED=1\nMODEL_API_KEY=\nMETA_API_KEY=\nFOCUS_SESSION_SECRET=${randomBytes(48).toString("hex")}\nNEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false\n`, { mode: 0o600 });
  docker("volume", "create", volume);
  ownsVolume = true;
  ownsContainer = true;
  docker("run", "--detach", "--name", name, "--cpus", "2", "--memory", "2g", "--publish", "127.0.0.1:3402:3000", "--env-file", envFile, "--volume", `${volume}:/data`, image);
  let health;
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${base}/api/health`).catch(() => null);
    if (response?.ok) { health = await response.json(); break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(health?.ok, true);
  assert.equal(health.checks.metaConfigured, false);
  assert.equal(health.checks.aiEnabled, false);
  assert.notEqual(docker("exec", name, "id", "-u"), "0");
  for (const effect of ["reality-shift", "break-the-frame", "motion-echo"]) {
    const response = await fetch(`${base}/demo/${effect}.mp4`, { headers: { Range: "bytes=0-127" } });
    assert.equal(response.status, 206);
    assert.equal((await response.arrayBuffer()).byteLength, 128);
  }
  const uploaded = await fetch(`${base}/api/videos`, { method: "POST", headers: { "Content-Type": "video/mp4", "X-Focus-Filename": "real-pedestrians.mp4" }, body: source });
  assert.equal(uploaded.status, 201);
  const video = await uploaded.json();
  for (const key of ["width", "height", "fps", "frameCount"]) assert.equal(video.normalized[key], recorded.media[key]);
  jobId = randomUUID();
  const segmentationId = "c-acceptance-real-person";
  const prompt = "Freeze the person in the black coat with three echoes";
  const now = new Date().toISOString();
  const job = {
    id: jobId, videoId: video.id, request: { videoId: video.id, effect: "time-freeze", prompt },
    plan: recorded.plan, status: "ready_to_render", detail: "Choose the freeze point on the timeline.", progress: 1,
    segmentationId, objects: tracking.objects, selection: [recorded.tracking.objectId], reused: { plan: true, segmentation: true },
    params: { ...recorded.temporal.params, trigger: { mode: "manual" } },
    error: null, resultUrl: null, createdAt: now, updatedAt: now,
  };
  const jobFile = path.join(artifacts, "seed-job.json");
  const trackFile = path.join(artifacts, "seed-tracking.json");
  await writeFile(jobFile, JSON.stringify(job));
  await writeFile(trackFile, JSON.stringify({ ...tracking, id: segmentationId, videoId: video.id }));
  docker("exec", name, "mkdir", "-p", "/data/jobs", `/data/videos/${video.id}/segmentations`);
  docker("cp", jobFile, `${name}:/data/jobs/${jobId}.json`);
  docker("cp", trackFile, `${name}:/data/videos/${video.id}/segmentations/${segmentationId}.json`);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
  await page.goto(`${base}/?v=${video.id}`);
  const effect = page.getByRole("button", { name: "Time Freeze", exact: true });
  await effect.waitFor({ state: "visible", timeout: 30_000 });
  await effect.click();
  await page.getByLabel("Describe the change").fill(prompt);
  await page.getByRole("button", { name: "Generate edit", exact: true }).click();
  const marker = page.getByRole("slider", { name: "Freeze point", exact: true });
  await marker.waitFor({ state: "visible", timeout: 30_000 });
  await marker.press("Home");
  for (let i = 0; i < 36; i++) await marker.press("ArrowRight");
  assert.equal(await marker.inputValue(), "36");
  await page.getByRole("button", { name: "Preview Time Freeze", exact: true }).click();
  let completed;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    completed = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (completed.status === "failed") throw new Error(`Container render failed: ${completed.error?.code}`);
    if (completed.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(completed.status, "completed");
  await page.getByRole("heading", { name: "Time Freeze ready", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(completed.params.trigger.mode, "manual");
  assert.equal(completed.params.trigger.timestampMs, 1500);
  assert.equal(completed.render.frameCount, 96);
  assert.equal(completed.render.temporal.echoFrames.length, 3);
  const outputBytes = Buffer.from(await (await fetch(base + completed.render.urls.video)).arrayBuffer());
  const downloadResponse = await fetch(base + completed.render.urls.download);
  assert.match(downloadResponse.headers.get("content-disposition"), /attachment/);
  assert(outputBytes.equals(Buffer.from(await downloadResponse.arrayBuffer())));
  const ranged = await fetch(base + completed.render.urls.video, { headers: { Range: "bytes=128-255" } });
  assert.equal(ranged.status, 206);
  assert(outputBytes.subarray(128, 256).equals(Buffer.from(await ranged.arrayBuffer())));
  await page.getByRole("button", { name: "Edited", exact: true }).click();
  assert.equal(await page.getByLabel("Edited video", { exact: true }).getAttribute("src"), completed.render.urls.video);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).first().click();
  const download = await downloading;
  const outputPath = path.join(artifacts, "output.mp4");
  await download.saveAs(outputPath);
  assert(outputBytes.equals(await readFile(outputPath)));
  const comparePath = path.join(artifacts, "compare.mp4");
  await writeFile(comparePath, Buffer.from(await (await fetch(base + completed.render.urls.compare)).arrayBuffer()));
  for (const file of [outputPath, comparePath]) {
    const facts = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
    const stream = facts.streams.find((entry) => entry.codec_type === "video");
    assert.equal(stream.codec_name, "h264");
    assert.equal(stream.pix_fmt, "yuv420p");
    assert.equal(stream.avg_frame_rate, "24/1");
    assert.equal(stream.nb_frames, "96");
    assert.equal(Number(stream.duration), 4);
    assert.equal(stream.width, video.normalized.width);
    assert.equal(stream.height, video.normalized.height * (file === comparePath ? 2 : 1));
    assert.equal(facts.streams.some((entry) => entry.codec_type === "audio"), video.normalized.hasAudio);
  }
  await page.getByLabel("Edited video", { exact: true }).evaluate((video) => { video.pause(); video.currentTime = 2.4; });
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Edited video"]');
    return video && !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - 2.4) < 0.05;
  });
  await page.screenshot({ path: path.join(artifacts, "editor.png"), fullPage: true });
  report.status = "passed";
  report.finishedAt = new Date().toISOString();
  report.health = health;
  report.imageId = docker("image", "inspect", image, "--format", "{{.Id}}");
  report.architecture = docker("image", "inspect", image, "--format", "{{.Architecture}}");
  report.video = video.normalized;
  report.render = { frameCount: completed.render.frameCount, durationSeconds: completed.render.durationSeconds, temporal: completed.render.temporal, warnings: completed.render.warnings };
  report.previewEqualsDownload = true;
  report.demoAssetsAvailable = true;
  console.info("Docker acceptance passed; artifacts:", artifacts);
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : "unknown";
  if (ownsContainer) {
    report.lastJob = jobId ? await fetch(`${base}/api/jobs/${jobId}`).then((response) => response.json()).catch(() => null) : null;
    try { await writeFile(path.join(artifacts, "container.log"), docker("logs", "--tail", "80", name)); } catch { /* Startup may have failed. */ }
    try { report.containerState = JSON.parse(docker("inspect", name, "--format", "{{json .State}}")); } catch { /* No created container. */ }
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  const cleanupErrors = [];
  if (ownsContainer) try { docker("rm", "--force", name); } catch { cleanupErrors.push("container"); }
  if (ownsVolume) try { docker("volume", "rm", volume); } catch { cleanupErrors.push("volume"); }
  await rm(envFile, { force: true });
  report.cleanup = { containerRemoved: !cleanupErrors.includes("container"), volumeRemoved: !cleanupErrors.includes("volume") };
  if (cleanupErrors.length) report.status = "failed";
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  if (cleanupErrors.length) throw new Error(`Acceptance cleanup failed: ${cleanupErrors.join(", ")}`);
}
