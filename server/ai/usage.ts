import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
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

/** SAM frames billed since a moment (cache hits excluded): the processing budget. */
export async function samFramesSince(since: Date): Promise<number> {
  const raw = await readFile(usageFile(), "utf8").catch(() => "");
  let total = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line) as UsageEntry;
    if (entry.cached || new Date(entry.at) < since) continue;
    if (entry.kind === "segment") total += entry.videoFramesProcessed ?? 0;
    // A still image is one frame of SAM work.
    else if (entry.kind === "segment_image" && entry.ok) total += 1;
  }
  return total;
}
