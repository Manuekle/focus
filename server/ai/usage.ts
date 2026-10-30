import path from "node:path";
import { appendFile, mkdir, open, readFile, stat } from "node:fs/promises";
import { dataRoot } from "../storage";

// Basic, local usage diagnostics: one JSON line per API call or cache hit.

export type UsageEntry = {
  readonly at: string;
  readonly model: string;
  readonly kind:
    | "plan" | "suggest" | "assist" | "segment" | "file_upload"
    // Focus Flipbook: Muse Image drawings, SAM 3.1 on still images, Muse Spark analysis/plan/review.
    | "image_generate" | "segment_image" | "flipbook_analyze" | "flipbook_plan" | "flipbook_review" | "flipbook_chat";
  readonly cached: boolean;
  readonly ok: boolean;
  readonly videoId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly videoFramesProcessed?: number;
  readonly flipbookId?: string;
  readonly characterId?: string;
  readonly durationMs?: number;
  readonly error?: string;
};

function usageFile(): string {
  return path.join(dataRoot(), "usage.jsonl");
}

export async function recordUsage(entry: Omit<UsageEntry, "at">): Promise<void> {
  try {
    await mkdir(dataRoot(), { recursive: true });
    await appendFile(usageFile(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch (error) {
    console.warn("[focus] could not record usage", error);
  }
}

export async function usageSummary() {
  const raw = await readFile(usageFile(), "utf8").catch(() => "");
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UsageEntry);
  const sum = (pick: (entry: UsageEntry) => number | undefined) =>
    entries.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
  const calls = entries.filter((entry) => !entry.cached);
  return {
    apiCalls: calls.length,
    failedCalls: calls.filter((entry) => !entry.ok).length,
    cacheHits: entries.filter((entry) => entry.cached).length,
    planCalls: calls.filter((entry) => entry.kind === "plan").length,
    assistCalls: calls.filter((entry) => entry.kind === "assist").length,
    segmentCalls: calls.filter((entry) => entry.kind === "segment").length,
    imageCalls: calls.filter((entry) => entry.kind === "image_generate").length,
    imageSegmentCalls: calls.filter((entry) => entry.kind === "segment_image").length,
    inputTokens: sum((entry) => entry.inputTokens),
    outputTokens: sum((entry) => entry.outputTokens),
    videoFramesProcessed: sum((entry) => entry.videoFramesProcessed),
    recent: entries.slice(-20).reverse(),
  };
}

type Billed = { readonly at: number; readonly frames: number };

// Every AI request checks the daily SAM budget. Instead of parsing the whole
// log each time, the billed entries are kept in memory and only the bytes
// appended since the last check are read.
const tail = ((globalThis as { __focusUsageTail?: { file: string; ino: number; offset: number; billed: Billed[]; reading: Promise<void> } }).__focusUsageTail ??= {
  file: "",
  ino: 0,
  offset: 0,
  billed: [],
  reading: Promise.resolve(),
});

function billedFrames(entry: UsageEntry): number {
  if (entry.cached) return 0;
  if (entry.kind === "segment") return entry.videoFramesProcessed ?? 0;
  // A still image is one frame of SAM work.
  if (entry.kind === "segment_image" && entry.ok) return 1;
  return 0;
}

async function catchUp(): Promise<void> {
  const file = usageFile();
  const info = await stat(file).catch(() => null);
  const size = info?.size ?? 0;
  const ino = info?.ino ?? 0;
  // Another data root, or the log was replaced: start over.
  if (tail.file !== file || tail.ino !== ino || size < tail.offset) Object.assign(tail, { file, ino, offset: 0, billed: [] });
  if (size === tail.offset) return;
  const handle = await open(file, "r");
  try {
    const chunk = Buffer.alloc(size - tail.offset);
    await handle.read(chunk, 0, chunk.length, tail.offset);
    // A line still being appended waits for the next check.
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return;
    for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
      if (!line) continue;
      const entry = JSON.parse(line) as UsageEntry;
      const frames = billedFrames(entry);
      if (frames > 0) tail.billed.push({ at: Date.parse(entry.at), frames });
    }
    tail.offset += end + 1;
  } finally {
    await handle.close();
  }
}

/** SAM frames billed since a moment (cache hits excluded): the processing budget. */
export async function samFramesSince(since: Date): Promise<number> {
  // Serialized, so two requests never read the same bytes twice.
  tail.reading = tail.reading.catch(() => undefined).then(catchUp);
  await tail.reading;
  const from = since.getTime();
  return tail.billed.reduce((total, entry) => (entry.at >= from ? total + entry.frames : total), 0);
}
