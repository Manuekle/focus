import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The Flipbook chat with AI switched off (these runs never spend credits):
// the panel opens, says the chat is paused, and neither the chat nor the
// redraw route lets a message or a paid drawing through. A finished
// animation is written where the server keeps it, so no drawing is needed.

const DATA = path.join(import.meta.dirname, "..", ".focus-data-e2e");
// Plain data: the Playwright loader can't import the app's schemas, the server validates the file when it reads it.
const PHASES = ["left_contact", "left_down", "left_passing", "left_up", "right_contact", "right_down", "right_passing", "right_up"] as const;
const FRAME_IDS = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"] as const;

async function seedFlipbook(): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const flipbook = {
    id,
    imageId: randomUUID(),
    status: "ready",
    prompt: "walk in place",
    title: "Chat check",
    detail: null,
    progress: null,
    source: { width: 1024, height: 1536, hasAlpha: false },
    analysis: null,
    plan: {
      action: "walk",
      direction: "right",
      view: "side",
      motion: "in_place",
      drawingFps: 8,
      durationSeconds: 4,
      loop: true,
      poses: PHASES.map((phase, index) => ({ index, phase, label: `Pose ${index + 1}`, description: `The ${phase.replace("_", " ")} pose of a walk.`, relativeRootY: 0, lift: 0 })),
    },
    warnings: [],
    reference: { kind: "original", version: "v-000000000001", reason: "The illustration is the reference.", createdAt: now },
    frames: PHASES.map((phase, index) => ({
      id: FRAME_IDS[index], poseIndex: index, phase, label: `Pose ${index + 1}`, status: "pending", approved: false,
      version: null, originalVersion: null, versions: [], metrics: null, warnings: [], review: null, error: null,
    })),
    order: [...FRAME_IDS],
    alignment: null,
    budget: { limit: 16, used: 8 },
    backgrounds: { scene: false, custom: false },
    review: null,
    exports: [],
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const dir = path.join(DATA, "flipbooks", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "flipbook.json"), JSON.stringify(flipbook));
  return id;
}

async function openMockChat(page: Page) {
  const id = await seedFlipbook();
  const body = await readFile(path.join(DATA, "flipbooks", id, "flipbook.json"), "utf8");
  await page.route(`**/api/flipbooks/${id}`, (route) => route.fulfill({ json: JSON.parse(body) }));
  await page.route("**/api/health", (route) => route.fulfill({ json: { checks: { aiEnabled: true } } }));
  await page.goto(`/flipbook?f=${id}`);
  const chat = page.getByRole("region", { name: "Animation chat" });
  await expect(chat.getByLabel("Tell the animation what to change")).toBeEnabled();
  return { chat, url: `**/api/flipbooks/${id}/chat` };
}

const CHAT_PROPOSAL = {
  reply: "A warmer, friendlier idle with a happy smile throughout the loop.",
  changes: FRAME_IDS.map((frame, index) => ({
    frame, position: index + 1, label: `Pose ${index + 1}`,
    summary: "Keep the original pose with a warm happy smile, bright eyes and a relaxed expression.",
    before: "Original pose.", description: "Keep the original pose and add a warm happy smile.",
  })),
  playback: null, skipped: [], cost: { drawings: 8, used: 8, limit: 16, overBy: 0 },
};

