import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditJobSchema } from "../shared/schemas";
import { getJob } from "./jobs";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

let work: string;
beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "focus-poll-"));
  vi.stubEnv("FOCUS_DATA_DIR", work);
  await mkdir(path.join(work, "jobs"));
});
afterEach(async () => {
  vi.mocked(readFile).mockClear();
  vi.unstubAllEnvs();
  await rm(work, { recursive: true, force: true });
});

it.each(["completed", "canceled", "failed"] as const)("a late active snapshot cannot overwrite a %s job as interrupted", async (status) => {
  const now = new Date().toISOString();
  const videoId = randomUUID();
  const active = EditJobSchema.parse({
    id: randomUUID(), videoId,
    request: { videoId, effect: "reality-shift", prompt: "Keep the person in color" },
    status: "rendering", progress: 0.9, detail: null, plan: null,
    segmentationId: null, objects: [], selection: [], reused: { plan: false, segmentation: false },
    error: null, resultUrl: null, createdAt: now, updatedAt: now,
  });
  const terminal = { ...active, status, progress: 1 };
  const file = path.join(work, "jobs", `${active.id}.json`);
  await writeFile(file, JSON.stringify(terminal));
  // The read started before the worker finished; its snapshot arrives after
  // the terminal state was saved and the worker left the running map.
  vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(active));
  expect(await getJob(active.id)).toMatchObject({ status, progress: 1, error: null });
  expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ status, error: null });
});
