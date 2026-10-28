import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import type { LivingInventory } from "../shared/living";

// "Animate as is" in the browser, with AI switched off: the paid step
// (finding what can move) is replaced by writing its result where the
// server keeps it, so everything after it runs for real: the local renders,
// framing, sound, downloads and picking a part by hand.

const WIDTH = 640, HEIGHT = 360;
const DATA = path.join(import.meta.dirname, "..", ".focus-data-e2e");

const box = { body: { left: 280, top: 120, right: 360, bottom: 340 }, tail: { left: 230, top: 230, right: 280, bottom: 300 } };
const leaves = [{ left: 60, top: 60, right: 70, bottom: 66 }, { left: 500, top: 90, right: 510, bottom: 96 }];
const inside = (x: number, y: number, b: { left: number; top: number; right: number; bottom: number }) => x >= b.left && x < b.right && y >= b.top && y < b.bottom;

/** A sky, a navy character with a gray tail, and two green leaves. */
async function picture(): Promise<Buffer> {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const color = inside(x, y, box.body) ? [44, 53, 94] : inside(x, y, box.tail) ? [160, 160, 168] : leaves.some((leaf) => inside(x, y, leaf)) ? [90, 200, 70] : [127, 180, 230 - Math.round(y / 8)];
    rgb.set(color, (y * WIDTH + x) * 3);
  }
  return sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

async function mask(pick: (x: number, y: number) => boolean): Promise<Buffer> {
  const alpha = Buffer.alloc(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (pick(x, y)) alpha[y * WIDTH + x] = 255;
  return sharp(alpha, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).png().toBuffer();
}

/** What "Find what can move" would have stored: the character and its leaves. */
async function seed(imageId: string) {
  const dir = path.join(DATA, "flipbook-images", imageId, "living");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "person.png"), await mask((x, y) => inside(x, y, box.body) || inside(x, y, box.tail)));
  await writeFile(path.join(dir, "leaf.png"), await mask((x, y) => leaves.some((leaf) => inside(x, y, leaf))));
  for (const [index, leaf] of leaves.entries()) await writeFile(path.join(dir, `leaf-${index}.png`), await mask((x, y) => inside(x, y, leaf)));
  const inventory: LivingInventory = {
    imageId,
    wind: "right",
    layers: [
      { id: "person", name: "person", kind: "character", pieces: 1, share: 0.09, custom: false },
      { id: "leaf", name: "leaf", kind: "floating", pieces: 2, share: 0.0005, custom: false },
    ],
    stills: ["tree"],
    scene: false,
    blink: false,
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(dir, "layers.json"), JSON.stringify(inventory));
}

test("animates a picture as is: preview, framing, sound, downloads and a part picked by hand", async ({ page, request }) => {
  test.setTimeout(150_000);
  const fixture = path.join(import.meta.dirname, ".fixtures", "character.png");
  await mkdir(path.dirname(fixture), { recursive: true });
  await writeFile(fixture, await picture());

  await page.goto("/flipbook");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  // The uploaded picture is shown from its media route, which names its id.
  const shown = page.locator('img[src^="/api/flipbooks/images/"]').first();
  await expect(shown).toBeVisible({ timeout: 30_000 });
  const image = { id: new URL((await shown.getAttribute("src"))!, "http://x").pathname.split("/").at(-1)! };
  expect(image.id).toMatch(/^[0-9a-f-]{36}$/);
  await seed(image.id);

  await page.getByRole("button", { name: "Animate as is", exact: true }).click();
  await expect(page.getByText("Person", { exact: true })).toBeVisible();
  await expect(page.getByText("Leaf", { exact: true })).toBeVisible();
  await expect(page.getByText("Stays as it is: tree.")).toBeVisible();
  // The first preview renders by itself.
  await expect(page.locator("video")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Up to date" })).toBeDisabled();

  // A portrait crop with a sound under it.
  await page.getByRole("button", { name: "9:16", exact: true }).click();
  await page.getByRole("button", { name: "Ambience", exact: true }).click();
  await page.getByRole("button", { name: "Update preview" }).click();
  await expect(page.getByRole("button", { name: "Up to date" })).toBeVisible({ timeout: 60_000 });
  const video = page.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  const size = await video.evaluate(async (element: HTMLVideoElement) => {
    if (element.readyState < 1) await new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }));
    return { width: element.videoWidth, height: element.videoHeight };
  });
  expect(size.width / size.height).toBeCloseTo(9 / 16, 1);

  const download = page.getByRole("link", { name: /^MP4/ });
  const file = await request.get((await download.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("video/mp4");

  // The tail wasn't found: pick it with a click.
  await page.getByRole("button", { name: "Add a part" }).click();
  const still = page.locator("img[data-picking]");
  await expect(still).toBeVisible();
  const area = (await still.boundingBox())!;
  await still.click({ position: { x: (255 / WIDTH) * area.width, y: (265 / HEIGHT) * area.height } });
  await expect(page.getByText("Added by you")).toBeVisible();
  await page.getByRole("button", { name: "Update preview" }).click();
  await expect(page.getByRole("button", { name: "Up to date" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Remove part" }).click();
  await expect(page.getByText("Added by you")).toHaveCount(0);
});