test("the sent chat bubble stays mounted when the proposal arrives", async ({ page }) => {
  const { chat, url } = await openMockChat(page);
  let answer!: () => void;
  const response = new Promise<void>((resolve) => { answer = resolve; });
  await page.route(url, async (route) => {
    await response;
    await route.fulfill({ json: CHAT_PROPOSAL });
  });
  const input = chat.getByLabel("Tell the animation what to change");
  await input.fill("Make it happier");
  await input.press("Enter");
  await expect(chat.getByText("Planning the change…")).toBeVisible();
  const bubble = await chat.getByText("Make it happier", { exact: true }).elementHandle();
  expect(bubble).not.toBeNull();
  answer();
  await expect(chat.getByText(CHAT_PROPOSAL.reply)).toBeVisible();
  expect(await bubble!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(chat.getByText("Make it happier", { exact: true })).toHaveCount(1);
});

test("long chat replies stay separated and a failed send can be retried", async ({ page }) => {
  const { chat, url } = await openMockChat(page);
  let fail = false;
  await page.route(url, (route) => route.fulfill(fail
    ? { status: 503, json: { error: { code: "meta_unavailable", message: "Please try again." } } }
    : { json: CHAT_PROPOSAL }));
  const input = chat.getByLabel("Tell the animation what to change");
  const messages = ["Make it happier", "Keep that smile"];
  for (const [index, message] of messages.entries()) {
    await input.fill(message);
    await input.press("Enter");
    await expect(chat.getByText(message, { exact: true })).toHaveCount(1);
    await expect(chat.getByText(CHAT_PROPOSAL.reply)).toHaveCount(index + 1);
    await expect(chat.getByText("Planning the change…")).toHaveCount(0);
  }
  const layout = await chat.locator(":scope > ol").evaluate((list) => ({
    bottomGap: list.scrollHeight - list.clientHeight - list.scrollTop,
    rows: Array.from(list.children).map((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return { top, bottom };
    }),
  }));
  expect(Math.abs(layout.bottomGap)).toBeLessThanOrEqual(1);
  for (let index = 1; index < layout.rows.length; index++)
    expect(layout.rows[index].top - layout.rows[index - 1].bottom).toBeGreaterThanOrEqual(9);

  fail = true;
  await input.fill("Make it slower");
  await input.press("Enter");
  await expect(chat.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("Make it slower");
  await expect(chat.locator(":scope > ol > li")).toHaveCount(4);
  fail = false;
  await input.press("Enter");
  await expect(chat.getByRole("alert")).toHaveCount(0);
  await expect(chat.getByText(CHAT_PROPOSAL.reply)).toHaveCount(3);
  await expect(chat.getByText("Planning the change…")).toHaveCount(0);
  await expect(chat.getByText("Make it slower", { exact: true })).toHaveCount(1);
});

test("with AI off the chat says it is paused and nothing paid goes through", async ({ page, request }) => {
  const id = await seedFlipbook();
  await page.goto(`/flipbook?f=${id}`);

  const chat = page.getByRole("region", { name: "Animation chat" });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("heading", { name: "Change the movement" })).toBeVisible();
  await expect(chat.getByTestId("chat-disabled")).toContainText("AI editing is paused");
  await expect(chat.getByLabel("Tell the animation what to change")).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Send to the animation assistant" })).toBeDisabled();
  for (const chip of ["Make the movement smaller", "Slower, more relaxed"]) await expect(chat.getByRole("button", { name: chip })).toBeDisabled();

  // The server says the same, whoever asks: no message, no redraw.
  const message = await request.post(`/api/flipbooks/${id}/chat`, { data: { message: "make her wave with the other hand" } });
  expect(message.status()).toBe(503);
  expect((await message.json()).error.code).toBe("ai_disabled");
  const apply = await request.post(`/api/flipbooks/${id}/chat/apply`, { data: { changes: [{ frame: "f3", description: "The near arm is raised high." }] } });
  expect(apply.status()).toBe(503);
  expect((await apply.json()).error.code).toBe("ai_disabled");
  // A malformed request is rejected before any guard is touched.
  expect((await request.post(`/api/flipbooks/${id}/chat`, { data: { message: "" } })).status()).toBe(400);
  expect((await request.post(`/api/flipbooks/${id}/chat/apply`, { data: { changes: [] } })).status()).toBe(400);

  // Nothing was spent or changed.
  const after = await (await request.get(`/api/flipbooks/${id}`)).json();
  expect(after.budget).toEqual({ limit: 16, used: 8 });
  expect(after.status).toBe("ready");
});
