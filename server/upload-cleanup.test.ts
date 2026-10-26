import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupVideos } from "./jobs";

let root: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.FOCUS_DATA_DIR;
  root = await mkdtemp(path.join(tmpdir(), "focus-upload-cleanup-"));
  process.env.FOCUS_DATA_DIR = root;
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.FOCUS_DATA_DIR;
  else process.env.FOCUS_DATA_DIR = previousDataDir;
  await rm(root, { recursive: true, force: true });
});

it("keeps a fresh upload while its asset metadata is still being prepared", async () => {
  const dir = path.join(root, "videos", "00000000-0000-4000-8000-000000000001");
  await mkdir(dir, { recursive: true });
  const source = path.join(dir, "source.mp4");
  await writeFile(source, "upload in progress");
  await cleanupVideos();
  await expect(access(source)).resolves.toBeUndefined();
});

it("removes an abandoned upload after the one-day retention window", async () => {
  const dir = path.join(root, "videos", "00000000-0000-4000-8000-000000000002");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "source.mp4"), "abandoned upload");
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(dir, old, old);
  await cleanupVideos();
  await expect(access(dir)).rejects.toMatchObject({ code: "ENOENT" });
});
