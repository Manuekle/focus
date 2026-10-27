import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { EDITOR_DRAFT_KEY } from "../shared/account";
import { EditJobSchema, VideoAssetSchema } from "../shared/schemas";

// The expectation is the build-time flag. The server may intentionally start
// with the opposite runtime value to catch inconsistent client/API bundles.
const enabled = process.env.NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS === "true";

async function upload(page: Page, request: APIRequestContext) {
  await page.goto("/");
  const normalized = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/videos" && response.request().method() === "POST");
  await page.locator('input[type="file"]').setInputFiles(path.join(import.meta.dirname, ".fixtures", "clip.mp4"));
  expect((await normalized).status()).toBe(201);
  await expect(page.getByLabel("Describe the change")).toBeVisible();
  const videoId = new URL(page.url()).searchParams.get("v")!;
  return VideoAssetSchema.parse(await (await request.get(`/api/videos/${videoId}`)).json());
}

test("the compiled flag agrees across the catalog and edit API, with every v1 effect available", async ({ page, request }) => {
  const video = await upload(page, request);
  const composer = page.locator("#studio");
  for (const name of ["Reality Shift", "Break the Frame", "Motion Echo"]) await expect(composer.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Time Freeze", exact: true })).toHaveCount(enabled ? 1 : 0);
  for (const effect of ["reality-shift", "break-the-frame", "motion-echo", "time-freeze"]) {
    const response = await request.post("/api/edits", { data: { videoId: video.id, effect, prompt: "Keep the person in focus" } });
    const disabled = effect === "time-freeze" && !enabled;
    // AI is deliberately paused for browser checks: an enabled effect gets
    // through the release gate to that guard, without spending any credits.
    expect(response.status()).toBe(disabled ? 400 : 503);
    expect((await response.json()).error.code).toBe(disabled ? "effect_disabled" : "ai_disabled");
  }
});

test("rollback keeps a temporal draft's text without autostarting another effect", async ({ page, request }) => {
  test.skip(enabled, "Rollback is checked on the stable build.");
  const video = await upload(page, request);
  const prompt = "Freeze the person at the top of the jump";
  await page.evaluate(({ key, videoId, prompt }) => localStorage.setItem(key, JSON.stringify({ videoId, effect: "time-freeze", prompt, autostart: true, savedAt: Date.now() })), { key: EDITOR_DRAFT_KEY, videoId: video.id, prompt });
  const generated: string[] = [];
  page.on("request", (req) => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/edits") generated.push(req.url()); });
  await page.goto(`/editor?v=${video.id}`);
  await expect(page.getByLabel("Describe the change")).toHaveValue(prompt);
  await expect(page.getByText("Keep your subject in color, in focus or in the spotlight.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Time Freeze", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate edit", exact: true })).toBeEnabled();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), EDITOR_DRAFT_KEY)).toMatchObject({ effect: "reality-shift", prompt, autostart: false });
  expect(generated).toEqual([]);
});

test("rollback does not reopen temporal project controls or render its saved parameters", async ({ page, request }) => {
  test.skip(enabled, "Rollback is checked on the stable build.");
  const video = await upload(page, request);
  const now = new Date().toISOString();
  const job = EditJobSchema.parse({
    id: randomUUID(), videoId: video.id,
    request: { videoId: video.id, effect: "time-freeze", prompt: "Freeze the person with three echoes" },
    plan: { supported: true, target: { concept: "person", selection: "single" }, effect: "time_freeze_echo", parameters: {}, needsClarification: false },
    status: "ready_to_render", progress: 1, detail: null, error: null,
    segmentationId: "c-before-rollback", objects: [], selection: ["0"], reused: { plan: true, segmentation: true },
    params: { effect: "time_freeze_echo", trigger: { mode: "manual", timestampMs: 1000 } },
    resultUrl: null, createdAt: now, updatedAt: now,
  });
  const jobFile = path.join(process.cwd(), ".focus-data-e2e", "jobs", `${job.id}.json`);
  await mkdir(path.dirname(jobFile), { recursive: true });
  const saved = JSON.stringify(job);
  await writeFile(jobFile, saved);
  for (const params of [undefined, job.params]) {
    const response = await request.post(`/api/jobs/${job.id}/render`, { data: params ? { params } : {} });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("effect_disabled");
  }
  expect(await readFile(jobFile, "utf8")).toBe(saved);
  // Only account/project responses are fixtures. The editor must choose the
  // stable composer even if the persisted active edit was temporal.
  const ownerId = randomUUID();
  const project = { id: randomUUID(), ownerId, title: "Saved clip", videoId: video.id, jobIds: [job.id], activeJobId: job.id, createdAt: now, updatedAt: now };
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: ownerId, name: "Release test", avatarUrl: null, simulated: true }, quota: null, authMode: "simulated" } }));
  await page.route("**/api/projects", (route) => route.fulfill({ json: route.request().method() === "POST" ? project : [] }));
  await page.route(`**/api/projects/${project.id}`, (route) => route.fulfill({ json: { project, video, jobs: [job] } }));
  await page.goto(`/editor?v=${video.id}`);
  await expect(page.getByRole("button", { name: "Generate edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Time Freeze", exact: true })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Freeze point", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Edits on this clip", exact: true })).toHaveCount(0);
  expect(await readFile(jobFile, "utf8")).toBe(saved);
});
